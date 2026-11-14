/* ============ drawing tools, layers, selection/editing, undo ============ */
import { S, A, ICON, PALETTE } from './state.js';
import { $, h, uid, toast, sheet, closeSheet, dialog, fmtLen, fmtArea, fmtLL } from './ui.js';
import { pathLength, polyArea } from './geo.js';

const TOOLS=[
  {id:'select', label:'Select', icon:'select',  key:'v'},
  {id:'point',  label:'Pin',    icon:'point',   key:'p'},
  {id:'line',   label:'Line',   icon:'line',    key:'l'},
  {id:'polygon',label:'Area',   icon:'polygon', key:'g'},
  {id:'free',   label:'Draw',   icon:'free',    key:'f'},
  {id:'text',   label:'Text',   icon:'text',    key:'t'},
];
const MORE=[
  {id:'rect',   label:'Rectangle', icon:'rect',    key:'r'},
  {id:'circle', label:'Circle',    icon:'circle',  key:'c'},
  {id:'arrow',  label:'Arrow',     icon:'arrow',   key:'a'},
  {id:'measure',label:'Measure',   icon:'measure', key:'m'},
];
const ALL=[...TOOLS,...MORE];
const TYPE_ICON={point:'point',line:'line',polygon:'polygon',circle:'circle',text:'text'};

let draft=null, drag=null, hoverPt=null, selV=null, moveMode=false, lastEmptyTap=0;
let hist=[], hi=-1, commitT=null;
const pops=new Map();

const feats = () => S.data ? S.data.features : [];
const layerOf = f => S.data.layers.find(l=>l.id===f.layer) || S.data.layers[0];
const colorOf = f => f.color || layerOf(f).color;
const selF = () => S.sel ? feats().find(f=>f.id===S.sel) : null;
const sdist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const scr = p => A.toScreen(p[0],p[1]);

/* ===================== history ===================== */
function snapshot(){ return JSON.stringify(S.data.features); }
function commit(){
  clearTimeout(commitT); commitT=null;
  const s=snapshot();
  if(hist[hi]===s) return;
  hist.splice(hi+1); hist.push(s); if(hist.length>80) hist.shift(); hi=hist.length-1;
  A.saveData(); histButtons();
}
A.commit=()=>commit();
function commitSoon(){ clearTimeout(commitT); commitT=setTimeout(commit,600); A.render(); }
function restore(i){
  hi=i; S.data.features=JSON.parse(hist[hi]);
  if(S.sel && !selF()) S.sel=null;
  selV=null; drag=null; A.saveData(); histButtons(); refreshCtx(); A.render();
}
function undo(){ if(commitT) commit(); if(draft&&draft.pts&&draft.pts.length){ draft.pts.pop(); refreshCtx(); A.render(); return; } if(hi>0) restore(hi-1); }
function redo(){ if(hi<hist.length-1) restore(hi+1); }
function histButtons(){ $('undo').disabled=!(hi>0 || (draft&&draft.pts&&draft.pts.length)); $('redo').disabled=!(hi<hist.length-1); }

/* ===================== geometry ===================== */
function distSeg(p,a,b){
  const dx=b.x-a.x, dy=b.y-a.y, l2=dx*dx+dy*dy;
  let t=l2?((p.x-a.x)*dx+(p.y-a.y)*dy)/l2:0; t=Math.max(0,Math.min(1,t));
  return Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
}
function inPoly(p,pts){
  let c=false;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){
    const a=pts[i], b=pts[j];
    if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) c=!c;
  }
  return c;
}
function rdp(pts,tol){
  if(pts.length<3) return pts;
  const a={x:pts[0][0],y:pts[0][1]}, b={x:pts[pts.length-1][0],y:pts[pts.length-1][1]};
  let mx=0, mi=0;
  for(let i=1;i<pts.length-1;i++){ const d=distSeg({x:pts[i][0],y:pts[i][1]},a,b); if(d>mx){mx=d;mi=i;} }
  if(mx<=tol) return [pts[0],pts[pts.length-1]];
  return [...rdp(pts.slice(0,mi+1),tol).slice(0,-1), ...rdp(pts.slice(mi),tol)];
}
const mctx=document.createElement('canvas').getContext('2d');
function textW(f){ mctx.font='600 100px system-ui,sans-serif'; return mctx.measureText(f.text||'').width/100*f.size; }
function bboxOf(f){
  if(f.type==='circle') return [f.pts[0][0]-f.r,f.pts[0][1]-f.r,f.pts[0][0]+f.r,f.pts[0][1]+f.r];
  if(f.type==='text') return [f.pts[0][0],f.pts[0][1]-f.size,f.pts[0][0]+textW(f),f.pts[0][1]+f.size*.3];
  let x0=1e12,y0=1e12,x1=-1e12,y1=-1e12;
  for(const p of f.pts){ x0=Math.min(x0,p[0]); y0=Math.min(y0,p[1]); x1=Math.max(x1,p[0]); y1=Math.max(y1,p[1]); }
  return [x0,y0,x1,y1];
}
function anchorOf(f){   // label anchor, image px
  if(f.type==='line'){ const i=Math.max(0,Math.floor((f.pts.length-1)/2)), a=f.pts[i], b=f.pts[Math.min(i+1,f.pts.length-1)]; return [(a[0]+b[0])/2,(a[1]+b[1])/2]; }
  if(f.type==='polygon'){ let x=0,y=0; for(const p of f.pts){x+=p[0];y+=p[1];} return [x/f.pts.length,y/f.pts.length]; }
  return f.pts[0];
}
function hitFeature(sp){
  const tol=16;
  for(let li=S.data.layers.length-1; li>=0; li--){
    const L=S.data.layers[li]; if(L.visible===false) continue;
    const list=feats().filter(f=>layerOf(f)===L);
    for(let i=list.length-1;i>=0;i--){
      const f=list[i], P=f.pts.map(scr);
      if(f.type==='point'){ if(sdist(sp,P[0])<20) return f; }
      else if(f.type==='text'){ const b=bboxOf(f), a=A.toScreen(b[0],b[1]), c=A.toScreen(b[2],b[3]);
        if(sp.x>a.x-8&&sp.x<c.x+8&&sp.y>a.y-8&&sp.y<c.y+8) return f; }
      else if(f.type==='circle'){ const d=sdist(sp,P[0]), r=f.r*S.view.s; if(d<r+tol*.6) return f; }
      else if(f.type==='line'){ for(let k=1;k<P.length;k++) if(distSeg(sp,P[k-1],P[k])<tol) return f; }
      else if(f.type==='polygon'){ if(inPoly(sp,P)) return f; for(let k=0;k<P.length;k++) if(distSeg(sp,P[k],P[(k+1)%P.length])<tol) return f; }
    }
  }
  return null;
}

/* ===================== measurements ===================== */
function local(pts){ return pts.map(p=>S.xf.toLocal(p[0],p[1])); }
export function featureStats(f, xf=S.xf){
  if(!xf) return {};
  const L=pts=>pts.map(p=>xf.toLocal(p[0],p[1]));
  if(f.type==='line') return {len:pathLength(L(f.pts))};
  if(f.type==='polygon'){ const l=L(f.pts); return {len:pathLength(l,true), area:polyArea(l)}; }
  if(f.type==='circle'){ const r=f.r*xf.mPerPx; return {radius:r, len:2*Math.PI*r, area:Math.PI*r*r}; }
  const g = f.gps && f.type==='point' ? f.gps : xf.toGeo(f.pts[0][0],f.pts[0][1]);
  return {lat:g.lat, lon:g.lon};
}
function statsText(f){
  const s=featureStats(f), u=S.set.units;
  if(s.area!=null) return (s.radius!=null?`r ${fmtLen(s.radius,u)} · `:'')+`${fmtArea(s.area,u)} · ${fmtLen(s.len,u)} around`;
  if(s.len!=null) return fmtLen(s.len,u);
  if(s.lat!=null) return fmtLL(s.lat,s.lon);
  return '';
}
function draftStats(){
  if(!S.xf||!draft||!draft.pts||draft.pts.length<2) return '';
  const l=local(draft.pts), u=S.set.units;
  if(draft.tool==='line') return fmtLen(pathLength(l),u);
  if(l.length<3) return fmtLen(pathLength(l),u);
  return draft.tool==='polygon' ? `${fmtArea(polyArea(l),u)} · ${fmtLen(pathLength(l,true),u)} around`
                                : `${fmtLen(pathLength(l),u)} · ${fmtArea(polyArea(l),u)} if closed`;
}

/* ===================== painting ===================== */
function cased(ctx,color,w,dash,k){
  ctx.lineJoin='round'; ctx.lineCap='round'; ctx.setLineDash([]);
  ctx.strokeStyle = color.toLowerCase()==='#ffffff' ? 'rgba(0,0,0,.7)' : 'rgba(255,255,255,.88)';
  ctx.lineWidth=(w+2.6)*k; ctx.stroke();
  if(dash){ ctx.lineCap='butt'; ctx.setLineDash([w*2.8*k,w*2*k]); }
  ctx.strokeStyle=color; ctx.lineWidth=w*k; ctx.stroke(); ctx.setLineDash([]);
}
function rgba(hex,a){ const n=parseInt(hex.slice(1),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }
let placed=[];
function label(ctx,txt,x,y,k,align='center'){
  ctx.font=`600 ${12.5*k}px system-ui,-apple-system,sans-serif`; ctx.textAlign=align; ctx.textBaseline='middle';
  const w=ctx.measureText(txt).width, x0=align==='left'?x:x-w/2, box=[x0-3*k,y-8*k,x0+w+3*k,y+8*k];
  if(placed.some(b=>box[0]<b[2]&&box[2]>b[0]&&box[1]<b[3]&&box[3]>b[1])) return;   // skip names that would sit on top of each other
  placed.push(box);
  ctx.lineJoin='round'; ctx.lineWidth=3.4*k; ctx.strokeStyle='rgba(255,255,255,.94)'; ctx.strokeText(txt,x,y);
  ctx.fillStyle='#16201a'; ctx.fillText(txt,x,y);
}
/* T: image px -> target px.  s: image->target scale.  k: size multiplier for strokes/markers. */
A.paintFeatures=function(ctx,T,s,k,interactive){
  if(!S.data) return;
  const now=performance.now(); placed=[];
  for(const L of S.data.layers){
    if(L.visible===false) continue;
    for(const f of feats()){
      if(layerOf(f)!==L) continue;
      paintOne(ctx,f,T,s,k,now, interactive && f.id===S.sel);
    }
  }
  if(interactive){ paintSelection(ctx); paintDraft(ctx); }
};
function paintOne(ctx,f,T,s,k,now,isSel){
  const col=colorOf(f), w=f.width||3.2, P=f.pts.map(p=>T(p[0],p[1]));
  if(f.type==='point'){
    let r=7.5*k; const born=pops.get(f.id);
    if(born){ const t=(now-born)/380; if(t>=1) pops.delete(f.id); else r*=1+Math.sin(t*Math.PI)*0.9*(1-t); }
    if(isSel){ ctx.beginPath(); ctx.arc(P[0].x,P[0].y,r+7*k,0,7); ctx.fillStyle=rgba(col,.25); ctx.fill(); }
    ctx.beginPath(); ctx.arc(P[0].x,P[0].y,r+2.4*k,0,7); ctx.fillStyle='#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(P[0].x,P[0].y,r,0,7); ctx.fillStyle=col; ctx.fill();
    ctx.beginPath(); ctx.arc(P[0].x,P[0].y,r+2.4*k,0,7); ctx.strokeStyle='rgba(0,0,0,.45)'; ctx.lineWidth=1*k; ctx.stroke();
    if(S.set.labels && f.name) label(ctx,f.name,P[0].x+r+6*k,P[0].y,k,'left');
    return;
  }
  if(f.type==='text'){
    const px=f.size*s; if(px<4.5) return;
    ctx.font=`600 ${px}px system-ui,-apple-system,sans-serif`; ctx.textAlign='left'; ctx.textBaseline='alphabetic'; ctx.lineJoin='round';
    ctx.lineWidth=px*.24; ctx.strokeStyle = col.toLowerCase()==='#ffffff'?'rgba(0,0,0,.8)':'rgba(255,255,255,.94)';
    ctx.strokeText(f.text||'',P[0].x,P[0].y); ctx.fillStyle=col; ctx.fillText(f.text||'',P[0].x,P[0].y);
    if(isSel){ const b=bboxOf(f), a=T(b[0],b[1]), c=T(b[2],b[3]); ctx.setLineDash([5,4]); ctx.strokeStyle=col; ctx.lineWidth=1.5;
      ctx.strokeRect(a.x-5,a.y-4,c.x-a.x+10,c.y-a.y+8); ctx.setLineDash([]); }
    return;
  }
  ctx.beginPath();
  if(f.type==='circle') ctx.arc(P[0].x,P[0].y,Math.max(.5,f.r*s),0,7);
  else{ P.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); if(f.type==='polygon') ctx.closePath(); }
  if(f.type!=='line'){ const fo=f.fill??0.2; if(fo>0){ ctx.fillStyle=rgba(col,fo); ctx.fill(); } }
  cased(ctx,col,w,f.dash,k);
  if(f.type==='line' && f.arrow && P.length>1){
    const a=P[P.length-2], b=P[P.length-1], ang=Math.atan2(b.y-a.y,b.x-a.x), hs=Math.max(11,w*3.6)*k;
    ctx.beginPath(); ctx.moveTo(b.x+Math.cos(ang)*hs*.35,b.y+Math.sin(ang)*hs*.35);
    ctx.lineTo(b.x-Math.cos(ang-.45)*hs,b.y-Math.sin(ang-.45)*hs); ctx.lineTo(b.x-Math.cos(ang+.45)*hs,b.y-Math.sin(ang+.45)*hs); ctx.closePath();
    ctx.fillStyle=col; ctx.fill(); ctx.strokeStyle='rgba(255,255,255,.88)'; ctx.lineWidth=1.2*k; ctx.stroke();
  }
  if(S.set.labels && f.name){
    const b=bboxOf(f), big=Math.max(b[2]-b[0],b[3]-b[1])*s;
    if(big>46*k){ const a=anchorOf(f), q=T(a[0],a[1]); label(ctx,f.name,q.x,q.y-(f.type==='line'?11*k:0),k); }
  }
}
function handle(ctx,p,col,r,fill){
  ctx.beginPath(); ctx.arc(p.x,p.y,r,0,7); ctx.fillStyle=fill?col:'#fff'; ctx.fill();
  ctx.lineWidth=2.2; ctx.strokeStyle=fill?'#fff':col; ctx.stroke();
}
function paintSelection(ctx){
  const f=selF(); if(!f||S.tool!=='select') return;
  const col=colorOf(f), P=f.pts.map(scr);
  if(f.type==='line'||f.type==='polygon'){
    const n=P.length, segs=f.type==='polygon'?n:n-1;
    if(!moveMode) for(let i=0;i<segs;i++){ const a=P[i], b=P[(i+1)%n]; if(sdist(a,b)>44) handle(ctx,{x:(a.x+b.x)/2,y:(a.y+b.y)/2},rgba(col,.75),4.2,false); }
    P.forEach((p,i)=>handle(ctx,p,col,i===selV?8:6.5,i===selV));
  } else if(f.type==='circle'){
    handle(ctx,P[0],col,6.5,false); handle(ctx,{x:P[0].x+f.r*S.view.s,y:P[0].y},col,6.5,false);
  }
}
function paintDraft(ctx){
  if(!draft) return;
  const col = draft.tool==='measure' ? '#ffffff' : (S.data.layers.find(l=>l.id===S.data.activeLayer)||S.data.layers[0]).color;
  const dcol = draft.tool==='measure' ? '#111' : col;
  if(draft.pts){
    const P=draft.pts.map(scr), Q=hoverPt&&draft.tool!=='free'&&P.length?[...P,A.toScreen(hoverPt.x,hoverPt.y)]:P;
    if(Q.length>1){
      ctx.beginPath(); Q.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      if(draft.tool==='polygon'&&Q.length>2){ ctx.closePath(); ctx.fillStyle=rgba(col,.16); ctx.fill(); }
      cased(ctx,dcol,3,draft.tool==='measure',1);
    }
    if(draft.tool!=='free') P.forEach((p,i)=>handle(ctx,p,dcol==='#111'?'#111':col,i===0&&draft.tool==='polygon'&&P.length>2?8:5.5,false));
  } else if(draft.a){
    const a=A.toScreen(draft.a.x,draft.a.y), b=A.toScreen(draft.b.x,draft.b.y);
    ctx.beginPath();
    if(draft.tool==='rect') ctx.rect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y));
    else if(draft.tool==='circle') ctx.arc(a.x,a.y,sdist(a,b),0,7);
    else { ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); }
    if(draft.tool!=='arrow'){ ctx.fillStyle=rgba(col,.16); ctx.fill(); }
    cased(ctx,col,3,false,1);
  }
}
A.animating=()=>pops.size>0;

/* ===================== creating ===================== */
function autoName(kind){
  const base={point:'Pin',line:'Line',polygon:'Area',circle:'Circle',arrow:'Arrow'}[kind];
  let n=1; const names=new Set(feats().map(f=>f.name));
  while(names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
function create(f, kind){
  const nf={id:uid('f'), layer:S.data.activeLayer, name: f.type==='text' ? '' : autoName(kind||f.type), note:'', t:Date.now(), ...f};
  feats().push(nf); pops.set(nf.id,performance.now());
  draft=null; S.tool='select'; S.sel=nf.id; selV=null; moveMode=false;
  commit(); syncDock(); refreshCtx(); A.render();
  return nf;
}
function finishDraft(){
  if(!draft||!draft.pts) return;
  const n=draft.pts.length;
  if(draft.tool==='line' && n>=2) create({type:'line',pts:draft.pts},'line');
  else if(draft.tool==='polygon' && n>=3) create({type:'polygon',pts:draft.pts},'polygon');
  else { toast(draft.tool==='polygon'?'An area needs at least 3 points':'A line needs at least 2 points'); }
}
function cancelDraft(){ draft=null; hoverPt=null; histButtons(); refreshCtx(); A.render(); }
function gpsPoint(){
  if(!S.xf){ toast('Calibrate this map to use GPS points'); return null; }
  if(!S.fix){ toast('No GPS fix yet'); return null; }
  if(S.fix.acc>30) toast(`GPS is rough right now (±${fmtLen(S.fix.acc,S.set.units)})`,3400);
  const p=S.xf.toPix(S.fix.lat,S.fix.lon); return [p.x,p.y];
}
function addGpsVertex(){
  const p=gpsPoint(); if(!p) return;
  if(S.tool==='point'){ create({type:'point',pts:[p],gps:{lat:S.fix.lat,lon:S.fix.lon,acc:S.fix.acc}}); A.centerOn(p[0],p[1]); return; }
  if(!draft) draft={tool:S.tool,pts:[]};
  draft.pts.push(p); histButtons(); refreshCtx(); A.render();
}

/* ===================== pointer hooks ===================== */
A.toolDown=function(ip,sp){
  if(closeMore()||justClosedMore()) return false;
  const t=S.tool;
  if(t==='free'){ draft={tool:'free',pts:[[ip.x,ip.y]]}; return true; }
  if(t==='rect'||t==='circle'||t==='arrow'){ draft={tool:t,a:ip,b:ip}; return true; }
  if(t!=='select') return false;
  const f=selF(); if(!f) return false;
  if(moveMode){ drag={kind:'move',last:ip}; return true; }
  const P=f.pts.map(scr);
  if(f.type==='line'||f.type==='polygon'){
    let best=-1, bd=22;
    P.forEach((p,i)=>{ const d=sdist(sp,p); if(d<bd){bd=d;best=i;} });
    if(best>=0){ selV=best; drag={kind:'vertex',i:best,moved:false}; refreshCtx(); A.render(); return true; }
    const n=P.length, segs=f.type==='polygon'?n:n-1;
    for(let i=0;i<segs;i++){ const a=P[i], b=P[(i+1)%n]; if(sdist(a,b)<=44) continue;
      if(sdist(sp,{x:(a.x+b.x)/2,y:(a.y+b.y)/2})<17){ f.pts.splice(i+1,0,[ip.x,ip.y]); selV=i+1; drag={kind:'vertex',i:i+1,moved:true}; A.render(); return true; } }
    return false;
  }
  if(f.type==='circle'){
    if(sdist(sp,{x:P[0].x+f.r*S.view.s,y:P[0].y})<22){ drag={kind:'radius'}; return true; }
    if(sdist(sp,P[0])<22){ drag={kind:'move',last:ip}; return true; }
    return false;
  }
  if(hitFeature(sp)===f){ drag={kind:'move',last:ip}; return true; }
  return false;
};
A.toolMove=function(ip){
  if(draft&&draft.tool==='free'){
    const l=draft.pts[draft.pts.length-1];
    if(Math.hypot(ip.x-l[0],ip.y-l[1])*S.view.s>3) draft.pts.push([ip.x,ip.y]);
    A.render(); return;
  }
  if(draft&&draft.a){ draft.b=ip; A.render(); return; }
  const f=selF(); if(!drag||!f) return;
  if(drag.kind==='vertex'){ f.pts[drag.i]=[ip.x,ip.y]; drag.moved=true; }
  else if(drag.kind==='radius'){ f.r=Math.max(2/S.view.s,Math.hypot(ip.x-f.pts[0][0],ip.y-f.pts[0][1])); drag.moved=true; }
  else if(drag.kind==='move'){ const dx=ip.x-drag.last.x, dy=ip.y-drag.last.y; f.pts=f.pts.map(p=>[p[0]+dx,p[1]+dy]); drag.last=ip; drag.moved=true; if(f.gps) delete f.gps; }
  ctxStats(statsText(f)); A.render();
};
A.toolUp=function(ip){
  if(draft&&draft.tool==='free'){
    const pts=rdp(draft.pts,1.3/S.view.s);
    let len=0; for(let i=1;i<pts.length;i++) len+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
    if(pts.length>1 && len*S.view.s>12) create({type:'line',pts},'line'); else { draft=null; A.render(); }
    return;
  }
  if(draft&&draft.a){
    const a=draft.a, b=draft.b, d=Math.hypot(b.x-a.x,b.y-a.y)*S.view.s, t=draft.tool;
    if(d<10){ draft=null; A.render(); toast('Drag to draw'); return; }
    if(t==='rect') create({type:'polygon',pts:[[a.x,a.y],[b.x,a.y],[b.x,b.y],[a.x,b.y]]},'polygon');
    else if(t==='circle') create({type:'circle',pts:[[a.x,a.y]],r:Math.hypot(b.x-a.x,b.y-a.y)});
    else create({type:'line',pts:[[a.x,a.y],[b.x,b.y]],arrow:true},'arrow');
    return;
  }
  if(drag){ const m=drag.moved; drag=null; if(m) commit(); refreshCtx(); A.render(); }
};
A.toolCancel=function(){
  if(draft&&(draft.tool==='free'||draft.a)){ draft=null; A.render(); }
  if(drag){ const m=drag.moved; drag=null; if(m&&hi>=0){ S.data.features=JSON.parse(hist[hi]); A.render(); } }
};
A.toolHover=function(ip){ if(draft&&draft.pts&&draft.pts.length){ hoverPt=ip; A.render(); } };
A.toolTap=async function(ip,sp){
  if(closeMore()||justClosedMore()) return;
  const t=S.tool;
  if(t==='select'){
    const f=hitFeature(sp);
    if(f){ if(S.sel!==f.id){ S.sel=f.id; selV=null; moveMode=false; } lastEmptyTap=0; }
    else if(S.sel){ S.sel=null; selV=null; moveMode=false; }
    else { const now=performance.now(); if(now-lastEmptyTap<320){ A.zoomAt(sp.x,sp.y,2); lastEmptyTap=0; } else lastEmptyTap=now; }
    refreshCtx(); A.render(); return;
  }
  if(t==='point'){ create({type:'point',pts:[[ip.x,ip.y]]}); return; }
  if(t==='text'){
    const r=await dialog({title:'Text on the map',fields:[{name:'t',placeholder:'Type a label or note'}],ok:'Place'});
    if(r&&r.t.trim()) create({type:'text',pts:[[ip.x,ip.y]],text:r.t.trim(),size:17/S.view.s});
    return;
  }
  if(t==='line'||t==='polygon'||t==='measure'){
    if(!draft) draft={tool:t,pts:[]};
    const P=draft.pts.map(scr);
    if(t==='polygon'&&P.length>=3&&sdist(sp,P[0])<22){ finishDraft(); return; }
    if(t==='line'&&P.length>=2&&sdist(sp,P[P.length-1])<20){ finishDraft(); return; }
    draft.pts.push([ip.x,ip.y]); hoverPt=null; histButtons(); refreshCtx(); A.render();
  }
};

/* ===================== tools / dock ===================== */
function setTool(id){
  if(draft&&draft.pts){
    if((draft.tool==='line'&&draft.pts.length>=2)||(draft.tool==='polygon'&&draft.pts.length>=3)){ finishDraft(); if(id==='select') return; }
  }
  draft=null; hoverPt=null; drag=null; moveMode=false;
  S.tool=id; if(id!=='select'){ S.sel=null; selV=null; }
  syncDock(); histButtons(); refreshCtx(); A.render();
}
A.setTool=setTool;
let moreClosed=0;
function closeMore(outside){ const m=$('more'); if(m&&m.classList.contains('show')){ m.classList.remove('show'); if(outside) moreClosed=performance.now(); return true; } return false; }
const justClosedMore=()=>performance.now()-moreClosed<450;
function buildDock(){
  const d=$('dock'); d.innerHTML='';
  d.append(h('div',{id:'dockhi'}));
  for(const t of TOOLS) d.append(h('button',{class:'tb','data-t':t.id,title:`${t.label} (${t.key.toUpperCase()})`,onclick:()=>{ closeMore(); setTool(t.id); },
    html:ICON[t.icon]+`<span>${t.label}</span>`}));
  d.append(h('button',{class:'tb',id:'moreb',title:'More tools',onclick:e=>{ e.stopPropagation(); $('more').classList.toggle('show'); },html:ICON.more+'<span>More</span>'}));
  d.append(h('div',{id:'more'}, MORE.map(t=>h('button',{class:'mi','data-t':t.id,title:`${t.label} (${t.key.toUpperCase()})`,
    onclick:()=>{ closeMore(); setTool(t.id); },html:ICON[t.icon]+`<span>${t.label}</span>`}))));
}
function syncDock(){
  const d=$('dock'), more=MORE.find(t=>t.id===S.tool), mb=$('moreb');
  mb.innerHTML=ICON[more?more.icon:'more']+`<span>${more?more.label:'More'}</span>`;
  let on=null;
  d.querySelectorAll('.tb').forEach(b=>{ const a=b.dataset.t===S.tool||(b===mb&&more); b.classList.toggle('on',!!a); if(a) on=b; });
  d.querySelectorAll('.mi').forEach(b=>b.classList.toggle('on',b.dataset.t===S.tool));
  const hl=$('dockhi');
  if(on&&on.offsetWidth){ hl.style.width=on.offsetWidth+'px'; hl.style.transform=`translateX(${on.offsetLeft-5}px)`; hl.style.opacity=1; }
  $('cv').classList.toggle('draw',S.tool!=='select');
}
window.addEventListener('resize',()=>{ if(S.map) syncDock(); });

/* ===================== context bar ===================== */
const cbtn=(icon,label,fn,cls='',title)=>h('button',{class:'cb '+cls+(label?'':' icon'),onclick:fn,title:title||label||'',
  'aria-label':title||label,html:(icon?ICON[icon]:'')+(label?`<span>${label}</span>`:'')});
function ctxStats(t){ const e=$('ctx').querySelector('.ct2'); if(e) e.textContent=t; }
function refreshCtx(){
  const c=$('ctx'); if(!S.map){ return; }
  let t1='', t2='', btns=[];
  const t=S.tool, f=selF(), gpsOK=!!S.xf;
  if(S.mode==='calib'){ c.classList.add('hid'); return; }
  if(t==='select'){
    if(!f){ c.classList.add('hid'); c.innerHTML=''; return; }
    t1 = f.type==='text' ? (f.text||'Text') : (f.name||'Unnamed');
    t2 = moveMode ? 'Drag to move it' : `${layerOf(f).name}${statsText(f)?' · '+statsText(f):''}`;
    const canDelV = selV!=null && (f.type==='line'?f.pts.length>2:f.type==='polygon'?f.pts.length>3:false);
    if(canDelV) btns.push(cbtn('vertex','',()=>{ f.pts.splice(selV,1); selV=null; commit(); refreshCtx(); A.render(); },'dng','Delete this point'));
    if(f.type==='line'||f.type==='polygon') btns.push(cbtn('move','',()=>{ moveMode=!moveMode; refreshCtx(); A.render(); },moveMode?'on':'','Move whole shape'));
    btns.push(cbtn('edit','',()=>openDetails(f),'','Details'));
    btns.push(cbtn('trash','',()=>delFeature(f),'dng','Delete'));
  } else if(t==='point'){
    t1='Tap the map to drop a pin'; t2=layerName();
    if(gpsOK) btns.push(cbtn('gps','At my location',addGpsVertex,'pri'));
  } else if(t==='text'){ t1='Tap where the text goes'; t2=layerName(); }
  else if(t==='free'){ t1='Drag to draw'; t2='Two fingers to move the map'; }
  else if(t==='rect'||t==='circle'||t==='arrow'){ t1=`Drag to draw ${t==='arrow'?'an arrow':t==='rect'?'a rectangle':'a circle'}`; t2='Two fingers to move the map'; }
  else {
    const n=draft&&draft.pts?draft.pts.length:0, need=t==='polygon'?3:2;
    t1 = n ? `${n} point${n>1?'s':''}` : (t==='measure'?'Tap points to measure':'Tap to add points');
    t2 = n ? (draftStats()||(S.xf?'':'Calibrate for distances')) : (t==='measure'?'':layerName());
    if(n) btns.push(cbtn('undo','',()=>{ draft.pts.pop(); histButtons(); refreshCtx(); A.render(); },'','Remove last point'));
    if(gpsOK) btns.push(cbtn('gps',n?'':'My location',addGpsVertex,'','Add a point at my GPS position'));
    if(t!=='measure'&&n>=need) btns.push(cbtn('check','Done',finishDraft,'pri'));
    if(n) btns.push(cbtn('x','',cancelDraft,'',t==='measure'?'Clear':'Cancel'));
  }
  c.innerHTML='';
  const txt=h('div',{class:'ctxt'},h('div',{class:'ct1'},t1),h('div',{class:'ct2'},t2));
  if(t==='select'&&f) txt.onclick=()=>openDetails(f);
  c.append(txt,...btns);
  c.classList.remove('hid');
}
A.refreshCtx=refreshCtx;
const layerName=()=>'On layer: '+(S.data.layers.find(l=>l.id===S.data.activeLayer)||S.data.layers[0]).name;

async function delFeature(f){
  S.data.features=feats().filter(x=>x!==f); S.sel=null; selV=null; moveMode=false;
  commit(); closeSheet(); refreshCtx(); A.render(); toast('Deleted · Undo brings it back');
}
A.selectFeature=function(id,zoom){
  const f=feats().find(x=>x.id===id); if(!f) return;
  if(S.tool!=='select') setTool('select');
  S.sel=id; selV=null; moveMode=false; refreshCtx();
  if(zoom){ const b=bboxOf(f); if(f.type==='point'||f.type==='text') A.centerOn(f.pts[0][0],f.pts[0][1],Math.max(S.view.s,Math.min(S.W,S.H)/S.map.imgW*3)); else A.zoomToBox(...b); }
  A.render();
};

/* ===================== details sheet ===================== */
function chips(opts,cur,fn){
  const box=h('div',{class:'chips'});
  opts.forEach(([v,l])=>box.append(h('button',{class:'chip'+(v===cur?' on':''),onclick:e=>{
    box.querySelectorAll('.chip').forEach(c=>c.classList.remove('on')); e.currentTarget.classList.add('on'); fn(v); }},l)));
  return box;
}
function swatches(cur,fn,withLayer){
  const box=h('div',{class:'sws'});
  const mk=(v,css,title)=>h('button',{class:'swb'+(v===cur?' on':''),title,style:{background:css},onclick:e=>{
    box.querySelectorAll('.swb').forEach(c=>c.classList.remove('on')); e.currentTarget.classList.add('on'); fn(v); }});
  if(withLayer) box.append(mk(null,`conic-gradient(${withLayer} 0 50%, #2a332b 0 100%)`,'Use the layer color'));
  PALETTE.forEach(c=>box.append(mk(c,c,c)));
  return box;
}
function openDetails(f){
  const ch=()=>{ commitSoon(); refreshCtx(); };
  const fld=(label,node)=>h('label',{class:'fld'},h('span',{},label),node);
  const name=h('input',{class:'inp',value:f.type==='text'?(f.text||''):(f.name||''),placeholder:f.type==='text'?'Text':'Name',
    oninput:e=>{ if(f.type==='text') f.text=e.target.value; else f.name=e.target.value; ch(); }});
  const note=h('textarea',{class:'inp',rows:3,placeholder:'Notes',oninput:e=>{ f.note=e.target.value; ch(); }}); note.value=f.note||'';
  const st=featureStats(f), u=S.set.units, stat=h('div',{class:'stat'});
  const sb=(v,l)=>stat.append(h('div',{},h('b',{},v),h('span',{},l)));
  if(st.area!=null) sb(fmtArea(st.area,u),'Area');
  if(st.radius!=null) sb(fmtLen(st.radius,u),'Radius');
  if(st.len!=null) sb(fmtLen(st.len,u),f.type==='line'?'Length':'Perimeter');
  if(st.lat!=null) sb(fmtLL(st.lat,st.lon),f.gps?`GPS position · ±${fmtLen(f.gps.acc,u)}`:'Position on map');
  const closed=f.type==='polygon'||f.type==='circle', shape=closed||f.type==='line';
  const tog=(val,fn)=>{ const b=h('button',{class:'tog'+(val?' on':''),onclick:()=>{ const v=!b.classList.contains('on'); b.classList.toggle('on',v); fn(v); }}); return b; };
  sheet(f.type==='text'?'Text':({point:'Pin',line:f.arrow?'Arrow':'Line',polygon:'Area',circle:'Circle'}[f.type]), h('div',{},
    stat.children.length?stat:null,
    fld(f.type==='text'?'Text':'Name',name), fld('Notes',note),
    fld('Layer',chips(S.data.layers.map(l=>[l.id,l.name]),layerOf(f).id,v=>{ f.layer=v; ch(); })),
    fld('Color',swatches(f.color||null,v=>{ if(v) f.color=v; else delete f.color; ch(); },layerOf(f).color)),
    f.type==='text'?fld('Size',chips([[.7,'Smaller'],[1,'Same'],[1.4,'Larger']],1,v=>{ f.size*=v; ch(); })):null,
    shape?fld('Line weight',chips([[2,'Thin'],[3.2,'Medium'],[5.5,'Thick']],f.width||3.2,v=>{ f.width=v; ch(); })):null,
    closed?fld('Fill',chips([[0,'None'],[.2,'Light'],[.45,'Strong']],f.fill??.2,v=>{ f.fill=v; ch(); })):null,
    shape?h('div',{class:'row'},h('div',{class:'rm'},h('div',{class:'r1'},'Dashed line')),tog(f.dash,v=>{ f.dash=v; ch(); })):null,
    f.type==='line'?h('div',{class:'row'},h('div',{class:'rm'},h('div',{class:'r1'},'Arrowhead')),tog(f.arrow,v=>{ f.arrow=v; ch(); })):null,
    h('div',{class:'brow'},
      h('button',{class:'btn danger',onclick:()=>delFeature(f),html:ICON.trash+'<span>Delete</span>'}),
      h('button',{class:'btn primary',onclick:()=>closeSheet(),html:ICON.check+'<span>Done</span>'}))),
    {onclose:()=>{ if(commitT) commit(); refreshCtx(); A.render(); }});
}

/* ===================== layers sheet ===================== */
$('layersb').onclick=()=>openLayers();
function openLayers(){
  const body=h('div',{});
  const draw=()=>{
    body.innerHTML='';
    body.append(h('div',{class:'sec'},'Layers · tap one to draw on it'));
    for(const L of S.data.layers){
      const n=feats().filter(f=>layerOf(f)===L).length, act=L.id===S.data.activeLayer;
      body.append(h('div',{class:'row tap'+(act?' act':''),onclick:()=>{ S.data.activeLayer=L.id; A.saveData(); refreshCtx(); draw(); }},
        h('span',{class:'sw',style:{background:L.color}}),
        h('div',{class:'rm'},h('div',{class:'r1'},L.name),h('div',{class:'r2'},`${n} item${n===1?'':'s'}${act?' · drawing here':''}`)),
        h('button',{class:'rbtn'+(L.visible===false?' off':''),title:'Show or hide',html:ICON[L.visible===false?'eyeoff':'eye'],
          onclick:e=>{ e.stopPropagation(); L.visible=L.visible===false; A.saveData(); A.render(); draw(); }}),
        h('button',{class:'rbtn',title:'Edit layer',html:ICON.edit,onclick:e=>{ e.stopPropagation(); editLayer(L); }})));
    }
    body.append(h('div',{class:'row tap',onclick:async()=>{
      const r=await dialog({title:'New layer',fields:[{name:'n',placeholder:'Layer name'}],ok:'Add'});
      if(r&&r.n.trim()){ const used=S.data.layers.map(l=>l.color), col=PALETTE.find(c=>!used.includes(c)&&c!=='#ffffff')||PALETTE[0];
        const L={id:uid('l'),name:r.n.trim().slice(0,40),color:col,visible:true}; S.data.layers.push(L); S.data.activeLayer=L.id; A.saveData(); refreshCtx(); draw(); } }},
      h('span',{html:ICON.plus}),h('div',{class:'rm'},h('div',{class:'r1'},'Add layer'))));
    if(feats().length){
      body.append(h('div',{class:'sec'},'On this map'));
      for(const L of S.data.layers) for(const f of feats().filter(x=>layerOf(x)===L)){
        const ic=h('span',{html:ICON[TYPE_ICON[f.type]],style:{color:colorOf(f)}});
        body.append(h('div',{class:'frow',onclick:()=>{ if(window.innerWidth<900) closeSheet(); if(L.visible===false){ L.visible=true; } A.selectFeature(f.id,true); }},
          ic,h('span',{class:'fn'},f.type==='text'?(f.text||'Text'):(f.name||'Unnamed')),h('span',{class:'fs'},f.type==='point'||f.type==='text'?L.name:statsText(f).split(' · ')[0])));
      }
    } else body.append(h('div',{class:'note'},'Nothing drawn yet. Pick a tool from the bar at the bottom.'));
  };
  draw();
  sheet('Layers',body);
}
A.openLayers=openLayers;
function editLayer(L){
  const n=feats().filter(f=>layerOf(f)===L).length;
  const name=h('input',{class:'inp',value:L.name,oninput:e=>{ L.name=e.target.value.slice(0,40)||'Layer'; A.saveData(); }});
  sheet('Edit layer',h('div',{},
    h('label',{class:'fld'},h('span',{},'Name'),name),
    h('label',{class:'fld'},h('span',{},'Color'),swatches(L.color,v=>{ L.color=v; A.saveData(); A.render(); })),
    h('div',{class:'brow'},
      S.data.layers.length>1?h('button',{class:'btn danger',html:ICON.trash+'<span>Delete layer</span>',onclick:async()=>{
        const ok=await dialog({title:'Delete this layer?',text:n?`“${L.name}” and its ${n} item${n===1?'':'s'} will be deleted. This can't be undone.`:`“${L.name}” will be removed.`,ok:'Delete',danger:true});
        if(!ok) return;
        S.data.features=feats().filter(f=>layerOf(f)!==L); S.data.layers=S.data.layers.filter(x=>x!==L);
        if(S.data.activeLayer===L.id) S.data.activeLayer=S.data.layers[0].id;
        S.sel=null; hist=[snapshot()]; hi=0; histButtons(); A.saveData(); A.render(); openLayers(); }}):null,
      h('button',{class:'btn primary',html:ICON.check+'<span>Done</span>',onclick:()=>openLayers()}))));
}

/* ===================== keyboard ===================== */
A.toolKey=function(e){
  const k=e.key.toLowerCase(), mod=e.ctrlKey||e.metaKey;
  if(mod&&k==='z'){ e.shiftKey?redo():undo(); return true; }
  if(mod&&k==='y'){ redo(); return true; }
  if(mod||e.altKey) return false;
  if(k==='escape'){ if(closeMore()) return true; if(draft) cancelDraft(); else if(S.sel){ S.sel=null; refreshCtx(); A.render(); } else setTool('select'); return true; }
  if(k==='enter'){ if(draft&&draft.pts){ finishDraft(); return true; } return false; }
  if(k==='delete'||k==='backspace'){
    const f=selF(); if(!f) return false;
    if(selV!=null&&((f.type==='line'&&f.pts.length>2)||(f.type==='polygon'&&f.pts.length>3))){ f.pts.splice(selV,1); selV=null; commit(); refreshCtx(); A.render(); }
    else delFeature(f);
    return true;
  }
  const t=ALL.find(x=>x.key===k); if(t){ setTool(t.id); return true; }
  return false;
};

/* ===================== lifecycle ===================== */
A.toolsOpen=function(){
  draft=null; drag=null; selV=null; moveMode=false; hoverPt=null; pops.clear();
  hist=[snapshot()]; hi=0; S.tool='select'; S.sel=null;
  buildDock(); requestAnimationFrame(()=>{ syncDock(); setTimeout(syncDock,420); }); histButtons(); refreshCtx();
};
export function initTools(){
  $('undo').onclick=undo; $('redo').onclick=redo;
  document.addEventListener('pointerdown',e=>{ if(!e.target.closest('#more')&&!e.target.closest('#moreb')) closeMore(true); },true);
}
