/* ============ the sheets behind a combined map ============
   Hiding a key that sits inside a sheet's own map frame, turning a sheet
   off, and rebuilding the mosaic at another quality. Everything here works
   from what the map record already carries: each sheet's control points,
   its crop, its masks, and the original PDFs.                            */

import { S, A, ICON } from './state.js';
import { $, h, toast, sheet, closeSheet, dialog, fmtLen } from './ui.js';
import { fitTransform } from './geo.js';
import { planMosaic, drawMosaic, mosaicCtrl, frameOf, cropFromFrame, DEFAULT_TRIM_PT, TRIM_STEPS } from './mosaic.js';

const QUALITY=[{mp:14,label:'Standard'},{mp:26,label:'Fine'},{mp:40,label:'Maximum'}];
const sheetXf = s => fitTransform(s.ctrl,'affine');
const ftpx = m => (m/0.3048)<1 ? (m/0.3048).toFixed(2)+' ft/px' : (m/0.3048).toFixed(1)+' ft/px';
const live = m => (m.sheets||[]).filter(s=>s.visible!==false);

function dirty(on){
  const m=S.map; if(!m||!m.mosaic) return false;
  if(on!==undefined){ m.mosaic.dirty=on; A.saveMap(); }
  return !!m.mosaic.dirty;
}

/* ---------------- small helpers ---------------- */
const trimOf = m => (m.mosaic && m.mosaic.trimPt!=null) ? m.mosaic.trimPt : DEFAULT_TRIM_PT;
/* ground metres per PDF point on a sheet */
const mPerPt = s => { const xf=sheetXf(s); return xf ? xf.mPerPx*s.scale : 0; };
export function applyTrim(m, pt){
  for(const s of m.sheets) if(!s.hand) s.crop=cropFromFrame(frameOf(s), pt*s.scale, s.w, s.h);
  m.mosaic.trimPt=pt;
}
/* move sheet i one step up (+1) or down (-1) the stack; the LAST sheet is drawn last, so it is on top */
export function moveSheet(m, i, dir){
  const j=i+dir;
  if(j<0||j>=m.sheets.length) return false;
  [m.sheets[i],m.sheets[j]]=[m.sheets[j],m.sheets[i]];
  return true;
}
function choose(title, intro, rows){
  return new Promise(res=>{
    let done=false;
    const fin=v=>{ if(done) return; done=true; closeSheet(); res(v); };
    sheet(title, h('div',{},
      intro?h('div',{class:'note'},intro):null,
      rows.map(r=>h('div',{class:'row tap',onclick:()=>fin(r.value)},
        r.icon?h('span',{html:ICON[r.icon]}):null,
        h('div',{class:'rm'},h('div',{class:'r1'},r.label), r.sub?h('div',{class:'r2'},r.sub):null)))),
      {onclose:()=>fin(undefined)});
  });
}

/* ---------------- the panel ---------------- */
export function openSheets(){
  const m=S.map;
  if(!m||!m.sheets||!m.sheets.length){ toast('This map was not built from sheets'); return; }
  const body=h('div',{});
  const key=new WeakMap(); let kn=0;
  m.sheets.forEach(s=>key.set(s,'k'+(kn++)));
  const canEdit=!!(m.sources&&m.sources.length);

  const draw=(flip)=>{
    /* FLIP: remember where each row was, redraw, then let it glide to its new place */
    const was={};
    if(flip) body.querySelectorAll('[data-k]').forEach(e=>was[e.dataset.k]=e.getBoundingClientRect().top);
    body.innerHTML='';
    body.append(h('div',{class:'sec'},'Sheets · top of the list is drawn on top'));
    const n=m.sheets.length;
    for(let i=n-1;i>=0;i--){
      const s=m.sheets[i];
      const nm=(s.masks||[]).length, off=s.visible===false;
      const row=h('div',{class:'row shrow'+(off?' dim':''),'data-k':key.get(s)},
        h('div',{class:'ord'},
          h('button',{class:'rbtn sm',title:'Move up — draws over the sheets below',disabled:i===n-1,html:ICON.up,
            onclick:()=>{ if(moveSheet(m,i,1)){ dirty(true); draw(true); } }}),
          h('button',{class:'rbtn sm',title:'Move down',disabled:i===0,html:ICON.down,
            onclick:()=>{ if(moveSheet(m,i,-1)){ dirty(true); draw(true); } }})),
        h('div',{class:'rm'},
          h('div',{class:'r1'},s.name),
          h('div',{class:'r2'}, [s.page>1||n>1?`page ${s.page}`:s.file, i===n-1?'on top':null, s.hand?'cropped by hand':null,
            nm?`${nm} mask${nm>1?'s':''}`:null, off?'hidden':null].filter(Boolean).join(' · '))),
        nm?h('button',{class:'rbtn',title:'Clear this sheet’s masks',html:ICON.trash,
          onclick:()=>{ s.masks=[]; dirty(true); draw(); }}):null,
        canEdit?h('button',{class:'rbtn'+(s.hand?' on':''),title:'Crop this sheet by hand',html:ICON.crop,
          onclick:()=>{ closeSheet(); openCrop(s); }}):null,
        h('button',{class:'rbtn'+(off?' off':''),title:'Show or hide this sheet',
          html:ICON[off?'eyeoff':'eye'],
          onclick:()=>{ s.visible=off; dirty(true); draw(); }}));
      body.append(row);
    }
    if(flip) body.querySelectorAll('[data-k]').forEach(e=>{
      const d=(was[e.dataset.k]??e.getBoundingClientRect().top)-e.getBoundingClientRect().top;
      if(!d) return;
      e.style.transition='none'; e.style.transform=`translateY(${d}px)`;
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        e.style.transition='transform .34s var(--ease)'; e.style.transform='';
      }));
    });

    body.append(h('div',{class:'row tap',onclick:()=>{ closeSheet(); enterMask(); }},
      h('span',{html:ICON.rect}),
      h('div',{class:'rm'},h('div',{class:'r1'},'Hide a key or inset'),
        h('div',{class:'r2'},'Drag a box over it on the map'))));

    /* edge trim */
    const t=trimOf(m), ti=TRIM_STEPS.reduce((b,v,k)=>Math.abs(v-t)<Math.abs(TRIM_STEPS[b]-t)?k:b,0);
    const mpp=Math.max(...m.sheets.map(mPerPt));
    const step=d=>{ const k=ti+d; if(k<0||k>=TRIM_STEPS.length) return;
      applyTrim(m,TRIM_STEPS[k]); dirty(true); draw(); };
    body.append(h('div',{class:'row'},
      h('span',{html:ICON.crop}),
      h('div',{class:'rm'},h('div',{class:'r1'},'Edge trim'),
        h('div',{class:'r2'}, t ? `${t} pt off every edge · ${fmtLen(t*mpp,S.set.units)} of ground` : 'Off — sheets cut exactly on their frame')),
      h('button',{class:'rbtn',title:'Trim less',disabled:ti===0,html:ICON.minus,onclick:()=>step(-1)}),
      h('button',{class:'rbtn',title:'Trim more',disabled:ti===TRIM_STEPS.length-1,html:ICON.plus,onclick:()=>step(1)})));
    body.append(h('div',{class:'note tight'},'Raise it if a thin border line shows where two sheets meet; lower it if a white hairline does.'));

    body.append(h('div',{class:'sec'},'Rebuild'));
    const cur=m.mosaic||{};
    for(const q of QUALITY){
      const on = cur.budgetMP===q.mp;
      body.append(h('div',{class:'row tap'+(on&&!dirty()?' act':'')+(on&&dirty()?' due':''),
        onclick:()=>{ closeSheet(); rebuild(q.mp); }},
        h('span',{html:ICON.polygon}),
        h('div',{class:'rm'},h('div',{class:'r1'},q.label),
          h('div',{class:'r2'}, on?(dirty()?'Tap to apply your changes':`current · ${ftpx(cur.mPerPx||0)}`):'Rebuild at this quality'))));
    }
    body.append(h('div',{class:'note'}, dirty()
      ? 'Order, trim, crops, masks and hidden sheets only show up once you rebuild.'
      : `Built at ${ftpx(cur.mPerPx||0)} · ${m.imgW.toLocaleString()} × ${m.imgH.toLocaleString()} px from ${live(m).length} sheet${live(m).length===1?'':'s'}.`));
    if(!canEdit)
      body.append(h('div',{class:'note'},'The original PDFs are not stored with this map, so it cannot be rebuilt. Import the sheets again to change anything.'));
  };
  draw();
  sheet('Sheets', body);
}

/* ---------------- cropping one sheet by hand ---------------- */
/* The mosaic only shows whichever sheet is on top, so a sheet is cropped on
   its own page: rendered small from the stored PDF, with a box to drag.   */
export async function openCrop(s){
  const m=S.map;
  const src=(m.sources||[]).find(x=>x.name===s.file);
  if(!src){ toast('The original PDF is not stored with this map'); return; }
  let cv;
  try{
    A.busy(30,'Opening '+s.name+'…');
    const doc=await A.pdfDoc(src.blob);
    const ps=Math.min(s.scale, 1500/Math.max(s.w,s.h)*s.scale);
    cv=(await A.renderPage(doc, s.page, {unrotated:true, scale:ps})).canvas;
    A.busyOff();
  }catch(err){ A.busyOff(); toast('Couldn’t open that sheet'); return; }

  const fr=frameOf(s), auto=cropFromFrame(fr, trimOf(m)*s.scale, s.w, s.h);
  let r={...s.crop}, hand=!!s.hand;                 // sheet pixels throughout
  const stage=h('div',{class:'cstage'}), wrap=h('div',{class:'cwrap'}), box=h('div',{class:'cbox'});
  const info=h('div',{class:'cinfo'});
  cv.className='ccv';
  wrap.append(cv, box);
  (s.masks||[]).forEach(k=>wrap.append(h('div',{class:'cmask','data-m':'1'})));
  stage.append(wrap);
  let k=1;                                          // screen px per sheet px
  const lay=()=>{
    const W=stage.clientWidth-28, H=stage.clientHeight-28;
    k=Math.min(W/s.w, H/s.h);
    wrap.style.width=s.w*k+'px'; wrap.style.height=s.h*k+'px';
    box.style.left=r.x*k+'px'; box.style.top=r.y*k+'px';
    box.style.width=r.w*k+'px'; box.style.height=r.h*k+'px';
    wrap.querySelectorAll('[data-m]').forEach((e,i)=>{ const q=s.masks[i];
      Object.assign(e.style,{left:q.x*k+'px',top:q.y*k+'px',width:q.w*k+'px',height:q.h*k+'px'}); });
    const mp=mPerPt(s)/s.scale;                     // metres per sheet px
    info.textContent=`${fmtLen(r.w*mp,S.set.units)} × ${fmtLen(r.h*mp,S.set.units)}`+(hand?' · by hand':' · on the map frame');
  };
  /* eight grips: each moves the edges named in its class */
  for(const g of ['n','s','e','w','nw','ne','sw','se']){
    const grip=h('div',{class:'cgrip g-'+g});
    grip.addEventListener('pointerdown',e=>{
      e.preventDefault(); grip.setPointerCapture(e.pointerId);
      const x0=e.clientX, y0=e.clientY, r0={...r}, MIN=24/k;
      box.classList.add('drag');
      const mv=ev=>{
        const dx=(ev.clientX-x0)/k, dy=(ev.clientY-y0)/k;
        let x1=r0.x, y1=r0.y, x2=r0.x+r0.w, y2=r0.y+r0.h;
        if(g.includes('w')) x1=Math.max(0,Math.min(x2-MIN,x1+dx));
        if(g.includes('e')) x2=Math.min(s.w,Math.max(x1+MIN,x2+dx));
        if(g.includes('n')) y1=Math.max(0,Math.min(y2-MIN,y1+dy));
        if(g.includes('s')) y2=Math.min(s.h,Math.max(y1+MIN,y2+dy));
        r={x:x1,y:y1,w:x2-x1,h:y2-y1}; hand=true; lay();
      };
      const up=()=>{ grip.removeEventListener('pointermove',mv); box.classList.remove('drag'); };
      grip.addEventListener('pointermove',mv);
      grip.addEventListener('pointerup',up,{once:true});
      grip.addEventListener('pointercancel',up,{once:true});
    });
    box.append(grip);
  }
  const close=()=>{ view.classList.remove('show'); removeEventListener('resize',lay); setTimeout(()=>{ view.remove(); cv.width=cv.height=1; },260); };
  const view=h('div',{class:'cropview'},
    h('div',{class:'chead'},
      h('div',{class:'rm'},h('div',{class:'r1'},s.name),info),
      h('button',{class:'sx','aria-label':'Close',onclick:()=>{ close(); openSheets(); }},'✕')),
    stage,
    h('div',{class:'cfoot'},
      h('button',{class:'btn ghost',onclick:()=>{ r={...auto}; hand=false; lay(); }},'Reset to frame'),
      h('button',{class:'btn primary',onclick:()=>{
        const ch=hand!==!!s.hand || ['x','y','w','h'].some(q=>Math.abs(r[q]-s.crop[q])>0.01);
        if(ch){ s.crop={...r}; s.hand=hand; dirty(true); }
        close(); openSheets();
        if(ch) toast('Crop saved — rebuild to see it');
      }},'Done')));
  document.body.append(view);
  addEventListener('resize',lay);
  requestAnimationFrame(()=>{ lay(); view.classList.add('show'); });
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
    /* a sheet already masked here is showing the one beneath it */
    if((s.masks||[]).some(q=>p.x>=q.x && p.x<=q.x+q.w && p.y>=q.y && p.y<=q.y+q.h)) continue;
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
  /* sheets from one layout carry the key, north arrow and scale bar in the
     same place on every page, so one box can clear all of them */
  let all=false;
  const others=m.sheets.filter(t=>t!==hit.s && Math.abs(t.w/t.scale-hit.s.w/hit.s.scale)<1 && Math.abs(t.h/t.scale-hit.s.h/hit.s.scale)<1);
  if(others.length){
    const pick=await choose('Hide this box on…','',[
      {icon:'layers',label:`All ${others.length+1} sheets`,sub:'Same spot on every page — a key, north arrow or scale bar',value:'all'},
      {icon:'rect',label:'Just '+hit.s.name,sub:'Only this sheet has something there',value:'one'}]);
    if(pick===undefined) return;
    all=pick==='all';
  }
  (hit.s.masks = hit.s.masks||[]).push(r);
  if(all) for(const t of others){ const q=t.scale/hit.s.scale;
    (t.masks=t.masks||[]).push({x:r.x*q, y:r.y*q, w:r.w*q, h:r.h*q}); }
  dirty(true);
  const go=await dialog({title: all?`Hidden on ${others.length+1} sheets`:'Hidden on '+hit.s.name,
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
               trimPt:trimOf(m), W:plan.W, H:plan.H, dirty:false };
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
  A.openCrop=openCrop; A.rebuildSheets=rebuild;
}
