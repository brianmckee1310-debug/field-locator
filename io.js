/* ============ exports and imports ============ */
import { S, A, ICON, VERSION, DEFAULT_LAYERS } from './state.js';
import { h, uid, toast, sheet, closeSheet, saveFile, esc } from './ui.js';
import { getMap, getData, putMap, putData } from './store.js';
import { featureStats } from './tools.js';
import { trackLen } from './track.js';

const slug = s => (s||'map').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'map';
const stamp = () => new Date().toISOString().slice(0,10);
const touch = () => matchMedia('(pointer:coarse)').matches;
const r7 = v => +v.toFixed(7);

/* feature -> geographic geometry */
export function featGeom(f,xf){
  const g=p=>{ const q=xf.toGeo(p[0],p[1]); return [r7(q.lon),r7(q.lat)]; };
  if(f.type==='point') return {type:'Point',coords: f.gps?[r7(f.gps.lon),r7(f.gps.lat)]:g(f.pts[0])};
  if(f.type==='text')  return {type:'Point',coords:g(f.pts[0])};
  if(f.type==='line')  return {type:'LineString',coords:f.pts.map(g)};
  let ring;
  if(f.type==='circle'){ ring=[]; for(let i=0;i<48;i++){ const a=i/48*2*Math.PI; ring.push(g([f.pts[0][0]+Math.cos(a)*f.r,f.pts[0][1]+Math.sin(a)*f.r])); } }
  else ring=f.pts.map(g);
  ring.push(ring[0]);
  return {type:'Polygon',coords:[ring]};
}
const wkt = g => g.type==='Point' ? `POINT (${g.coords[0]} ${g.coords[1]})`
  : g.type==='LineString' ? `LINESTRING (${g.coords.map(c=>c.join(' ')).join(', ')})`
  : `POLYGON ((${g.coords[0].map(c=>c.join(' ')).join(', ')}))`;
function rows(data,xf){
  const L=id=>data.layers.find(l=>l.id===id)||data.layers[0];
  return data.features.map(f=>{ const lay=L(f.layer), geom=featGeom(f,xf), st=featureStats(f,xf);
    let c=geom.type==='Point'?geom.coords:null;
    if(!c){ const a=geom.type==='Polygon'?geom.coords[0].slice(0,-1):geom.coords; c=[a.reduce((s,p)=>s+p[0],0)/a.length,a.reduce((s,p)=>s+p[1],0)/a.length]; }
    return {f,lay,geom,st,lat:c[1],lon:c[0],color:f.color||lay.color,name:f.type==='text'?f.text:f.name}; });
}

function csv(data,xf){
  const q=v=>{ v=v==null?'':String(v); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  const out=[['layer','type','name','notes','latitude','longitude','length_ft','length_m','area_acres','area_sqft','area_m2','gps_accuracy_m','created','wkt']];
  for(const r of rows(data,xf)){ const s=r.st;
    out.push([r.lay.name, r.f.type==='line'&&r.f.arrow?'arrow':r.f.type, r.name, r.f.note, r.lat.toFixed(7), r.lon.toFixed(7),
      s.len!=null?(s.len/0.3048).toFixed(1):'', s.len!=null?s.len.toFixed(2):'',
      s.area!=null?(s.area/4046.8564).toFixed(4):'', s.area!=null?(s.area/0.09290304).toFixed(0):'', s.area!=null?s.area.toFixed(1):'',
      r.f.gps?r.f.gps.acc.toFixed(1):'', r.f.t?new Date(r.f.t).toISOString():'', wkt(r.geom)]); }
  for(const t of data.tracks){ if(t.pts.length<2) continue;
    const len=trackLen(t);
    out.push(['Trails','trail',t.name,'',t.pts[0][0],t.pts[0][1],(len/0.3048).toFixed(1),len.toFixed(2),'','','','',new Date(t.start).toISOString(),
      `LINESTRING (${t.pts.map(p=>p[1]+' '+p[0]).join(', ')})`]); }
  return '﻿'+out.map(r=>r.map(q).join(',')).join('\r\n');
}
const kcol=(hex,a=1)=>{ const n=hex.replace('#',''); return Math.round(a*255).toString(16).padStart(2,'0')+n.slice(4,6)+n.slice(2,4)+n.slice(0,2); };
function kml(map,data,xf){
  const cs=a=>a.map(c=>`${c[0]},${c[1]},0`).join(' ');
  let o=`<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(map.name)}</name>\n`;
  const R=rows(data,xf);
  for(const lay of data.layers){
    const mine=R.filter(r=>r.lay===lay); if(!mine.length) continue;
    o+=`<Folder><name>${esc(lay.name)}</name>\n`;
    for(const r of mine){ const f=r.f, w=f.width||3.2;
      o+=`<Placemark><name>${esc(r.name||'')}</name>${f.note?`<description>${esc(f.note)}</description>`:''}`
        +`<Style><IconStyle><color>${kcol(r.color)}</color><scale>1.0</scale><Icon><href>http://maps.google.com/mapfiles/kml/pushpin/wht-pushpin.png</href></Icon></IconStyle>`
        +`<LineStyle><color>${kcol(r.color)}</color><width>${w}</width></LineStyle><PolyStyle><color>${kcol(r.color,f.fill??0.2)}</color></PolyStyle></Style>`;
      if(r.geom.type==='Point') o+=`<Point><coordinates>${r.geom.coords[0]},${r.geom.coords[1]},0</coordinates></Point>`;
      else if(r.geom.type==='LineString') o+=`<LineString><tessellate>1</tessellate><coordinates>${cs(r.geom.coords)}</coordinates></LineString>`;
      else o+=`<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${cs(r.geom.coords[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
      o+=`</Placemark>\n`; }
    o+=`</Folder>\n`;
  }
  const tr=data.tracks.filter(t=>t.pts.length>1);
  if(tr.length){ o+=`<Folder><name>Trails</name>\n`;
    for(const t of tr) o+=`<Placemark><name>${esc(t.name)}</name><description>${esc(new Date(t.start).toLocaleString())}</description><Style><LineStyle><color>${kcol(t.color)}</color><width>3</width></LineStyle></Style>`
      +`<LineString><tessellate>1</tessellate><coordinates>${t.pts.map(p=>`${p[1]},${p[0]},0`).join(' ')}</coordinates></LineString></Placemark>\n`;
    o+=`</Folder>\n`; }
  return o+`</Document></kml>`;
}
function geojson(map,data,xf){
  const feats=rows(data,xf).map(r=>({type:'Feature',id:r.f.id,
    properties:{name:r.name||'',notes:r.f.note||'',layer:r.lay.name,kind:r.f.type==='line'&&r.f.arrow?'arrow':r.f.type,color:r.color,
      ...(r.st.len!=null?{length_m:+r.st.len.toFixed(2)}:{}),...(r.st.area!=null?{area_m2:+r.st.area.toFixed(1)}:{}),
      ...(r.f.gps?{gps_accuracy_m:+r.f.gps.acc.toFixed(1)}:{}),created:r.f.t?new Date(r.f.t).toISOString():null,...(r.f.link?{link:r.f.link}:{})},
    geometry:{type:r.geom.type,coordinates:r.geom.coords}}));
  for(const t of data.tracks) if(t.pts.length>1) feats.push({type:'Feature',id:t.id,
    properties:{name:t.name,layer:'Trails',kind:'trail',color:t.color,length_m:+trackLen(t).toFixed(1),start:new Date(t.start).toISOString(),end:new Date(t.end).toISOString()},
    geometry:{type:'LineString',coordinates:t.pts.map(p=>[p[1],p[0]])}});
  return {type:'FeatureCollection',name:map.name,features:feats};
}
function gpx(map,data,xf,only){
  let o=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Field Locator ${VERSION}" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${esc(map.name)}</name></metadata>\n`;
  if(!only&&xf) for(const r of rows(data,xf)) if(r.f.type==='point')
    o+=`<wpt lat="${r.lat.toFixed(7)}" lon="${r.lon.toFixed(7)}"><name>${esc(r.name||'')}</name>${r.f.note?`<desc>${esc(r.f.note)}</desc>`:''}</wpt>\n`;
  for(const t of (only?[only]:data.tracks)){ if(!t.pts.length) continue;
    o+=`<trk><name>${esc(t.name)}</name><trkseg>`+t.pts.map(p=>`<trkpt lat="${p[0]}" lon="${p[1]}"><time>${new Date(p[2]).toISOString()}</time></trkpt>`).join('')+`</trkseg></trk>\n`; }
  return o+`</gpx>`;
}
A.exportTrackGPX=t=>save(`${slug(t.name)}.gpx`,gpx(S.map,S.data,S.xf,t),'application/gpx+xml');
A.geojsonFor=async function(id){
  const m=await getMap(id); if(!m) return null;
  const d=await getData(id), xf=m.ctrl&&m.ctrl.length>=2?A.fitOf(m):null;
  if(!xf||!d) return null;
  return geojson(m,d,xf);
};

async function save(name,text,type){
  const r=await saveFile(name,new Blob([text],{type}),{share:touch()});
  if(r==='downloaded') toast(`Saved ${name}`);
}

/* ---------- map image with drawings burned in ---------- */
async function exportImage(){
  A.busy(30,'Drawing image…');
  await new Promise(r=>setTimeout(r,30));
  const m=S.map, es=Math.min(1,Math.sqrt(10e6/(m.imgW*m.imgH)));
  const c=document.createElement('canvas'); c.width=Math.round(m.imgW*es); c.height=Math.round(m.imgH*es);
  const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height);
  x.drawImage(S.img,0,0,c.width,c.height);
  const T=(ix,iy)=>({x:ix*es,y:iy*es}), k=Math.max(1,c.width/1300), sel=S.sel; S.sel=null;
  A.paintTracks(x,T,k); A.paintFeatures(x,T,es,k,false); S.sel=sel;
  const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.92));
  A.busyOff();
  const name=`${slug(m.name)}-${stamp()}.jpg`, r=await saveFile(name,blob,{share:touch()});
  if(r==='downloaded') toast(`Saved ${name}`);
}

/* ---------- site file: everything about one map, for another device or person ---------- */
const b64 = blob => new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=rej; fr.readAsDataURL(blob); });
A.exportSite=async function(m){
  A.busy(40,'Packing site file…');
  try{
    if(S.map&&S.map.id===m.id) await A.saveData(true);
    const d=await getData(m.id);
    const out={format:'field-locator-site',version:1,app:VERSION,exported:new Date().toISOString(),
      map:{name:m.name,imgW:m.imgW,imgH:m.imgH,ctrl:m.ctrl,fit:m.fit,geoSrc:m.geoSrc,origCtrl:m.origCtrl||null,origSrc:m.origSrc||null,origFit:m.origFit||null,
           credit:m.credit||null,site:m.site||null,created:m.created,image:await b64(m.blob)},
      data:d?{layers:d.layers,features:d.features,tracks:d.tracks,activeLayer:d.activeLayer}:null};
    const name=`${slug(m.name)}-${stamp()}.fieldmap`;
    A.busyOff();
    const r=await saveFile(name,new Blob([JSON.stringify(out)],{type:'application/json'}),{share:touch()});
    if(r==='downloaded') toast(`Saved ${name}`,3600);
  }catch(e){ A.busyOff(); toast('Couldn\'t export the site file'); }
};
A.importSite=async function(file){
  A.busy(30,'Reading site file…');
  let j; try{ j=JSON.parse(await file.text()); }catch(e){ throw new Error('That file isn\'t a Field Locator site file.'); }
  if(!j||j.format!=='field-locator-site'||!j.map||!j.map.image) throw new Error('That file isn\'t a Field Locator site file.');
  const blob=await (await fetch(j.map.image)).blob();
  const bmp=await createImageBitmap(blob);
  const m=j.map, id=uid('m');
  const rec={id,name:m.name||'Imported map',blob,imgW:m.imgW||bmp.width,imgH:m.imgH||bmp.height,ctrl:m.ctrl||[],fit:m.fit||'similarity',geoSrc:m.geoSrc||null,
    origCtrl:m.origCtrl||null,origSrc:m.origSrc||null,origFit:m.origFit||null,credit:m.credit||null,site:m.site||null,
    thumb:A.makeThumb(bmp,bmp.width,bmp.height),created:Date.now()};
  await putMap(rec);
  if(j.data) await putData({id,layers:j.data.layers&&j.data.layers.length?j.data.layers:DEFAULT_LAYERS(),features:j.data.features||[],tracks:j.data.tracks||[],activeLayer:j.data.activeLayer||'mgmt'});
  return rec;
};

A.exportSheet=function(){
  const geo=!!S.xf, n=S.data.features.length, nt=S.data.tracks.filter(t=>t.pts.length>1).length;
  const base=`${slug(S.map.name)}-${stamp()}`;
  const row=(icon,l1,l2,fn,ok=true)=>h('div',{class:'row'+(ok?' tap':''),style:ok?{}:{opacity:.4},onclick:ok?async()=>{ closeSheet(); await fn(); }:null},
    h('span',{html:ICON[icon]}),h('div',{class:'rm'},h('div',{class:'r1'},l1),h('div',{class:'r2'},l2)));
  sheet('Export and share',h('div',{},
    !geo?h('div',{class:'note'},'Calibrate this map to export coordinates. The image and site file work without it.'):null,
    h('div',{class:'sec'},`${n} drawing${n===1?'':'s'} · ${nt} trail${nt===1?'':'s'}`),
    row('layers','Spreadsheet (CSV)','One row per item, with coordinates, lengths and areas',()=>save(base+'.csv',csv(S.data,S.xf),'text/csv'),geo&&(n||nt)),
    row('globe','Google Earth / GIS (KML)','Pins, shapes and trails with their colors',()=>save(base+'.kml',kml(S.map,S.data,S.xf),'application/vnd.google-earth.kml+xml'),geo&&(n||nt)),
    row('polygon','GeoJSON','For ArcGIS, QGIS and other mapping tools',()=>save(base+'.geojson',JSON.stringify(geojson(S.map,S.data,S.xf)),'application/geo+json'),geo&&(n||nt)),
    row('track','Trails and pins (GPX)','For GPS units and Avenza',()=>save(base+'.gpx',gpx(S.map,S.data,S.xf),'application/gpx+xml'),geo&&(nt||S.data.features.some(f=>f.type==='point'))),
    h('div',{class:'sec'},'Whole map'),
    row('rect','Picture of the map with drawings (JPG)','To text, email or print',exportImage),
    row('share','Site file (.fieldmap)','Map, drawings and trails in one file — open it on your PC or send it to a colleague',()=>A.exportSite(S.map))));
};
export function initIO(){}
