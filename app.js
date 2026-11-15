import { extractGeo, geoScanner, fitTransform, dist } from './geo.js';
import { sheetFit, cropRect, planMosaic, drawMosaic, mosaicCtrl, outliers } from './mosaic.js';
import { listMaps, getMap, putMap, deleteMap, getData, putData } from './store.js';
import { S, A, ICON, VERSION, loadSet, saveSet, DEFAULT_LAYERS, orderLayers } from './state.js';
import { $, h, clamp, uid, toast, sheet, closeSheet, sheetOpen, dialog, fmtLen, fmtLL } from './ui.js';
import { initTools } from './tools.js';
import { initCalib } from './calib.js';
import { initTrack } from './track.js';
import { initIO } from './io.js';
import { initAerial } from './aerial.js';

loadSet();
const cv=$('cv'), ctx=cv.getContext('2d');
let DPR=1, objUrl=null;

/* ===================== busy overlay ===================== */
A.busy=(pct,msg)=>{ $('busy').classList.add('show'); $('pfill').style.width=pct+'%'; if(msg) $('ptxt').textContent=msg; };
A.busyOff=()=>$('busy').classList.remove('show');

/* ===================== map records ===================== */
export function normalizeMap(m){
  if(!m.ctrl){
    if(m.pts && m.frame){
      m.ctrl=m.pts.map(p=>({px:m.frame.x+p.lx*m.frame.w, py:m.frame.y+p.ly*m.frame.h, lat:p.lat, lon:p.lon}));
      m.fit='affine'; m.geoSrc='pdf'; m.origCtrl=m.ctrl.map(c=>({...c})); m.origSrc='pdf'; m.origFit='affine';
    } else { m.ctrl=[]; m.geoSrc=null; }
  }
  if(!m.fit) m.fit='similarity';
  return m;
}
const fitOf = m => m.ctrl && m.ctrl.length>=2 ? fitTransform(m.ctrl, m.fit) : null;
A.fitOf=fitOf;

async function canvasBlob(c){
  let b=await new Promise(r=>c.toBlob(r,'image/webp',.86));
  if(!b || b.type!=='image/webp') b=await new Promise(r=>c.toBlob(r,'image/jpeg',.9));
  return b;
}
function makeThumb(src,w,hh){
  const t=document.createElement('canvas'); t.width=t.height=132;
  const k=Math.max(132/w,132/hh), tw=w*k, th=hh*k;
  const c=t.getContext('2d'); c.fillStyle='#fff'; c.fillRect(0,0,132,132);
  c.drawImage(src,(132-tw)/2,(132-th)/2,tw,th);
  try{ return t.toDataURL('image/jpeg',.72); }catch(e){ return null; }
}
A.canvasBlob=canvasBlob; A.makeThumb=makeThumb;

/* create + store a map from a rendered canvas */
A.addMapFromCanvas=async function(c,{name,ctrl=[],fit='similarity',geoSrc=null,extra={}}){
  const blob=await canvasBlob(c);
  const rec={ id:uid('m'), name:name||'Map', blob, imgW:c.width, imgH:c.height, ctrl, fit, geoSrc,
              origCtrl: geoSrc?ctrl.map(p=>({...p})):null, origSrc:geoSrc, origFit:fit, thumb:makeThumb(c,c.width,c.height), created:Date.now(), ...extra };
  await putMap(rec);
  return rec;
};

/* ===================== library ===================== */
const tagOf = m => m.geoSrc==='mosaic' ? [`${(m.sheets||[]).length||'Multi'} sheets`,'']
                 : m.geoSrc==='pdf' ? ['GeoPDF',''] : m.geoSrc==='aerial' ? ['Aerial','']
                 : (m.ctrl.length>=2 ? ['Calibrated',''] : ['Needs pins','warn']);
async function renderLib(){
  const stored=(await listMaps().catch(()=>[])).map(normalizeMap).sort((a,b)=>b.created-a.created);
  const box=$('cards'); box.innerHTML='';
  $('empty').classList.toggle('gone', stored.length>0);
  /* the search box earns its space once the library is more than a handful */
  $('libsearch').classList.toggle('gone', stored.length<4);
  const q=(stored.length<4?'':($('q').value||'')).trim().toLowerCase();
  $('qx').classList.toggle('gone', !q);
  const shown = q ? stored.filter(m=>(m.name+' '+tagOf(m)[0]+' '+(m.site||'')).toLowerCase().includes(q)) : stored;
  $('nohits').classList.toggle('gone', !(q && !shown.length));
  shown.forEach((m,i)=>{
    const T=fitOf(m), [tag,cls]=tagOf(m);
    const meta = T ? `${fmtLen(T.mPerPx*m.imgW,S.set.units)} × ${fmtLen(T.mPerPx*m.imgH,S.set.units)}` : 'Open to calibrate with pins';
    const card=h('div',{class:'card',style:{animationDelay:(i*50)+'ms'}},
      h('div',{class:'thumb',style:m.thumb?{backgroundImage:`url(${m.thumb})`}:{}}),
      h('div',{class:'cmain',onclick:()=>openMap(m)},
        h('div',{class:'cname'},m.name),
        h('div',{class:'cmeta'}, h('span',{class:'tag '+cls},tag), meta)),
      h('button',{class:'cmore','aria-label':'Map options',onclick:e=>{ e.stopPropagation(); mapOptions(m); }},'⋯'));
    box.append(card);
  });
}
A.renderLib=renderLib;
$('q').addEventListener('input',()=>renderLib());
$('qx').onclick=()=>{ $('q').value=''; renderLib(); $('q').focus(); };

function mapOptions(m){
  const row=(icon,label,fn,cls='')=>h('div',{class:'row tap '+cls,onclick:fn},h('span',{html:ICON[icon]}),h('div',{class:'rm'},h('div',{class:'r1'},label)));
  sheet(m.name, h('div',{},
    row('edit','Rename',async()=>{ closeSheet();
      const r=await dialog({title:'Rename map',fields:[{name:'n',value:m.name}],ok:'Save'});
      if(r&&r.n.trim()){ m.name=r.n.trim(); await putMap(m); renderLib(); } }),
    row('share','Export site file',async()=>{ closeSheet(); await A.exportSite(m); }),
    row('trash','Delete map and its drawings',async()=>{ closeSheet();
      const ok=await dialog({title:'Delete this map?',text:`“${m.name}” and everything drawn on it will be removed from this device.`,ok:'Delete',danger:true});
      if(ok){ await deleteMap(m.id); renderLib(); toast('Map deleted'); } })));
}

/* ===================== import ===================== */
$('addbtn').onclick=()=>$('file').click();
$('aerbtn').onclick=()=>A.aerialSheet();
$('file').onchange=async e=>{ const fs=[...(e.target.files||[])]; e.target.value=''; if(fs.length) await importChosen(fs); };

/* one file is the old path; several PDFs, or one PDF with several map pages,
   can be combined into a single site map */
async function importChosen(files){
  const pdfs=files.filter(f=>/\.pdf$/i.test(f.name||'')||f.type==='application/pdf');
  if(files.length>1){
    if(pdfs.length>1) return combineFlow(pdfs, files.length-pdfs.length);
    for(const f of files) await importFile(f);
    return;
  }
  const f=files[0];
  if(pdfs.length===1){
    try{
      const L=await loadPDF(f);
      if(L.doc.numPages>1) return combineFlow([f], 0, L);
    }catch(err){ /* fall through to the normal importer, which reports properly */ }
  }
  await importFile(f);
}

async function importFile(file){
  const name=(file.name||'').toLowerCase();
  try{
    let rec;
    if(name.endsWith('.fieldmap')||name.endsWith('.json')||file.type==='application/json') rec=await A.importSite(file);
    else if(name.endsWith('.pdf')||file.type==='application/pdf') rec=await importPDF(file);
    else if((file.type||'').startsWith('image/')||/\.(png|jpe?g|webp|gif|bmp)$/.test(name)) rec=await importImage(file);
    else throw new Error('That file type isn\'t supported. Use a PDF, an image, or a .fieldmap site file.');
    A.busyOff(); await renderLib();
    if(rec){
      if(rec.ctrl.length<2){ await openMap(rec); toast('Add pins to place this map on the ground',4200); A.enterCalib(); }
      else toast(`${rec.name} added`,3200);
    }
  }catch(err){
    A.busyOff();
    await dialog({title:'Couldn\'t add that map',text:err.message||String(err),cancel:null});
  }
}
A.importFile=importFile;
const cleanName = n => (n||'Map').replace(/\.[a-z0-9]+$/i,'').replace(/[_-]+/g,' ').trim().slice(0,60)||'Map';
/* one file keeps its own name; several share whatever prefix they have */
function siteName(files){
  const ns=files.map(f=>cleanName(f.name));
  let base = ns.length===1 ? ns[0] : (()=>{
    let i=0; while(i<ns[0].length && ns.every(n=>n[i]&&n[i].toLowerCase()===ns[0][i].toLowerCase())) i++;
    return ns[0].slice(0,i);
  })();
  base=base.replace(/[\s,;:·-]+$/,'').replace(/\s*(sheet|sht|page|pg|map)?\s*\d+$/i,'').trim();
  if(base.length<3 || /^(sheet|sht|page|pg|map|site|plan)$/i.test(base)) return 'Site map';
  return base.slice(0,60);
}

async function loadPDF(file){
  const bytes=new Uint8Array(await file.arrayBuffer());
  const pdfjs=await import('./pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='./pdf.worker.min.mjs';
  const doc=await pdfjs.getDocument({data:bytes.slice(0)}).promise;
  return {bytes, doc, file};
}
/* rotation:0 keeps canvas pixels a plain multiple of PDF points, which is what
   the /BBox neatline and the LPTS corners are measured in */
async function renderPage(doc, pn, {maxPx=12e6, maxDim=4200, unrotated=false}={}){
  const page=await doc.getPage(pn);
  const vw=page.view, wPt=vw[2]-vw[0], hPt=vw[3]-vw[1];
  const scale=Math.min(maxDim/Math.max(wPt,hPt), Math.sqrt(maxPx/(wPt*hPt)));
  const vp=page.getViewport(unrotated?{scale,rotation:0}:{scale});
  const c=document.createElement('canvas');
  c.width=Math.round(vp.width); c.height=Math.round(vp.height);
  const cx=c.getContext('2d',{alpha:false}); cx.fillStyle='#fff'; cx.fillRect(0,0,c.width,c.height);
  await page.render({canvasContext:cx,viewport:vp}).promise;
  return {page, canvas:c, scale, wPt, hPt};
}

async function importPDF(file){
  const {bytes, doc} = await loadPDF(file);
  let pn=1;
  if(doc.numPages>1){
    A.busyOff();
    const r=await dialog({title:'Which page?',text:`This PDF has ${doc.numPages} pages.`,fields:[{name:'p',value:'1',inputMode:'numeric'}],ok:'Use page'});
    if(!r) return null;
    pn=clamp(parseInt(r.p)||1,1,doc.numPages);
  }
  A.busy(24,'Looking for georeferencing…');
  const page=await doc.getPage(pn);
  const vw=page.view, hPt=vw[3]-vw[1];
  /* any page, not just the first: the page object's own /VP says which
     viewport belongs to it */
  const scan=await geoScanner(bytes);
  let geo=await scan.forPage(page.ref, hPt);
  if(!geo && doc.numPages===1) geo=await extractGeo(bytes, hPt);
  A.busy(45,'Rendering map…');
  const R=await renderPage(doc, pn, {unrotated:!!geo});
  A.busy(82,'Saving…');
  let ctrl=[], fit='similarity', geoSrc=null;
  if(geo){
    const f={x:geo.framePt.x*R.scale,y:geo.framePt.y*R.scale,w:geo.framePt.w*R.scale,h:geo.framePt.h*R.scale};
    const cand=geo.pts.map(p=>({px:f.x+p.lx*f.w, py:f.y+p.ly*f.h, lat:p.lat, lon:p.lon}));
    if(fitTransform(cand,'affine')){ ctrl=cand; fit='affine'; geoSrc='pdf'; }
  }
  return A.addMapFromCanvas(R.canvas,{name:cleanName(file.name),ctrl,fit,geoSrc});
}

/* ===================== multi-sheet sites ===================== */
/* a little promise-returning chooser, since dialog() only does text fields */
function pickSheet(title, intro, rows){
  return new Promise(res=>{
    let done=false;
    const fin=v=>{ if(done) return; done=true; closeSheet(); res(v); };
    const body=h('div',{},
      intro?h('div',{class:'note'},intro):null,
      rows.map(r=>h('div',{class:'row tap'+(r.cls?' '+r.cls:''),onclick:()=>fin(r.value)},
        r.icon?h('span',{html:ICON[r.icon]}):null,
        h('div',{class:'rm'},h('div',{class:'r1'},r.label), r.sub?h('div',{class:'r2'},r.sub):null))));
    sheet(title, body, {onclose:()=>fin(null)});
  });
}

const QUALITY=[{mp:14,label:'Standard'},{mp:26,label:'Fine'},{mp:40,label:'Maximum'}];
/* points shaved off each sheet edge to swallow the neatline stroke */
const TRIM_PT=0.6;

async function combineFlow(files, skipped=0, pre=null){
  try{
    A.busy(5,'Reading PDFs…');
    const loads=[];
    for(const f of files){
      const L = (pre && pre.file===f) ? pre : await loadPDF(f);
      L.scan = await geoScanner(L.bytes);
      loads.push(L);
    }
    /* every page of every file is a candidate sheet */
    const entries=[];
    for(const L of loads){
      for(let pn=1; pn<=L.doc.numPages; pn++){
        const page=await L.doc.getPage(pn);
        const vw=page.view, wPt=vw[2]-vw[0], hPt=vw[3]-vw[1];
        entries.push({ L, pn, page, wPt, hPt,
          name: cleanName(L.file.name)+(L.doc.numPages>1?` · p${pn}`:''),
          geo: await L.scan.forPage(page.ref, hPt) });
      }
      A.busy(5+30*(loads.indexOf(L)+1)/loads.length,'Reading georeferencing…');
    }
    /* some writers put the viewports where a page object can't be resolved;
       if nothing matched, fall back to viewports in file order */
    if(!entries.some(e=>e.geo)){
      for(const L of loads){
        const es=entries.filter(e=>e.L===L);
        const all=await L.scan.all(es[0].hPt);
        if(all.length===es.length) es.forEach((e,i)=>e.geo=all[i]);
      }
    }
    const ok=entries.filter(e=>e.geo), bad=entries.filter(e=>!e.geo);
    A.busyOff();

    if(ok.length<2){
      const r=await pickSheet('Not enough georeferenced sheets',
        `Only ${ok.length} of ${entries.length} page${entries.length===1?'':'s'} carries coordinates, so there is nothing to join. Sheets without coordinates can still be added one at a time and placed with pins.`,
        [{icon:'plus',label:'Add them separately',sub:'Each becomes its own map',value:'sep'},
         {icon:'x',label:'Cancel',value:null}]);
      if(r==='sep') for(const f of files) await importFile(f);
      return null;
    }

    /* plan from page geometry alone, so nothing is rendered until he says go */
    const placed=ok.map(e=>{
      const scale=Math.min(4200/Math.max(e.wPt,e.hPt), Math.sqrt(12e6/(e.wPt*e.hPt)));
      const sheet={geo:e.geo, scale, w:Math.round(e.wPt*scale), h:Math.round(e.hPt*scale)};
      return { e, scale, w:sheet.w, h:sheet.h, xf:sheetFit(sheet), crop:cropRect(sheet,TRIM_PT), masks:[] };
    }).filter(p=>p.xf);

    if(placed.length<2){ toast('Those sheets could not be placed on the ground',4200); return null; }

    const odd=outliers(placed);
    const keep=odd.length?placed.filter(p=>!odd.some(o=>o.s===p)):placed;
    const plans=QUALITY.map(q=>({q, plan:planMosaic(keep,{budgetMP:q.mp})}));
    const ftpx=p=>(p.mPerPx/0.3048)<1 ? (p.mPerPx/0.3048).toFixed(2)+' ft/px' : (p.mPerPx/0.3048).toFixed(1)+' ft/px';
    const across=p=>fmtLen(p.widthM,S.set.units)+' × '+fmtLen(p.heightM,S.set.units);

    const intro = `${keep.length} georeferenced sheet${keep.length===1?'':'s'} covering ${across(plans[0].plan)}.`
      + (bad.length?` ${bad.length} page${bad.length===1?'':'s'} without coordinates will be left out.`:'')
      + (odd.length?` ${odd.length} sheet${odd.length===1?'':'s'} sits far from the others and was dropped.`:'')
      + (skipped?` ${skipped} non-PDF file${skipped===1?'':'s'} ignored.`:'')
      + ' Each sheet is cut to its own map frame, so borders, title blocks and margin legends do not come along.';

    const choice=await pickSheet('Combine into one map', intro,
      plans.map(({q,plan})=>({ icon:'polygon', label:q.label,
        sub:`${ftpx(plan)} · ${plan.W.toLocaleString()} × ${plan.H.toLocaleString()} px`,
        value:q.mp })));
    if(choice==null) return null;

    const plan=plans.find(p=>p.q.mp===choice).plan;
    A.busy(8,'Building the site map…');
    const cv=await drawMosaic(keep, plan, {
      onStep:(i,n)=>A.busy(8+84*i/n, n?`Placing sheet ${Math.min(i+1,n)} of ${n}…`:'Placing sheets…'),
      render:async p=>(await renderPage(p.e.L.doc, p.e.pn, {unrotated:true})).canvas
    });
    A.busy(94,'Saving…');
    const ctrl=mosaicCtrl(plan);
    const base=siteName(files);
    const rec=await A.addMapFromCanvas(cv,{
      name: base || 'Site map', ctrl, fit:'affine', geoSrc:'mosaic',
      extra:{ sheets: keep.map(p=>({ name:p.e.name, file:p.e.L.file.name, page:p.e.pn,
                                     crop:p.crop, w:p.w, h:p.h, masks:[] })),
              mosaic:{ mPerPx:plan.mPerPx, latMin:plan.latMin, latMax:plan.latMax,
                       lonMin:plan.lonMin, lonMax:plan.lonMax, budgetMP:choice } }});
    cv.width=cv.height=1;
    A.busyOff();
    await renderLib();
    toast(`${keep.length} sheets joined into “${rec.name}”`,4200);
    return rec;
  }catch(err){
    A.busyOff();
    const big = /TOO_BIG|exceed|memory|allocat/i.test((err&&err.message)||'');
    await dialog({title: big?'That was too big for this device':'Couldn’t combine those sheets',
      text: big ? 'The combined map needed more memory than this phone would give. Try again and pick a lower quality — Standard is usually plenty for finding your way around a site.'
                : (err.message||String(err)), cancel:null});
    return null;
  }
}

async function importImage(file){
  A.busy(20,'Reading image…');
  let bmp;
  try{ bmp=await createImageBitmap(file); }
  catch(e){ throw new Error('That image couldn\'t be read.'); }
  const k=Math.min(1, 4600/Math.max(bmp.width,bmp.height), Math.sqrt(12e6/(bmp.width*bmp.height)));
  const c=document.createElement('canvas'); c.width=Math.round(bmp.width*k); c.height=Math.round(bmp.height*k);
  const cx=c.getContext('2d',{alpha:false}); cx.fillStyle='#fff'; cx.fillRect(0,0,c.width,c.height);
  cx.imageSmoothingQuality='high'; cx.drawImage(bmp,0,0,c.width,c.height);
  A.busy(75,'Saving…');
  return A.addMapFromCanvas(c,{name:cleanName(file.name)});
}

/* ===================== open / close ===================== */
let saveT=null;
A.saveData=function(now){
  if(!S.map||!S.data) return;
  clearTimeout(saveT);
  const id=S.map.id, snap=S.data;
  const go=()=>putData({id, layers:snap.layers, features:snap.features, tracks:snap.tracks, activeLayer:snap.activeLayer}).catch(()=>toast('Couldn\'t save — storage may be full',5000));
  if(now) return go();
  saveT=setTimeout(go,350);
  emit('change');
};
A.saveMap=()=>S.map&&putMap(S.map).catch(()=>{});
A.refit=function(){
  S.xf=fitOf(S.map);
  updateReadout(); render();
};

async function openMap(m){
  normalizeMap(m);
  $('lib').classList.add('gone'); $('mapview').classList.remove('gone');
  S.map=m; S.sel=null; S.mode='map'; S.follow=false; S.fix=null; firstFix=true;
  const d=await getData(m.id).catch(()=>null);
  S.data={ layers:orderLayers((d&&d.layers&&d.layers.length)?d.layers:DEFAULT_LAYERS()), features:(d&&d.features)||[], tracks:(d&&d.tracks)||[],
           activeLayer:(d&&d.activeLayer)||'mgmt' };
  if(!S.data.layers.find(l=>l.id===S.data.activeLayer)) S.data.activeLayer=S.data.layers[0].id;
  S.xf=fitOf(m);
  if(objUrl){ URL.revokeObjectURL(objUrl); objUrl=null; }
  S.img=null;
  const im=new Image(); im.decoding='async';
  await new Promise(r=>{ im.onload=r; im.onerror=r; im.src=(objUrl=URL.createObjectURL(m.blob)); });
  S.img=im;
  if(!m.thumb){ m.thumb=makeThumb(im,m.imgW,m.imgH); A.saveMap(); }
  resize(); fitMap();
  A.toolsOpen(); A.trackOpen();
  $('follow').classList.remove('on'); $('dot').classList.remove('live');
  updateReadout(); render();
  requestAnimationFrame(()=>['bar','hist','scale','zoomwrap','layersb','trackb','follow','dock'].forEach((id,i)=>
    setTimeout(()=>$(id).classList.remove('boot'),40+i*45)));
  startGPS(); emit('open');
}
A.openMap=openMap;

async function closeMap(){
  if(S.mode==='calib') A.exitCalib(true);
  A.trackClose(); closeSheet();
  await A.saveData(true);
  stopGPS(); emit('close');
  S.map=null; S.data=null; S.img=null; S.xf=null;
  $('mapview').classList.add('gone'); $('lib').classList.remove('gone');
  ['bar','hist','scale','zoomwrap','layersb','trackb','follow','dock'].forEach(id=>$(id).classList.add('boot'));
  renderLib();
}
$('back').innerHTML=ICON.back; $('menub').innerHTML=ICON.menu;
$('follow').innerHTML=ICON.target; $('layersb').innerHTML=ICON.layers;
$('trackb').insertAdjacentHTML('afterbegin',ICON.track);
$('undo').innerHTML=ICON.undo; $('redo').innerHTML=ICON.redo;
$('back').onclick=closeMap;

/* ===================== camera ===================== */
function resize(){
  DPR=Math.min(window.devicePixelRatio||1,2.5);
  S.W=cv.clientWidth; S.H=cv.clientHeight;
  cv.width=Math.round(S.W*DPR); cv.height=Math.round(S.H*DPR);
  if(S.map){ clampView(); render(); }
}
const minScale=()=>Math.min(S.W/S.map.imgW, S.H/S.map.imgH);
const maxScale=()=>Math.max(8, minScale()*40);
function fitMap(){ const s=minScale()*0.96; S.view={s, x:(S.W-S.map.imgW*s)/2, y:(S.H-S.map.imgH*s)/2}; }
/* loose limits: you can pan freely as long as a strip of the map stays on screen */
function clampView(){
  const v=S.view, keep=90;
  v.s=clamp(v.s, minScale()*0.5, maxScale());
  v.x=clamp(v.x, keep-S.map.imgW*v.s, S.W-keep);
  v.y=clamp(v.y, keep-S.map.imgH*v.s, S.H-keep);
}
const toScreen=(ix,iy)=>({x:ix*S.view.s+S.view.x, y:iy*S.view.s+S.view.y});
const toImage =(sx,sy)=>({x:(sx-S.view.x)/S.view.s, y:(sy-S.view.y)/S.view.s});
A.toScreen=toScreen; A.toImage=toImage;

let raf=0, anim=null;
function render(){ if(!raf) raf=requestAnimationFrame(frame); }
A.render=render;
function frame(t){
  raf=0;
  if(!S.map) return;
  if(anim){
    const k=clamp((t-anim.t0)/anim.dur,0,1), e=1-Math.pow(1-k,3);
    S.view.s=anim.s0+(anim.s1-anim.s0)*e; S.view.x=anim.x0+(anim.x1-anim.x0)*e; S.view.y=anim.y0+(anim.y1-anim.y0)*e;
    if(k>=1) anim=null; else render();
  }
  draw();
  if(A.animating && A.animating()) render();
}
function animateTo(s,x,y,dur=480){
  const keep={...S.view}; S.view={s,x,y}; clampView(); const tg={...S.view}; S.view=keep;
  anim={t0:performance.now(),dur,s0:keep.s,x0:keep.x,y0:keep.y,s1:tg.s,x1:tg.x,y1:tg.y}; render();
}
function centerOn(ix,iy,s,dur){ s=s??S.view.s; animateTo(s, S.W/2-ix*s, focusY()-iy*s, dur); }
/* vertical centre of the part of the screen not covered by the bottom controls */
function focusY(){ return S.H/2 - 30; }
function zoomAt(sx,sy,f,dur=260){
  const b=toImage(sx,sy), s=clamp(S.view.s*f, minScale()*0.5, maxScale());
  animateTo(s, sx-b.x*s, sy-b.y*s, dur);
}
A.centerOn=centerOn; A.zoomAt=zoomAt;
A.zoomToBox=function(x0,y0,x1,y1){
  const w=Math.max(x1-x0,20), hh=Math.max(y1-y0,20);
  const s=clamp(Math.min(S.W*0.7/w, (S.H-260)*0.8/hh), minScale()*0.5, maxScale()*0.6);
  centerOn((x0+x1)/2,(y0+y1)/2,s);
};
A.fitMap=()=>{ const k={...S.view}; fitMap(); const t={...S.view}; S.view=k; animateTo(t.s,t.x,t.y); };

function draw(){
  const W=S.W,H=S.H,v=S.view;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.fillStyle='#0f1410'; ctx.fillRect(0,0,W,H);
  if(S.img){
    ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality = v.s<1 ? 'high' : 'low';
    ctx.drawImage(S.img, v.x, v.y, S.map.imgW*v.s, S.map.imgH*v.s);
  }
  A.paintTracks(ctx,toScreen,1);
  A.paintFeatures(ctx,toScreen,v.s,1,true);
  A.paintCalib(ctx);
  drawMe(); drawScale();
}

function drawMe(){
  const me=$('me'), acc=$('acc'), off=$('offarrow');
  if(!S.fix||!S.xf){ me.style.display=acc.style.display=off.style.display='none'; return; }
  const p=S.xf.toPix(S.fix.lat,S.fix.lon), s=toScreen(p.x,p.y);
  const on = s.x>-30&&s.y>-30&&s.x<S.W+30&&s.y<S.H+30;
  me.style.display = on?'block':'none';
  me.style.transform=`translate(${s.x}px,${s.y}px)`;
  const cone=me.firstElementChild;
  if(S.fix.heading!=null&&!isNaN(S.fix.heading)){ cone.style.display='block'; cone.style.transform=`rotate(${S.fix.heading}deg)`; }
  else cone.style.display='none';
  const r=S.fix.acc/S.xf.mPerPx*S.view.s;
  if(on && r>14){ acc.style.display='block'; acc.style.width=acc.style.height=(2*r)+'px'; acc.style.transform=`translate(${s.x-r}px,${s.y-r}px)`; }
  else acc.style.display='none';
  if(!on){
    const cx=S.W/2, cy=S.H/2, ang=Math.atan2(s.y-cy,s.x-cx), rr=Math.min(S.W,S.H)/2-44;
    off.style.display='block';
    off.style.transform=`translate(${cx+Math.cos(ang)*rr-15}px,${cy+Math.sin(ang)*rr-15}px) rotate(${ang}rad)`;
  } else off.style.display='none';
}
function drawScale(){
  const sc=$('scale');
  if(!S.xf){ sc.style.visibility='hidden'; return; }
  sc.style.visibility='';
  const metres=Math.min(110,S.W*.28)*S.xf.mPerPx/S.view.s, u=S.set.units;
  const SC = {
    ft:{per:0.3048, steps:[1,2,5,10,25,50,100,200,300,500,1000,2000,5280,10560], big:5280, bigName:'mi', name:'ft'},
    yd:{per:0.9144, steps:[1,2,5,10,25,50,100,200,300,500,880,1760,3520],        big:1760, bigName:'mi', name:'yd'},
    m: {per:1,      steps:[0.5,1,2,5,10,20,50,100,200,500,1000,2000,5000],       big:1000, bigName:'km', name:'m'},
  }[u] || null;
  const C = SC || {per:1,steps:[1,10,100,1000],big:1000,bigName:'km',name:'m'};
  const val = metres/C.per;
  let pick=C.steps[0]; for(const s of C.steps) if(s<=val) pick=s;
  $('sline').style.width=(pick*C.per/S.xf.mPerPx*S.view.s)+'px';
  $('stxt').textContent = pick>=C.big ? (pick/C.big)+' '+C.bigName : pick+' '+C.name;
}

/* ===================== gestures ===================== */
const ptrs=new Map(); let g=null, moved=0, wasMulti=false;
cv.addEventListener('pointerdown',e=>{
  if(e.button>1) return;
  try{ cv.setPointerCapture(e.pointerId); }catch(_){}
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY}); anim=null;
  if(ptrs.size===1){
    moved=0; wasMulti=false;
    const ip=toImage(e.clientX,e.clientY), sp={x:e.clientX,y:e.clientY};
    g = (e.button===0 && S.mode==='map' && A.toolDown(ip,sp,e)) ? {type:'tool'} : {type:'pan'};
  } else if(ptrs.size===2){
    if(g&&g.type==='tool') A.toolCancel();
    wasMulti=true; startPinch();
  }
});
function startPinch(){
  const [a,b]=[...ptrs.values()];
  const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
  g={type:'pinch', d0:Math.hypot(a.x-b.x,a.y-b.y)||1, s0:S.view.s, img:toImage(mx,my)};
}
cv.addEventListener('pointermove',e=>{
  if(e.pointerType==='mouse' && !ptrs.size){ hover(e); return; }
  const p=ptrs.get(e.pointerId); if(!p||!S.map) return;
  const dx=e.clientX-p.x, dy=e.clientY-p.y; p.x=e.clientX; p.y=e.clientY; moved+=Math.hypot(dx,dy);
  if(!g) return;
  if(g.type==='pinch' && ptrs.size>=2){
    /* the map point that was under the fingers stays under the fingers */
    const [a,b]=[...ptrs.values()];
    const d=Math.hypot(a.x-b.x,a.y-b.y), mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
    const s=clamp(g.s0*(d/g.d0), minScale()*0.5, maxScale());
    S.view.s=s; S.view.x=mx-g.img.x*s; S.view.y=my-g.img.y*s;
    setFollow(false); clampView(); render();
  } else if(g.type==='pan'){
    S.view.x+=dx; S.view.y+=dy; if(moved>8) setFollow(false); clampView(); render();
  } else if(g.type==='tool'){
    A.toolMove(toImage(e.clientX,e.clientY),{x:e.clientX,y:e.clientY},e);
  }
});
function up(e){
  if(!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  const sp={x:e.clientX,y:e.clientY}, ip=toImage(sp.x,sp.y);
  if(ptrs.size===1 && g && g.type==='pinch'){ g={type:'pan'}; return; }   // one finger lifted: keep panning with the other
  if(ptrs.size===0){
    if(g&&g.type==='tool') A.toolUp(ip,sp,e);
    else if(g&&g.type==='pan' && moved<8 && !wasMulti && e.type==='pointerup' && S.mode==='map') A.toolTap(ip,sp,e);
    g=null;
  }
}
cv.addEventListener('pointerup',up); cv.addEventListener('pointercancel',up);
cv.addEventListener('wheel',e=>{ e.preventDefault(); if(!S.map) return;
  zoomAt(e.clientX,e.clientY,Math.exp(-e.deltaY*.0022),120); setFollow(false); },{passive:false});
cv.addEventListener('contextmenu',e=>e.preventDefault());
function hover(e){
  if(A.toolHover) A.toolHover(toImage(e.clientX,e.clientY),{x:e.clientX,y:e.clientY});
  if(!S.fix && S.xf){ const ip=toImage(e.clientX,e.clientY), gp=S.xf.toGeo(ip.x,ip.y);
    $('ln1').textContent=fmtLL(gp.lat,gp.lon); $('ln2').textContent='Cursor position'; $('ln2').classList.remove('warn'); }
}
$('zin').onclick=()=>zoomBtn(1.8); $('zout').onclick=()=>zoomBtn(1/1.8);
function zoomBtn(f){
  if(S.follow&&S.fix&&S.xf){ const p=S.xf.toPix(S.fix.lat,S.fix.lon); centerOn(p.x,p.y,clamp(S.view.s*f,minScale()*0.5,maxScale()),260); }
  else zoomAt(S.W/2,focusY(),f);
}

/* ===================== GPS ===================== */
let watchId=null, pollT=null, firstFix=true;
function setFollow(v){ if(S.follow===v) return; S.follow=v; $('follow').classList.toggle('on',v); }
function onMap(){
  if(!S.fix||!S.xf) return false;
  const p=S.xf.toPix(S.fix.lat,S.fix.lon);
  return p.x>=0&&p.y>=0&&p.x<=S.map.imgW&&p.y<=S.map.imgH;
}
function meCenter(zoomIn){
  const p=S.xf.toPix(S.fix.lat,S.fix.lon);
  const s = zoomIn ? Math.max(S.view.s, Math.min(maxScale()*0.5, minScale()*3.4)) : S.view.s;
  centerOn(p.x,p.y,s);
}
$('follow').onclick=()=>{
  if(!S.xf){ toast('Calibrate this map first'); return; }
  if(!S.fix){ toast('No GPS fix yet — hold on a moment.'); return; }
  setFollow(true); meCenter(true);
};
function onPos(pos){
  const c=pos.coords;
  S.fix={lat:c.latitude, lon:c.longitude, acc:c.accuracy||15, heading:(c.speed!=null&&c.speed>0.6&&c.heading!=null)?c.heading:null, t:pos.timestamp||Date.now()};
  $('dot').classList.add('live');
  updateReadout();
  for(const fn of S.fixListeners) try{ fn(S.fix); }catch(e){}
  if(S.xf){
    if(firstFix){
      firstFix=false;
      if(onMap()){ setFollow(true); meCenter(true); toast(`GPS locked · ±${fmtLen(S.fix.acc,S.set.units)}`); }
      else toast('You\'re not on this map right now',3600);
    } else if(S.follow && !ptrs.size) meCenter(false);
  }
  render();
}
function onPosErr(err){
  const m = err.code===1 ? 'Location is blocked — allow it for this site in your browser settings.'
          : err.code===2 ? 'No position yet. A first GPS fix can take up to a minute in the open.'
          : 'GPS timed out — still trying.';
  if(!S.fix){ $('ln1').textContent='No GPS'; $('ln2').textContent=m; $('ln2').classList.add('warn'); }
  if(err.code===1) toast(m,5500);
}
const GEO={enableHighAccuracy:true, maximumAge:1500, timeout:27000};
function startGPS(){
  stopGPS();
  if(!('geolocation' in navigator)) return;
  if(S.set.saver && A.isRecording && A.isRecording()){
    const poll=()=>navigator.geolocation.getCurrentPosition(onPos,onPosErr,{...GEO,maximumAge:0});
    poll(); pollT=setInterval(poll, Math.max(5,S.set.interval)*1000);
  } else watchId=navigator.geolocation.watchPosition(onPos,onPosErr,GEO);
}
function stopGPS(){
  if(watchId!=null){ navigator.geolocation.clearWatch(watchId); watchId=null; }
  if(pollT){ clearInterval(pollT); pollT=null; }
}
A.restartGPS=()=>{ if(S.map) startGPS(); };

function updateReadout(){
  if(!S.map) return;
  const l1=$('ln1'), l2=$('ln2');
  if(!S.xf){
    l1.textContent=S.map.name; l2.textContent='Not calibrated · tap to add pins'; l2.classList.add('warn'); return;
  }
  if(!S.fix){ l1.textContent='Waiting for GPS…'; l2.textContent=S.map.name; l2.classList.remove('warn'); return; }
  l1.textContent=fmtLL(S.fix.lat,S.fix.lon);
  const acc='±'+fmtLen(S.fix.acc,S.set.units);
  if(onMap()){ l2.classList.remove('warn'); l2.textContent=`${acc} · ${S.map.name}`; }
  else{
    const c=S.xf.toGeo(S.map.imgW/2,S.map.imgH/2);
    l2.classList.add('warn'); l2.textContent=`${acc} · off map, ${fmtLen(dist(S.fix.lat,S.fix.lon,c.lat,c.lon),S.set.units)} away`;
  }
}
A.updateReadout=updateReadout;
$('readout').onclick=async()=>{
  if(!S.xf){ A.enterCalib(); return; }
  if(S.fix){ try{ await navigator.clipboard.writeText(fmtLL(S.fix.lat,S.fix.lon)); toast('Coordinates copied'); }catch(e){} }
};

/* ===================== menu ===================== */
$('menub').onclick=menu;
function menu(){
  const row=(icon,l1,l2,fn)=>h('div',{class:'row tap',onclick:fn},h('span',{html:ICON[icon]}),
      h('div',{class:'rm'},h('div',{class:'r1'},l1), l2?h('div',{class:'r2'},l2):null));
  const calTxt = !S.xf ? 'Not calibrated yet' : S.map.geoSrc==='pdf' ? 'Georeferenced from the PDF'
               : S.map.geoSrc==='aerial' ? 'Georeferenced aerial' : `${S.map.ctrl.length} pins`+(S.xf.rms!=null?` · typical error ${fmtLen(S.xf.rms,S.set.units)}`:'');
  const unit=u=>h('button',{class:'chip'+(S.set.units===u?' on':''),onclick:e=>{ S.set.units=u; saveSet(); updateReadout(); A.refreshCtx(); render(); e.currentTarget.parentNode.querySelectorAll('.chip').forEach(c=>c.classList.remove('on')); e.currentTarget.classList.add('on'); }},{ft:'Feet / acres',yd:'Yards / sq yd',m:'Meters / hectares'}[u]);
  const lab=h('button',{class:'tog'+(S.set.labels?' on':''),onclick:()=>{ S.set.labels=!S.set.labels; lab.classList.toggle('on',S.set.labels); saveSet(); render(); }});
  sheet(S.map.name, h('div',{},
    row('share','Export and share','CSV, KML, GeoJSON, GPX, image, site file',()=>A.exportSheet()),
    row('calib','Calibrate',calTxt,()=>{ closeSheet(); A.enterCalib(); }),
    row('track','Breadcrumb trails',`${S.data.tracks.length} saved`,()=>A.trackSheet()),
    S.xf?row('globe','Get aerial of this area','Free USGS imagery, saved for offline',()=>A.aerialSheet(true)):null,
    row('edit','Rename map',null,async()=>{ closeSheet();
      const r=await dialog({title:'Rename map',fields:[{name:'n',value:S.map.name}],ok:'Save'});
      if(r&&r.n.trim()){ S.map.name=r.n.trim(); A.saveMap(); updateReadout(); } }),
    row('polygon','Show whole map',null,()=>{ closeSheet(); setFollow(false); A.fitMap(); }),
    h('div',{class:'sec'},'Units'), h('div',{class:'chips'},unit('ft'),unit('yd'),unit('m')),
    h('div',{class:'sec'},'Display'),
    h('div',{class:'row'},h('div',{class:'rm'},h('div',{class:'r1'},'Show names on the map')),lab),
    h('div',{class:'note'},`Field Locator ${VERSION}`+(S.map.credit?` · ${S.map.credit}`:''))));
}

/* ===================== events / embed API (for the FQA merge) ===================== */
const listeners={};
function emit(type){
  const detail={type, mapId:S.map&&S.map.id};
  (listeners[type]||[]).forEach(fn=>{ try{ fn(detail); }catch(e){} });
  if(window.parent!==window) try{ window.parent.postMessage({source:'field-locator',...detail},'*'); }catch(e){}
}
window.FieldLocator={
  version:VERSION,
  on(type,fn){ (listeners[type]=listeners[type]||[]).push(fn); },
  async listMaps(){ return (await listMaps()).map(normalizeMap).map(m=>({id:m.id,name:m.name,imgW:m.imgW,imgH:m.imgH,calibrated:m.ctrl.length>=2,geoSrc:m.geoSrc,created:m.created,site:m.site||null})); },
  async getSite(id){ const m=await getMap(id); if(!m) return null; normalizeMap(m); const d=await getData(id);
    return {map:{id:m.id,name:m.name,ctrl:m.ctrl,fit:m.fit,geoSrc:m.geoSrc,site:m.site||null}, data:d||null}; },
  async toGeoJSON(id){ return A.geojsonFor(id); },
  async open(id){ const m=await getMap(id); if(m) await openMap(m); return !!m; },
  _S:S, _A:A,
};

/* ===================== boot ===================== */
initTools(); initCalib(); initTrack(); initIO(); initAerial();
window.addEventListener('resize',resize);
window.addEventListener('orientationchange',()=>setTimeout(resize,260));
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('visibilitychange',()=>{ if(document.hidden&&S.map) A.saveData(true); });
window.addEventListener('pagehide',()=>{ if(S.map) A.saveData(true); });
window.addEventListener('keydown',e=>{
  if(!S.map || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if(document.querySelector('.dlg.show')) return;
  if(A.toolKey && A.toolKey(e)) e.preventDefault();
});
resize(); renderLib();
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
  let had=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(had) toast('Updated — reopen the app to use the new version',5000); had=true; });
}
