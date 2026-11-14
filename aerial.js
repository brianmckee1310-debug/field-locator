/* ============ free aerial imagery from USGS The National Map ============ */
import { S, A, ICON } from './state.js';
import { h, toast, sheet, closeSheet, dialog } from './ui.js';
import { parseLatLon, mercX, mercY, mercLat, mercLon, D2R } from './geo.js';

const NAIP='https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage';
const TILES='https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile';
const WORLD=20037508.342789244;

async function fetchBitmap(url){
  const r=await fetch(url,{mode:'cors',cache:'no-store'});
  if(!r.ok) throw new Error('http '+r.status);
  const b=await r.blob();
  if(!(b.type||'').startsWith('image/')||b.size<2000) throw new Error('not an image');
  return createImageBitmap(b);
}
async function viaExport(bb,w,hh){
  const url=`${NAIP}?bbox=${bb.x0},${bb.y0},${bb.x1},${bb.y1}&bboxSR=3857&imageSR=3857&size=${w},${hh}&format=jpg&interpolation=RSP_BilinearInterpolation&f=image`;
  const bmp=await fetchBitmap(url);
  const c=document.createElement('canvas'); c.width=w; c.height=hh;
  c.getContext('2d').drawImage(bmp,0,0,w,hh);
  return c;
}
async function viaTiles(bb,w,hh,onProg){
  const z=16, ts=2*WORLD/2**z;
  const tx0=Math.floor((bb.x0+WORLD)/ts), tx1=Math.floor((bb.x1+WORLD)/ts), ty0=Math.floor((WORLD-bb.y1)/ts), ty1=Math.floor((WORLD-bb.y0)/ts);
  const total=(tx1-tx0+1)*(ty1-ty0+1); if(total>400) throw new Error('area too large');
  const c=document.createElement('canvas'); c.width=w; c.height=hh;
  const x=c.getContext('2d'); x.imageSmoothingQuality='high';
  const sx=w/(bb.x1-bb.x0), sy=hh/(bb.y1-bb.y0); let done=0, ok=0;
  const jobs=[];
  for(let ty=ty0;ty<=ty1;ty++) for(let tx=tx0;tx<=tx1;tx++) jobs.push((async()=>{
    try{ const bmp=await fetchBitmap(`${TILES}/${z}/${ty}/${tx}`);
      const mx=tx*ts-WORLD, my=WORLD-ty*ts;
      x.drawImage(bmp,(mx-bb.x0)*sx,(bb.y1-my)*sy,ts*sx+.6,ts*sy+.6); ok++; }catch(e){}
    onProg&&onProg(++done/total); })());
  await Promise.all(jobs);
  if(ok<total*0.6) throw new Error('tiles failed');
  return c;
}
/* bb: mercator bbox {x0,y0,x1,y1} */
async function getAerial(bb,name){
  const lat=mercLat((bb.y0+bb.y1)/2), groundW=(bb.x1-bb.x0)*Math.cos(lat*D2R);
  let w=Math.round(Math.max(1000,Math.min(4000,groundW/0.6))), hh=Math.round(w*(bb.y1-bb.y0)/(bb.x1-bb.x0));
  if(hh>4000){ w=Math.round(w*4000/hh); hh=4000; }
  A.busy(25,'Downloading USGS aerial…');
  let c;
  try{ c=await viaExport(bb,w,hh); }
  catch(e){
    try{ A.busy(40,'Trying the tile server…'); c=await viaTiles(bb,w,hh,p=>A.busy(40+p*45,'Trying the tile server…')); }
    catch(e2){ A.busyOff(); throw new Error('Couldn\'t reach the USGS imagery servers. Check your connection and try again. This imagery covers the US only.'); }
  }
  A.busy(90,'Saving…');
  const cx=(bb.x0+bb.x1)/2, cy=(bb.y0+bb.y1)/2;
  const ctrl=[[0,0,bb.x0,bb.y1],[w,0,bb.x1,bb.y1],[w,hh,bb.x1,bb.y0],[0,hh,bb.x0,bb.y0],[w/2,hh/2,cx,cy]]
    .map(([px,py,mx,my])=>({px,py,lat:mercLat(my),lon:mercLon(mx)}));
  let rec;
  try{ rec=await A.addMapFromCanvas(c,{name,ctrl,fit:'affine',geoSrc:'aerial',extra:{credit:'Imagery: USGS The National Map, USDA NAIP'}}); }
  catch(e){ A.busyOff(); throw new Error('The image downloaded but couldn\'t be saved on this device.'); }
  A.busyOff();
  return rec;
}
function boxAround(lat,lon,widthM){
  const half=widthM/2/Math.cos(lat*D2R), x=mercX(lon), y=mercY(lat);
  return {x0:x-half,y0:y-half,x1:x+half,y1:y+half};
}
function boxOfMap(){
  const m=S.map, cs=[[0,0],[m.imgW,0],[m.imgW,m.imgH],[0,m.imgH]].map(p=>S.xf.toGeo(p[0],p[1]));
  const xs=cs.map(c=>mercX(c.lon)), ys=cs.map(c=>mercY(c.lat));
  let x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const mx=(x1-x0)*.12, my=(y1-y0)*.12;
  return {x0:x0-mx,y0:y0-my,x1:x1+mx,y1:y1+my};
}
const here=()=>new Promise((res,rej)=>{
  if(S.fix&&Date.now()-S.fix.t<20000) return res(S.fix);
  if(!('geolocation' in navigator)) return rej(new Error('This device has no GPS. Enter coordinates instead.'));
  navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lon:p.coords.longitude}),
    ()=>rej(new Error('Couldn\'t get your location. Enter coordinates instead.')),{enableHighAccuracy:true,timeout:20000,maximumAge:10000});
});

A.aerialSheet=function(fromMap){
  let where=fromMap?'map':'me', width=800;
  const body=h('div',{});
  const coord=h('input',{class:'inp',placeholder:'42.00700, -88.20600'});
  const name=h('input',{class:'inp',placeholder:'Name (optional)',value:fromMap?`${S.map.name} aerial`:''});
  const draw=()=>{
    body.innerHTML='';
    const ch=(opts,cur,fn)=>h('div',{class:'chips'},opts.map(([v,l])=>h('button',{class:'chip'+(v===cur?' on':''),onclick:()=>{ fn(v); draw(); }},l)));
    body.append(h('div',{class:'sec'},'Where'),
      ch([...(fromMap?[['map','This map\'s area']]:[]),['me','Around me'],['typed','Enter coordinates']],where,v=>where=v));
    if(where==='typed') body.append(h('label',{class:'fld',style:{marginTop:'10px'}},h('span',{},'Center: latitude, longitude'),coord));
    if(where!=='map') body.append(h('div',{class:'sec'},'How wide'),ch([[400,'¼ mile'],[800,'½ mile'],[1600,'1 mile'],[3200,'2 miles']],width,v=>width=v));
    body.append(h('label',{class:'fld',style:{marginTop:'14px'}},h('span',{},'Map name'),name),
      h('button',{class:'btn primary wide',onclick:go,html:ICON.globe+'<span>Download aerial</span>'}),
      h('div',{class:'note'},'Free public-domain imagery from USGS, usually one to three years old and about 2 ft per pixel. US only. Needs a connection now; works offline afterwards.'));
  };
  const go=async()=>{
    try{
      let bb, label=name.value.trim();
      if(where==='map') bb=boxOfMap();
      else if(where==='typed'){ const g=parseLatLon(coord.value); if(!g){ toast('Couldn\'t read those coordinates. Try: 42.00700, -88.20600',4200); return; } bb=boxAround(g.lat,g.lon,width); }
      else { A.busy(10,'Finding your location…'); const p=await here(); bb=boxAround(p.lat,p.lon,width); }
      if(!label){ const la=mercLat((bb.y0+bb.y1)/2), lo=mercLon((bb.x0+bb.x1)/2); label=`Aerial ${la.toFixed(4)}, ${lo.toFixed(4)}`; }
      closeSheet();
      const rec=await getAerial(bb,label);
      if(S.map) toast(`${rec.name} saved to your maps`,4000);
      else { await A.renderLib(); await A.openMap(rec); }
    }catch(e){ A.busyOff(); await dialog({title:'Aerial didn\'t download',text:e.message||String(e),cancel:null}); }
  };
  draw();
  sheet('Get aerial imagery',body);
};
export function initAerial(){}
