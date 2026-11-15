/* ============ photos on a pin (or any shape) ============
   Stored in IndexedDB on the device. No service, no account, no bill.
   Full-size phone photos are 4-12 MB each, which would fill a phone in a
   season, so each one is scaled down on the way in and kept beside a small
   thumbnail; the big version is only read when it is actually opened.      */

import { S, A, ICON } from './state.js';
import { $, h, uid, toast, dialog, closeSheet, saveFile } from './ui.js';
import { putPhoto, getPhoto, delPhoto, photosFor, photosOfMap, delPhotosFor, photoUsage } from './store.js';

const MAXDIM=1600, QUALITY=0.82, THUMBDIM=220, THUMBQ=0.7;
export const fmtBytes = b => b>=1048576 ? (b/1048576).toFixed(b>=10485760?0:1)+' MB'
                          : b>=1024 ? Math.round(b/1024)+' KB' : b+' B';

async function shrink(file, maxDim, q){
  /* imageOrientation:'from-image' honours the EXIF rotation, without which
     every portrait photo off a phone comes out on its side */
  const bmp=await createImageBitmap(file,{imageOrientation:'from-image'});
  const k=Math.min(1, maxDim/Math.max(bmp.width,bmp.height));
  const w=Math.max(1,Math.round(bmp.width*k)), hh=Math.max(1,Math.round(bmp.height*k));
  const cv=document.createElement('canvas'); cv.width=w; cv.height=hh;
  const ctx=cv.getContext('2d',{alpha:false});
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(bmp,0,0,w,hh);
  if(bmp.close) bmp.close();
  const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',q));
  cv.width=cv.height=1;
  return {blob,w,h:hh};
}

export async function addPhotos(f, files){
  const list=[...files].filter(x=>/^image\//.test(x.type)||/\.(jpe?g|png|webp|heic|heif)$/i.test(x.name||''));
  if(!list.length){ toast('Those were not photos'); return 0; }
  let n=0, failed=0;
  A.busy(5, list.length>1?`Adding ${list.length} photos…`:'Adding photo…');
  for(let i=0;i<list.length;i++){
    try{
      const big=await shrink(list[i], MAXDIM, QUALITY);
      const th=await shrink(list[i], THUMBDIM, THUMBQ);
      const pin=f.pts&&f.pts[0];
      const g=(pin&&S.xf)?S.xf.toGeo(pin[0],pin[1]):null;
      await putPhoto({ id:uid('ph'), fid:f.id, mid:S.map.id, blob:big.blob, thumb:th.blob,
                       w:big.w, h:big.h, t:Date.now(),
                       name:(list[i].name||'').slice(0,80),
                       lat:g?+g.lat.toFixed(7):null, lon:g?+g.lon.toFixed(7):null });
      n++;
    }catch(e){ failed++; }
    A.busy(5+90*(i+1)/list.length);
  }
  A.busyOff();
  if(n){
    f.photos=(f.photos||0)+n;
    A.commit(); A.render();
  }
  if(failed) toast(`${failed} photo${failed===1?'':'s'} could not be read`,4000);
  return n;
}

/* a strip of thumbnails with an add button, for the details sheet */
export function photoStrip(f){
  const wrap=h('div',{class:'phwrap'});
  const strip=h('div',{class:'phstrip'});
  const urls=[];
  const input=h('input',{type:'file',class:'gone',accept:'image/*',multiple:true,
    onchange:async e=>{ const fs=[...(e.target.files||[])]; e.target.value='';
      if(fs.length){ await addPhotos(f,fs); await draw(); } }});
  const add=h('button',{class:'phadd',onclick:()=>input.click()},
    h('span',{html:ICON.camera}), h('i',{},'Add'));

  async function draw(){
    urls.splice(0).forEach(u=>URL.revokeObjectURL(u));
    strip.innerHTML='';
    let ps=[];
    try{ ps=await photosFor(f.id); }catch(e){}
    ps.sort((a,b)=>a.t-b.t);
    if(f.photos!==ps.length){ f.photos=ps.length||undefined; A.commit(); A.render(); }
    ps.forEach((p,i)=>{
      const u=URL.createObjectURL(p.thumb||p.blob); urls.push(u);
      strip.append(h('button',{class:'phthumb',style:{backgroundImage:`url(${u})`},
        'aria-label':`Photo ${i+1} of ${ps.length}`,
        onclick:()=>viewer(ps.map(x=>x.id), i, draw)}));
    });
    strip.append(add);
    wrap.classList.toggle('empty', !ps.length);
  }
  wrap.append(h('div',{class:'sec'},'Photos'), strip, input);
  draw();
  return wrap;
}

/* ---------------- full-screen viewer ---------------- */
export async function viewer(ids, idx, onChange){
  let i=Math.max(0,Math.min(idx, ids.length-1));
  let url=null, cur=null;
  const img=h('img',{class:'phimg',alt:''});
  const cap=h('div',{class:'phcap'});
  const count=h('div',{class:'phcount'});
  const prev=h('button',{class:'phnav l','aria-label':'Previous photo',html:ICON.back,onclick:()=>go(-1)});
  const next=h('button',{class:'phnav r','aria-label':'Next photo',html:ICON.back,onclick:()=>go(1)});
  const ov=h('div',{class:'phview'},
    h('div',{class:'phbar'},
      h('button',{class:'phbtn','aria-label':'Close',html:ICON.x,onclick:close}),
      count,
      h('button',{class:'phbtn','aria-label':'Save this photo',html:ICON.share,onclick:save}),
      h('button',{class:'phbtn dng','aria-label':'Delete this photo',html:ICON.trash,onclick:del})),
    prev, img, next, cap);

  function free(){ if(url){ URL.revokeObjectURL(url); url=null; } }
  async function show(){
    free();
    cur=await getPhoto(ids[i]).catch(()=>null);
    if(!cur){ close(); return; }
    url=URL.createObjectURL(cur.blob);
    img.src=url;
    count.textContent=`${i+1} of ${ids.length}`;
    const d=new Date(cur.t);
    cap.textContent=[d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}),
      cur.lat!=null?`${cur.lat.toFixed(5)}, ${cur.lon.toFixed(5)}`:null].filter(Boolean).join('  ·  ');
    prev.classList.toggle('gone', ids.length<2);
    next.classList.toggle('gone', ids.length<2);
  }
  function go(d){ i=(i+d+ids.length)%ids.length; show(); }
  function close(){
    free();
    document.removeEventListener('keydown',key);
    ov.classList.remove('show');
    setTimeout(()=>ov.remove(),220);
  }
  function key(e){
    if(e.key==='Escape') close();
    else if(e.key==='ArrowLeft') go(-1);
    else if(e.key==='ArrowRight') go(1);
  }
  async function save(){
    if(!cur) return;
    const d=new Date(cur.t).toISOString().slice(0,19).replace(/[:T]/g,'-');
    await saveFile(`photo-${d}.jpg`, cur.blob, {share:true});
  }
  async function del(){
    if(!cur) return;
    const ok=await dialog({title:'Delete this photo?',text:'It is only on this device, so this cannot be undone.',ok:'Delete',danger:true});
    if(!ok) return;
    await delPhoto(cur.id).catch(()=>{});
    ids.splice(i,1);
    if(onChange) onChange();
    if(!ids.length){ close(); return; }
    if(i>=ids.length) i=ids.length-1;
    show();
  }
  /* swipe between photos */
  let sx=null;
  img.addEventListener('pointerdown',e=>{ sx=e.clientX; });
  img.addEventListener('pointerup',e=>{
    if(sx==null) return;
    const dx=e.clientX-sx; sx=null;
    if(Math.abs(dx)>45) go(dx<0?1:-1);
  });
  document.addEventListener('keydown',key);
  document.body.append(ov);
  await show();
  requestAnimationFrame(()=>ov.classList.add('show'));
}

/* a deleted feature keeps its photos until the map is next opened, because
   deleting a feature is undoable and the photos have to survive the undo */
export async function sweepOrphans(){
  if(!S.map||!S.data) return 0;
  const live=new Set(S.data.features.map(f=>f.id));
  let ps=[]; try{ ps=await photosOfMap(S.map.id); }catch(e){ return 0; }
  let n=0;
  for(const p of ps) if(!live.has(p.fid)){ await delPhoto(p.id).catch(()=>{}); n++; }
  return n;
}

export async function photoLine(mid){
  const u=await photoUsage(mid).catch(()=>null);
  if(!u||!u.count) return null;
  return `${u.count} photo${u.count===1?'':'s'} · ${fmtBytes(u.bytes)} on this device`;
}

export function initPhotos(){
  A.photoStrip=photoStrip;
  A.addPhotos=addPhotos;
  A.delPhotosFor=delPhotosFor;
  A.photoLine=photoLine;
  A.sweepPhotos=sweepOrphans;
}
