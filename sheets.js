/* ============ the sheets behind a combined map ============
   Hiding a key that sits inside a sheet's own map frame, turning a sheet
   off, and rebuilding the mosaic at another quality. Everything here works
   from what the map record already carries: each sheet's control points,
   its crop, its masks, and the original PDFs.                            */

import { S, A, ICON } from './state.js';
import { $, h, toast, sheet, closeSheet, dialog, fmtLen } from './ui.js';
import { fitTransform } from './geo.js';
import { planMosaic, drawMosaic, mosaicCtrl } from './mosaic.js';

const QUALITY=[{mp:14,label:'Standard'},{mp:26,label:'Fine'},{mp:40,label:'Maximum'}];
const sheetXf = s => fitTransform(s.ctrl,'affine');
const ftpx = m => (m/0.3048)<1 ? (m/0.3048).toFixed(2)+' ft/px' : (m/0.3048).toFixed(1)+' ft/px';
const live = m => (m.sheets||[]).filter(s=>s.visible!==false);

function dirty(on){
  const m=S.map; if(!m||!m.mosaic) return false;
  if(on!==undefined){ m.mosaic.dirty=on; A.saveMap(); }
  return !!m.mosaic.dirty;
}

/* ---------------- the panel ---------------- */
export function openSheets(){
  const m=S.map;
  if(!m||!m.sheets||!m.sheets.length){ toast('This map was not built from sheets'); return; }
  const body=h('div',{});
  const draw=()=>{
    body.innerHTML='';
    body.append(h('div',{class:'sec'},'Sheets in this map'));
    m.sheets.forEach(s=>{
      const nm=(s.masks||[]).length, off=s.visible===false;
      body.append(h('div',{class:'row'+(off?' dim':'')},
        h('span',{html:ICON.polygon}),
        h('div',{class:'rm'},
          h('div',{class:'r1'},s.name),
          h('div',{class:'r2'}, [s.file, s.page>1?`page ${s.page}`:null,
            nm?`${nm} mask${nm>1?'s':''}`:null, off?'hidden':null].filter(Boolean).join(' · '))),
        nm?h('button',{class:'rbtn',title:'Clear this sheet’s masks',html:ICON.trash,
          onclick:()=>{ s.masks=[]; dirty(true); draw(); }}):null,
        h('button',{class:'rbtn'+(off?' off':''),title:'Show or hide this sheet',
          html:ICON[off?'eyeoff':'eye'],
          onclick:()=>{ s.visible=off; dirty(true); draw(); }})));
    });

    body.append(h('div',{class:'row tap',onclick:()=>{ closeSheet(); enterMask(); }},
      h('span',{html:ICON.rect}),
      h('div',{class:'rm'},h('div',{class:'r1'},'Hide a key or inset'),
        h('div',{class:'r2'},'Drag a box over it on the map'))));

    body.append(h('div',{class:'sec'},'Rebuild'));
    const cur=m.mosaic||{};
    for(const q of QUALITY){
      const on = cur.budgetMP===q.mp;
      body.append(h('div',{class:'row tap'+(on&&!dirty()?' act':''),
        onclick:()=>{ closeSheet(); rebuild(q.mp); }},
        h('span',{html:ICON.polygon}),
        h('div',{class:'rm'},h('div',{class:'r1'},q.label),
          h('div',{class:'r2'}, on?`current · ${ftpx(cur.mPerPx||0)}`:'Rebuild at this quality'))));
    }
    body.append(h('div',{class:'note'}, dirty()
      ? 'Masks and hidden sheets only show up once you rebuild.'
      : `Built at ${ftpx(cur.mPerPx||0)} · ${m.imgW.toLocaleString()} × ${m.imgH.toLocaleString()} px from ${live(m).length} sheet${live(m).length===1?'':'s'}.`));
    if(!m.sources||!m.sources.length)
      body.append(h('div',{class:'note'},'The original PDFs are not stored with this map, so it cannot be rebuilt. Import the sheets again to change anything.'));
  };
  draw();
  sheet('Sheets', body);
}

/* ---------------- masking a key ---------------- */
export function enterMask(){
  const m=S.map;
  if(!m||!m.sheets) return;
  S.maskMode=true; S.sel=null;
  A.setTool('rect');
  A.refreshCtx(); A.render();
  toast('Drag a box over the key you want hidden',4200);
}
export function exitMask(){
  if(!S.maskMode) return;
  S.maskMode=false; A.setTool('select'); A.refreshCtx(); A.render();
}

/* a,b are image pixels on the mosaic. Work out which sheet that patch came
   from and store the rectangle in THAT sheet's own pixel space, so it
   survives a rebuild at a different resolution. */
export async function addMask(a,b){
  const m=S.map;
  S.maskMode=false; A.setTool('select');
  if(!m||!m.sheets||!S.xf){ A.refreshCtx(); A.render(); return; }
  const mid=S.xf.toGeo((a.x+b.x)/2,(a.y+b.y)/2);
  let hit=null;
  for(let i=m.sheets.length-1;i>=0;i--){          // topmost sheet wins, as when drawn
    const s=m.sheets[i]; if(s.visible===false) continue;
    const xf=sheetXf(s); if(!xf) continue;
    const p=xf.toPix(mid.lat,mid.lon), c=s.crop;
    if(p.x>=c.x && p.x<=c.x+c.w && p.y>=c.y && p.y<=c.y+c.h){ hit={s,xf}; break; }
  }
  A.refreshCtx(); A.render();
  if(!hit){ toast('That spot is not on any sheet'); return; }
  const ps=[[a.x,a.y],[b.x,a.y],[b.x,b.y],[a.x,b.y]]
    .map(([x,y])=>S.xf.toGeo(x,y)).map(g=>hit.xf.toPix(g.lat,g.lon));
  const xs=ps.map(p=>p.x), ys=ps.map(p=>p.y);
  const r={ x:Math.min(...xs), y:Math.min(...ys),
            w:Math.max(...xs)-Math.min(...xs), h:Math.max(...ys)-Math.min(...ys) };
  if(r.w<2||r.h<2){ toast('That box was too small'); return; }
  (hit.s.masks = hit.s.masks||[]).push(r);
  dirty(true);
  const go=await dialog({title:'Hidden on '+hit.s.name,
    text:'The map has to be rebuilt for this to show. That takes a few seconds.',
    ok:'Rebuild now', cancel:'Later'});
  if(go) rebuild((m.mosaic&&m.mosaic.budgetMP)||26);
}

/* ---------------- rebuild ---------------- */
/* Feature geometry is stored in image pixels, so a rebuild at a different
   resolution would silently move every drawing. Everything is carried
   across through ground coordinates instead. */
function remap(oldXf, newXf, data){
  if(!oldXf||!newXf||!data) return 0;
  const k=oldXf.mPerPx/newXf.mPerPx;
  let n=0;
  for(const f of data.features||[]){
    if(f.pts) f.pts=f.pts.map(([x,y])=>{
      const g=oldXf.toGeo(x,y), p=newXf.toPix(g.lat,g.lon);
      return [p.x,p.y];
    });
    if(f.r!=null) f.r*=k;
    if(f.size!=null) f.size*=k;
    if(f.width!=null) f.width*=1;    // stroke width is screen-space, left alone
    n++;
  }
  return n;
}

export async function rebuild(budgetMP){
  const m=S.map;
  if(!m||!m.sheets){ return; }
  if(!m.sources||!m.sources.length){
    await dialog({title:'Nothing to rebuild from',
      text:'The original PDFs are not stored with this map. Import the sheets again to change it.',cancel:null});
    return;
  }
  const keep=live(m);
  if(keep.length<1){ toast('Turn at least one sheet back on'); return; }
  try{
    A.busy(4,'Opening the original sheets…');
    const docs={};
    for(const src of m.sources){
      if(!keep.some(s=>s.file===src.name)) continue;
      docs[src.name]=await A.pdfDoc(src.blob);
    }
    const missing=keep.filter(s=>!docs[s.file]);
    if(missing.length) throw new Error(`“${missing[0].file}” is not stored with this map.`);

    const placed=keep.map(s=>({ s, xf:sheetXf(s), crop:s.crop, masks:s.masks||[] }))
                     .filter(p=>p.xf);
    if(!placed.length) throw new Error('None of these sheets can be placed on the ground.');
    const plan=planMosaic(placed,{budgetMP});
    A.busy(8,'Rebuilding…');
    const cv=await drawMosaic(placed, plan, {
      onStep:(i,n)=>A.busy(8+80*i/n, `Placing sheet ${Math.min(i+1,n)} of ${n}…`),
      /* the same fixed scale the sheet was planned at, so its stored crop and
         masks still line up */
      render:async p=>(await A.renderPage(docs[p.s.file], p.s.page,
                        {unrotated:true, scale:p.s.scale})).canvas
    });
    A.busy(90,'Saving…');
    const oldXf=S.xf;
    const ctrl=mosaicCtrl(plan);
    const newXf=fitTransform(ctrl,'affine');
    const blob=await A.canvasBlob(cv);
    if(!blob) throw new Error('TOO_BIG');

    const moved=remap(oldXf,newXf,S.data);
    m.blob=blob; m.imgW=cv.width; m.imgH=cv.height;
    m.ctrl=ctrl; m.origCtrl=ctrl.map(c=>({...c})); m.fit='affine'; m.origFit='affine';
    m.thumb=A.makeThumb(cv,cv.width,cv.height);
    m.mosaic={ mPerPx:plan.mPerPx, latMin:plan.latMin, latMax:plan.latMax,
               lonMin:plan.lonMin, lonMax:plan.lonMax, budgetMP,
               trimPt:(m.mosaic&&m.mosaic.trimPt)||0, W:plan.W, H:plan.H, dirty:false };
    cv.width=cv.height=1;
    await A.saveMap();
    if(moved) await A.saveData(true);
    A.busyOff();
    await A.openMap(m);
    await A.renderLib();
    toast(`Rebuilt from ${placed.length} sheet${placed.length===1?'':'s'} · ${ftpx(plan.mPerPx)}`,4200);
  }catch(err){
    A.busyOff();
    const big=/TOO_BIG|exceed|memory|allocat/i.test((err&&err.message)||'');
    await dialog({title: big?'That was too big for this device':'Couldn’t rebuild',
      text: big ? 'Try a lower quality — Standard is usually plenty for finding your way around a site.'
                : (err.message||String(err)), cancel:null});
  }
}

export function initSheets(){
  A.openSheets=openSheets;
  A.addMask=addMask;
  A.enterMask=enterMask;
  A.exitMask=exitMask;
}
