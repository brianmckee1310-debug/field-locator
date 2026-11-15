/* ============ exports and imports ============ */
import { S, A, ICON, VERSION, DEFAULT_LAYERS, PALETTE } from './state.js';
import { h, uid, toast, sheet, closeSheet, dialog, saveFile, esc } from './ui.js';
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
  const out=[['layer','type','name','notes','latitude','longitude','length_ft','length_yd','length_m','area_acres','area_sqft','area_sqyd','area_m2','gps_accuracy_m','created','wkt']];
  for(const r of rows(data,xf)){ const s=r.st;
    out.push([r.lay.name, r.f.type==='line'&&r.f.arrow?'arrow':r.f.type, r.name, r.f.note, r.lat.toFixed(7), r.lon.toFixed(7),
      s.len!=null?(s.len/0.3048).toFixed(1):'', s.len!=null?(s.len/0.9144).toFixed(1):'', s.len!=null?s.len.toFixed(2):'',
      s.area!=null?(s.area/4046.8564).toFixed(4):'', s.area!=null?(s.area/0.09290304).toFixed(0):'',
      s.area!=null?(s.area/0.83612736).toFixed(1):'', s.area!=null?s.area.toFixed(1):'',
      r.f.gps?r.f.gps.acc.toFixed(1):'', r.f.t?new Date(r.f.t).toISOString():'', wkt(r.geom)]); }
  for(const t of data.tracks){ if(t.pts.length<2) continue;
    const len=trackLen(t);
    out.push(['Trails','trail',t.name,'',t.pts[0][0],t.pts[0][1],(len/0.3048).toFixed(1),(len/0.9144).toFixed(1),len.toFixed(2),'','','','','',new Date(t.start).toISOString(),
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

/* ===================== importing drawings (KML, KMZ, GeoJSON) ===================== */
/* enough of a zip reader for a KMZ, which is one deflated .kml in a zip */
async function unzipKml(bytes){
  const dv=new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eo=-1;
  for(let i=bytes.length-22; i>=Math.max(0,bytes.length-66000); i--)
    if(dv.getUint32(i,true)===0x06054b50){ eo=i; break; }
  if(eo<0) throw new Error('That .kmz could not be opened.');
  const n=dv.getUint16(eo+10,true);
  let p=dv.getUint32(eo+16,true);
  for(let i=0;i<n;i++){
    if(dv.getUint32(p,true)!==0x02014b50) break;
    const method=dv.getUint16(p+10,true), csize=dv.getUint32(p+20,true);
    const nlen=dv.getUint16(p+28,true), elen=dv.getUint16(p+30,true), clen=dv.getUint16(p+32,true);
    const lho=dv.getUint32(p+42,true);
    const name=new TextDecoder().decode(bytes.subarray(p+46,p+46+nlen));
    p+=46+nlen+elen+clen;
    if(!/\.kml$/i.test(name)) continue;
    const lnlen=dv.getUint16(lho+26,true), lelen=dv.getUint16(lho+28,true);
    const data=bytes.subarray(lho+30+lnlen+lelen, lho+30+lnlen+lelen+csize);
    if(method===0) return new TextDecoder().decode(data);
    if(typeof DecompressionStream==='undefined') throw new Error('This browser cannot open a .kmz. Unzip it and import the .kml inside.');
    const buf=await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    return new TextDecoder().decode(buf);
  }
  throw new Error('No .kml was found inside that .kmz.');
}

const okLL = c => Array.isArray(c) && isFinite(c[0]) && isFinite(c[1]) && Math.abs(c[1])<=90 && Math.abs(c[0])<=180;

function fromGeoJSON(j){
  const out=[];
  const txt=v=>v==null?'':String(v);
  const nameOf=p=>txt((p&&(p.name||p.Name||p.NAME||p.title||p.label))||'');
  const noteOf=p=>{
    if(!p) return '';
    if(p.description||p.desc||p.note) return txt(p.description||p.desc||p.note);
    const keep=Object.entries(p).filter(([k])=>!/^(name|Name|NAME|title|label|description|desc|note|styleUrl)$/.test(k));
    return keep.slice(0,8).map(([k,v])=>`${k}: ${txt(v)}`).join('\n');
  };
  const geom=(g,nm,nt)=>{
    if(!g) return;
    const t=g.type, c=g.coordinates;
    if(t==='GeometryCollection'){ (g.geometries||[]).forEach(x=>geom(x,nm,nt)); return; }
    if(t==='Point'){ if(okLL(c)) out.push({kind:'point',coords:[c],name:nm,note:nt}); return; }
    if(t==='MultiPoint'){ (c||[]).forEach(p=>okLL(p)&&out.push({kind:'point',coords:[p],name:nm,note:nt})); return; }
    if(t==='LineString'){ const a=(c||[]).filter(okLL); if(a.length>1) out.push({kind:'line',coords:a,name:nm,note:nt}); return; }
    if(t==='MultiLineString'){ (c||[]).forEach(l=>geom({type:'LineString',coordinates:l},nm,nt)); return; }
    if(t==='Polygon'){ const a=((c||[])[0]||[]).filter(okLL); if(a.length>2) out.push({kind:'polygon',coords:a,name:nm,note:nt}); return; }
    if(t==='MultiPolygon'){ (c||[]).forEach(poly=>geom({type:'Polygon',coordinates:poly},nm,nt)); return; }
  };
  const feat=f=>{ if(!f) return; geom(f.geometry, nameOf(f.properties), noteOf(f.properties)); };
  if(j.type==='FeatureCollection') (j.features||[]).forEach(feat);
  else if(j.type==='Feature') feat(j);
  else geom(j,'','');
  return out;
}

function fromKML(txt){
  const doc=new DOMParser().parseFromString(txt,'application/xml');
  if(doc.getElementsByTagName('parsererror').length) throw new Error('That KML could not be read.');
  const first=(el,tag)=>{ const n=el.getElementsByTagName(tag); return n.length?n[0]:null; };
  const text=(el,tag)=>{ const n=first(el,tag); return n?(n.textContent||'').trim():''; };
  const coords=el=>{
    const c=text(el,'coordinates');
    return c.split(/\s+/).map(s=>s.split(',')).map(a=>[parseFloat(a[0]),parseFloat(a[1])]).filter(okLL);
  };
  const out=[];
  for(const pm of doc.getElementsByTagName('Placemark')){
    const nm=text(pm,'name');
    let nt=text(pm,'description');
    if(!nt){
      const sd=pm.getElementsByTagName('SimpleData');
      nt=[...sd].slice(0,8).map(e=>`${e.getAttribute('name')}: ${(e.textContent||'').trim()}`).join('\n');
    }
    nt=nt.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,600);
    for(const el of pm.getElementsByTagName('Point')){ const c=coords(el); if(c.length) out.push({kind:'point',coords:[c[0]],name:nm,note:nt}); }
    for(const el of pm.getElementsByTagName('LineString')){ const c=coords(el); if(c.length>1) out.push({kind:'line',coords:c,name:nm,note:nt}); }
    for(const el of pm.getElementsByTagName('Polygon')){
      const ob=first(el,'outerBoundaryIs')||el;
      const c=coords(ob); if(c.length>2) out.push({kind:'polygon',coords:c,name:nm,note:nt});
    }
  }
  return out;
}

A.importDrawings=async function(file){
  try{
    if(!S.map){ toast('Open a map first'); return; }
    if(!S.xf){ await dialogNeedsCalib(); return; }
    const nm=(file.name||'').toLowerCase();
    A.busy(20,'Reading…');
    let items;
    if(nm.endsWith('.kmz')) items=fromKML(await unzipKml(new Uint8Array(await file.arrayBuffer())));
    else{
      const txt=await file.text();
      if(nm.endsWith('.kml')||/^\s*<\?xml|<kml/i.test(txt)) items=fromKML(txt);
      else{
        let j; try{ j=JSON.parse(txt); }catch(e){ throw new Error('That file is not KML or GeoJSON.'); }
        if(j&&j.format==='field-locator-site'){ A.busyOff(); await A.importFile(file); return; }
        items=fromGeoJSON(j);
      }
    }
    A.busy(60,'Placing…');
    if(!items.length){ A.busyOff(); await dialog({title:'Nothing to import',text:'No pins, lines or areas were found in that file.',cancel:null}); return; }

    const W=S.map.imgW, H=S.map.imgH, pad=Math.max(W,H)*0.35;
    const name=(file.name||'Imported').replace(/\.[a-z0-9]+$/i,'').replace(/[_-]+/g,' ').trim().slice(0,40)||'Imported';
    const used=S.data.layers.map(l=>l.color);
    const col=PALETTE.find(c=>!used.includes(c)&&c!=='#ffffff')||PALETTE[0];
    let lname=name.slice(0,40);
    for(let i=2; S.data.layers.some(l=>l.name===lname); i++) lname=(name.slice(0,36)+' '+i);
    const layer={id:uid('l'), name:lname, color:col, visible:true};

    let added=0, away=0;
    for(const it of items){
      const pts=it.coords.map(c=>{ const p=S.xf.toPix(c[1],c[0]); return [p.x,p.y]; });
      const inside=pts.some(p=>p[0]>-pad&&p[1]>-pad&&p[0]<W+pad&&p[1]<H+pad);
      if(!inside){ away++; continue; }
      S.data.features.push({ id:uid('f'), type:it.kind, layer:layer.id,
        name:(it.name||'').slice(0,60), note:(it.note||'').slice(0,600), t:Date.now(),
        pts, ...(it.kind==='polygon'?{fill:0.2}:{}) });
      added++;
    }
    A.busyOff();
    if(!added){
      await dialog({title:'Nothing landed on this map',
        text:`All ${items.length} item${items.length===1?'':'s'} sit well outside this map's area. Check it is the right site.`,cancel:null});
      return;
    }
    S.data.layers.push(layer);
    S.data.activeLayer=layer.id;
    A.commit();
    A.render();
    closeSheet();
    toast(`${added} item${added===1?'':'s'} on a new “${layer.name}” layer`+(away?` · ${away} were off this map`:''),5000);
  }catch(err){
    A.busyOff();
    await dialog({title:'Couldn’t import that',text:err.message||String(err),cancel:null});
  }
};
async function dialogNeedsCalib(){
  await dialog({title:'Calibrate first',
    text:'Pins and shapes are placed by their coordinates, so this map needs to be on the ground before anything can be imported onto it.',cancel:null});
}

export function initIO(){}
