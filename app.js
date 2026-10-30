import { extractGeo, fitAffine, mPerDeg, dist, D2R } from './geo.js';
import { listMaps, getMap, putMap, deleteMap } from './store.js';

const $ = id => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

/* ===================== active map ===================== */
let MAP=null, AFF=null, M_PER_PX=1, FRAME_GEO=null, img=null, imgReady=false, objUrl=null;

function geoToPix(lat,lon){
  return { x: AFF.X[0]*lon + AFF.X[1]*lat + AFF.X[2],
           y: AFF.Y[0]*lon + AFF.Y[1]*lat + AFF.Y[2] };
}
function siteSize(m){
  const la=m.pts.map(p=>p.lat), lo=m.pts.map(p=>p.lon);
  const mid=(Math.max(...la)+Math.min(...la))/2, d=mPerDeg(mid);
  const mpx=(Math.max(...lo)-Math.min(...lo))*d.lon/m.frame.w;
  return { mpx, w:mpx*m.frame.w, h:mpx*m.frame.h };
}
async function useMap(m){
  MAP=m; AFF=fitAffine(m);
  const la=m.pts.map(p=>p.lat), lo=m.pts.map(p=>p.lon);
  FRAME_GEO={ n:Math.max(...la), s:Math.min(...la), e:Math.max(...lo), w:Math.min(...lo) };
  M_PER_PX=siteSize(m).mpx;
  imgReady=false;
  if(objUrl){ URL.revokeObjectURL(objUrl); objUrl=null; }
  const src = m.url || (objUrl = URL.createObjectURL(m.blob));
  img=new Image(); img.decoding='async';
  await new Promise(r=>{ img.onload=r; img.onerror=r; img.src=src; });
  imgReady=true;
  $('mapname').textContent=m.name;
  resize(); fitMap();
}

/* ===================== canvas ===================== */
const cv=$('cv'), ctx=cv.getContext('2d');
let W=0,H=0,DPR=1, view={s:1,x:0,y:0}, fix=null, follow=false, units='ft', pulse=0, anim=null;

function resize(){
  DPR=Math.min(window.devicePixelRatio||1,2.5);
  W=cv.clientWidth; H=cv.clientHeight;
  cv.width=Math.round(W*DPR); cv.height=Math.round(H*DPR);
  ctx.setTransform(DPR,0,0,DPR,0,0);
  if(MAP) clampView();
}
const minScale = () => Math.min(W/MAP.imgW, H/MAP.imgH);
function fitMap(){ const s=minScale(); view={s, x:(W-MAP.imgW*s)/2, y:(H-MAP.imgH*s)/2}; }
function clampView(){
  view.s=clamp(view.s, minScale()*0.85, minScale()*26);
  const w=MAP.imgW*view.s, h=MAP.imgH*view.s, mx=W*0.45, my=H*0.45;
  view.x = w<=W ? (W-w)/2 : clamp(view.x, W-w-mx, mx);
  view.y = h<=H ? (H-h)/2 : clamp(view.y, H-h-my, my);
}
const toScreen=(ix,iy)=>({x:ix*view.s+view.x, y:iy*view.s+view.y});
const toImage =(sx,sy)=>({x:(sx-view.x)/view.s, y:(sy-view.y)/view.s});

function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#0f1410'; ctx.fillRect(0,0,W,H);
  if(!MAP) return;
  if(imgReady){
    ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
    ctx.drawImage(img, view.x, view.y, MAP.imgW*view.s, MAP.imgH*view.s);
  }
  if(fix){
    const p=geoToPix(fix.lat,fix.lon), s=toScreen(p.x,p.y);
    const accPx=(fix.acc/M_PER_PX)*view.s;
    if(accPx>7){
      ctx.beginPath(); ctx.arc(s.x,s.y,accPx,0,7);
      ctx.fillStyle='rgba(126,224,160,.13)'; ctx.fill();
      ctx.strokeStyle='rgba(126,224,160,.45)'; ctx.lineWidth=1.3; ctx.stroke();
    }
    const k=.5+.5*Math.sin(pulse*1.5);
    ctx.beginPath(); ctx.arc(s.x,s.y,11+k*9,0,7);
    ctx.strokeStyle=`rgba(126,224,160,${.42*(1-k)+.07})`;
    ctx.lineWidth=2+1.4*(1-k); ctx.stroke();
    if(fix.heading!=null && !isNaN(fix.heading)){
      const a=(fix.heading-90)*D2R, sp=.42;
      ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.arc(s.x,s.y,34,a-sp,a+sp); ctx.closePath();
      const g=ctx.createRadialGradient(s.x,s.y,4,s.x,s.y,34);
      g.addColorStop(0,'rgba(126,224,160,.5)'); g.addColorStop(1,'rgba(126,224,160,0)');
      ctx.fillStyle=g; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(s.x,s.y,9.5,0,7);
    ctx.fillStyle='#7ee0a0'; ctx.fill();
    ctx.lineWidth=3; ctx.strokeStyle='rgba(10,20,13,.92)'; ctx.stroke();
    if(s.x<22||s.y<22||s.x>W-22||s.y>H-22){
      const cx=W/2, cy=H/2, ang=Math.atan2(s.y-cy,s.x-cx), r=Math.min(W,H)/2-42;
      ctx.save(); ctx.translate(cx+Math.cos(ang)*r, cy+Math.sin(ang)*r); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(15,0); ctx.lineTo(-9,9); ctx.lineTo(-9,-9); ctx.closePath();
      ctx.fillStyle='rgba(240,198,116,.95)'; ctx.fill(); ctx.restore();
    }
  }
  drawScale();
}
function drawScale(){
  const metres=Math.min(120,W*.3)*M_PER_PX/view.s;
  const steps = units==='ft' ? [10,25,50,100,200,300,500,1000,2000,5280] : [5,10,20,50,100,200,500,1000,2000];
  const val = units==='ft' ? metres/0.3048 : metres;
  let pick=steps[0]; for(const s of steps) if(s<=val) pick=s;
  $('sline').style.width=((units==='ft'?pick*0.3048:pick)/M_PER_PX*view.s)+'px';
  $('stxt').textContent = units==='ft' ? (pick===5280?'1 mi':pick+' ft')
                                       : (pick>=1000?(pick/1000)+' km':pick+' m');
}
function loop(t){
  pulse=t/1000;
  if(anim){
    const k=clamp((t-anim.t0)/anim.dur,0,1), e=1-Math.pow(1-k,3);
    view.s=anim.s0+(anim.s1-anim.s0)*e;
    view.x=anim.x0+(anim.x1-anim.x0)*e;
    view.y=anim.y0+(anim.y1-anim.y0)*e;
    if(k>=1) anim=null;
  }
  draw(); requestAnimationFrame(loop);
}
function animateTo(s,x,y,dur=620){ clampView(); anim={t0:performance.now(),dur,s0:view.s,x0:view.x,y0:view.y,s1:s,x1:x,y1:y}; }
function centerOnFix(zoom){
  if(!fix||!MAP) return;
  const p=geoToPix(fix.lat,fix.lon);
  const s = zoom!=null ? zoom : Math.max(view.s, minScale()*3.2);
  const keep={...view}; view.s=s; view.x=W/2-p.x*s; view.y=H/2-p.y*s; clampView();
  const t={...view}; Object.assign(view,keep); animateTo(t.s,t.x,t.y);
}

/* ===================== gestures ===================== */
const ptrs=new Map(); let pinch=null, moved=0, lastTap=0;
cv.addEventListener('pointerdown',e=>{
  cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY}); moved=0; anim=null;
  if(ptrs.size===2){ const [a,b]=[...ptrs.values()];
    pinch={d:Math.hypot(a.x-b.x,a.y-b.y), cx:(a.x+b.x)/2, cy:(a.y+b.y)/2, s:view.s}; }
});
cv.addEventListener('pointermove',e=>{
  const p=ptrs.get(e.pointerId); if(!p||!MAP) return;
  const dx=e.clientX-p.x, dy=e.clientY-p.y; p.x=e.clientX; p.y=e.clientY; moved+=Math.hypot(dx,dy);
  if(ptrs.size===1){ view.x+=dx; view.y+=dy; if(moved>9) setFollow(false); clampView(); }
  else if(ptrs.size===2&&pinch){
    const [a,b]=[...ptrs.values()];
    const d=Math.hypot(a.x-b.x,a.y-b.y), cx=(a.x+b.x)/2, cy=(a.y+b.y)/2;
    const before=toImage(pinch.cx,pinch.cy);
    view.s=clamp(pinch.s*(d/pinch.d), minScale()*0.85, minScale()*26);
    view.x=cx-before.x*view.s; view.y=cy-before.y*view.s; setFollow(false); clampView();
  }
},{passive:true});
function up(e){
  ptrs.delete(e.pointerId); if(ptrs.size<2) pinch=null;
  if(ptrs.size===0&&moved<9){
    const n=performance.now();
    if(n-lastTap<300){ zoomAt(e.clientX,e.clientY,2); lastTap=0; } else lastTap=n;
  }
}
cv.addEventListener('pointerup',up); cv.addEventListener('pointercancel',up);
cv.addEventListener('wheel',e=>{ e.preventDefault(); zoomAt(e.clientX,e.clientY,Math.exp(-e.deltaY*.0022)); },{passive:false});
function zoomAt(sx,sy,f){
  if(!MAP) return;
  const b=toImage(sx,sy), s=clamp(view.s*f, minScale()*0.85, minScale()*26);
  animateTo(s, sx-b.x*s, sy-b.y*s, 300); setFollow(false);
}
$('zin').onclick=()=>zoomAt(W/2,H/2,1.9);
$('zout').onclick=()=>zoomAt(W/2,H/2,1/1.9);
function setFollow(v){ if(follow===v) return; follow=v; $('follow').classList.toggle('on',v); }
$('follow').onclick=()=>{ if(!fix) return toast('No GPS fix yet — hold on a moment.'); setFollow(true); centerOnFix(); };

/* ===================== readout ===================== */
let tt=null;
function toast(msg,ms=2800){
  $('toast').textContent=msg; $('toast').classList.add('show');
  clearTimeout(tt); tt=setTimeout(()=>$('toast').classList.remove('show'),ms);
}
function updateReadout(){
  if(!fix) return;
  $('ln1').textContent=`${Math.abs(fix.lat).toFixed(6)}° ${fix.lat>=0?'N':'S'}  ${Math.abs(fix.lon).toFixed(6)}° ${fix.lon>=0?'E':'W'}`;
  const acc = units==='ft' ? `±${Math.round(fix.acc/0.3048)} ft` : `±${Math.round(fix.acc)} m`;
  const inside = fix.lat<=FRAME_GEO.n+1e-5 && fix.lat>=FRAME_GEO.s-1e-5
              && fix.lon<=FRAME_GEO.e+1e-5 && fix.lon>=FRAME_GEO.w-1e-5;
  const l2=$('ln2');
  if(inside){ l2.classList.remove('warn'); l2.textContent=`${acc} · on map`; }
  else{
    const d=dist(fix.lat,fix.lon,(FRAME_GEO.n+FRAME_GEO.s)/2,(FRAME_GEO.e+FRAME_GEO.w)/2);
    const dd = units==='ft' ? (d>1609?(d/1609.34).toFixed(2)+' mi':Math.round(d/0.3048)+' ft')
                            : (d>1000?(d/1000).toFixed(2)+' km':Math.round(d)+' m');
    l2.classList.add('warn'); l2.textContent=`${acc} · OFF MAP — ${dd} from map center`;
  }
}
$('units').onclick=()=>{ units = units==='ft'?'m':'ft'; $('units').textContent=units.toUpperCase(); updateReadout(); };

/* ===================== GPS ===================== */
let watchId=null, firstFix=true;
function startGPS(){
  if(!('geolocation' in navigator)) return toast('This browser has no GPS access.',5000);
  if(watchId!=null) return;
  watchId=navigator.geolocation.watchPosition(pos=>{
    const c=pos.coords;
    fix={lat:c.latitude, lon:c.longitude, acc:c.accuracy||15,
         heading:(c.speed!=null&&c.speed>0.6)?c.heading:null};
    $('dot').classList.add('live'); updateReadout();
    if(firstFix){ firstFix=false; setFollow(true); centerOnFix(minScale()*3.6);
                  toast(`Fix acquired · ±${Math.round(c.accuracy/0.3048)} ft`); }
    else if(follow) centerOnFix(view.s);
  }, err=>{
    const m = err.code===1 ? 'Location permission denied — enable it for this site in your browser settings.'
            : err.code===2 ? 'No position yet. Step into the open; a cold GPS fix can take 30–60 s.'
            : 'GPS timed out — still trying.';
    $('ln1').textContent='No GPS'; $('ln2').textContent=m; $('ln2').classList.add('warn'); toast(m,5500);
  }, {enableHighAccuracy:true, maximumAge:1500, timeout:27000});
}

/* ===================== library ===================== */
const fmtFt = m => m>1609 ? (m/1609.34).toFixed(1)+' mi' : Math.round(m/0.3048)+' ft';
async function renderLib(){
  const stored = await listMaps().catch(()=>[]);
  const all=stored.sort((a,b)=>b.created-a.created);
  $('cards').innerHTML='';
  $('empty').classList.toggle('gone', all.length>0);
  all.forEach((m,i)=>{
    const sz=siteSize(m);
    const el=document.createElement('div');
    el.className='card'; el.style.animationDelay=(i*55)+'ms';
    el.innerHTML=`<div class="cmain">
        <div class="cname"></div>
        <div class="cmeta"></div>
      </div><button class="del" aria-label="Delete">✕</button>`;
    el.querySelector('.cname').textContent=m.name;
    el.querySelector('.cmeta').textContent=
      `${fmtFt(sz.w)} × ${fmtFt(sz.h)} · ${m.pts[0].lat.toFixed(4)}°, ${m.pts[0].lon.toFixed(4)}°`;
    el.querySelector('.cmain').onclick=()=>openMap(m);
    const d=el.querySelector('.del');
    if(d) d.onclick=async ev=>{ ev.stopPropagation();
      if(!confirmish(el)) return;
      await deleteMap(m.id); renderLib(); toast('Map removed'); };
    $('cards').appendChild(el);
  });
}
function confirmish(el){
  if(el.dataset.arm==='1') return true;
  el.dataset.arm='1'; el.classList.add('arm');
  setTimeout(()=>{ el.dataset.arm=''; el.classList.remove('arm'); },2600);
  toast('Tap ✕ again to remove');
  return false;
}
async function openMap(m){
  // reveal first: the canvas must have a real size before useMap sizes the view
  $('lib').classList.add('gone');
  $('mapview').classList.remove('gone');
  await useMap(m);
  requestAnimationFrame(()=>{
    $('bar').classList.remove('boot');
    setTimeout(()=>$('follow').classList.remove('boot'),90);
    setTimeout(()=>$('zoomwrap').classList.remove('boot'),150);
    setTimeout(()=>$('scale').classList.remove('boot'),210);
  });
  fix=null; firstFix=true; $('dot').classList.remove('live');
  follow=false; $('follow').classList.remove('on');
  $('ln1').textContent='Waiting for GPS…'; $('ln2').textContent='—'; $('ln2').classList.remove('warn');
  startGPS();
}
$('back').onclick=()=>{
  $('mapview').classList.add('gone'); $('lib').classList.remove('gone');
  ['bar','follow','zoomwrap','scale'].forEach(i=>$(i).classList.add('boot'));
  if(watchId!=null){ navigator.geolocation.clearWatch(watchId); watchId=null; }
};

/* ===================== PDF import ===================== */
$('addbtn').onclick=()=>$('file').click();
$('file').onchange=async e=>{
  const f=e.target.files&&e.target.files[0]; e.target.value='';
  if(f) await importPDF(f);
};
function prog(pct,msg){ $('pfill').style.width=pct+'%'; $('ptxt').textContent=msg; }

async function importPDF(file){
  $('imp').classList.add('show'); prog(6,'Reading file…');
  try{
    const buf=await file.arrayBuffer();
    const bytes=new Uint8Array(buf);

    prog(18,'Looking for georeferencing…');
    // page size first (needed to flip PDF y-axis)
    const pdfjs=await import('./pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='./pdf.worker.min.mjs';
    const doc=await pdfjs.getDocument({data:bytes.slice(0)}).promise;
    if(doc.numPages>1) toast(`${doc.numPages} pages — using page 1`,4200);
    const page=await doc.getPage(1);
    const vw=page.view, pageWpt=vw[2]-vw[0], pageHpt=vw[3]-vw[1];

    const geo=await extractGeo(bytes, pageHpt);
    if(!geo) throw new Error(
      'No georeferencing found in this PDF. It needs to be exported as a GeoPDF '+
      '(ArcGIS: Export Map with "Export Map Georeference Information" ticked).');
    if(page.rotate % 360 !== 0) throw new Error('This PDF page is rotated — I can\'t georeference it reliably.');

    prog(42,'Rendering map…');
    const LONG=4200, MAXPX=12e6;
    const scale=Math.min(LONG/Math.max(pageWpt,pageHpt), Math.sqrt(MAXPX/(pageWpt*pageHpt)));
    const vp=page.getViewport({scale});
    const c=document.createElement('canvas');
    c.width=Math.round(vp.width); c.height=Math.round(vp.height);
    const cx=c.getContext('2d',{alpha:false});
    cx.fillStyle='#fff'; cx.fillRect(0,0,c.width,c.height);
    await page.render({canvasContext:cx, viewport:vp}).promise;

    prog(76,'Compressing…');
    const blob=await new Promise(r=>c.toBlob(r,'image/webp',.86)) ||
               await new Promise(r=>c.toBlob(r,'image/png'));

    const rec={
      id:'m'+Date.now().toString(36),
      name:(file.name||'Map').replace(/\.pdf$/i,'').replace(/[_-]+/g,' ').trim().slice(0,60)||'Map',
      blob, imgW:c.width, imgH:c.height,
      frame:{x:geo.framePt.x*scale, y:geo.framePt.y*scale, w:geo.framePt.w*scale, h:geo.framePt.h*scale},
      pts:geo.pts, wkt:geo.wkt||'', created:Date.now()
    };
    if(!fitAffine(rec)) throw new Error('The georeferencing in this PDF is degenerate — can\'t build a transform.');

    prog(92,'Saving…');
    await putMap(rec);
    const sz=siteSize(rec);
    prog(100,'Done');
    await renderLib();
    setTimeout(()=>$('imp').classList.remove('show'),380);
    toast(`${rec.name} added · ${fmtFt(sz.w)} × ${fmtFt(sz.h)}`,4200);
  }catch(err){
    $('imp').classList.remove('show');
    $('errtxt').textContent=err.message||String(err);
    $('err').classList.add('show');
  }
}
$('errok').onclick=()=>$('err').classList.remove('show');

/* ===================== boot ===================== */
window.addEventListener('resize',()=>{ const f=follow; resize(); if(f&&fix) centerOnFix(view.s); });
window.addEventListener('orientationchange',()=>setTimeout(()=>{ resize(); if(follow&&fix) centerOnFix(view.s); },260));
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('dblclick',e=>e.preventDefault());
resize(); requestAnimationFrame(loop); renderLib();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
