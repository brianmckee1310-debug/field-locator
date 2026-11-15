/* ============ breadcrumb trails ============ */
import { S, A, ICON, saveSet } from './state.js';
import { $, h, uid, toast, sheet, closeSheet, dialog, fmtLen, fmtDur } from './ui.js';
import { dist } from './geo.js';

let rec=null, wake=null, sheetLive=null;
const TCOLORS=['#e52592','#12b5cb','#f9ab00','#9334e6','#d93025'];

export const trackLen = t => { let d=0; for(let i=1;i<t.pts.length;i++) d+=dist(t.pts[i-1][0],t.pts[i-1][1],t.pts[i][0],t.pts[i][1]); return d; };
A.trackLen=trackLen;
A.isRecording=()=>!!rec;

async function wakeOn(){
  if(!S.set.wake||!('wakeLock' in navigator)) return;
  try{ wake=await navigator.wakeLock.request('screen'); wake.addEventListener('release',()=>{ wake=null; }); }catch(e){}
}
function wakeOff(){ try{ wake&&wake.release(); }catch(e){} wake=null; }
document.addEventListener('visibilitychange',()=>{ if(rec&&!document.hidden&&!wake) wakeOn(); });

function onFix(f){
  if(!rec) return;
  const t=rec.track, now=Date.now();
  if(f.acc>60) return;                                  // too rough to be worth a breadcrumb
  if(t.pts.length && now-rec.last < S.set.interval*1000-700) return;
  const l=t.pts[t.pts.length-1];
  t.end=now;
  if(l && dist(l[0],l[1],f.lat,f.lon)<2){ rec.last=now; return; }   // standing still: don't pile up points
  t.pts.push([+f.lat.toFixed(7),+f.lon.toFixed(7),now,Math.round(f.acc)]);
  rec.last=now; badge(); A.saveData(); A.render();
  if(sheetLive) sheetLive();
}
function badge(){ $('trackb').classList.toggle('rec',!!rec); $('recbadge').textContent=rec?rec.track.pts.length:''; }
function start(){
  if(!('geolocation' in navigator)){ toast('This device has no GPS'); return; }
  const n=S.data.tracks.length;
  const d=new Date(), nm=`Trail ${d.toLocaleDateString(undefined,{month:'short',day:'numeric'})} ${d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`;
  const t={id:uid('t'),name:nm,color:TCOLORS[n%TCOLORS.length],visible:true,pts:[],start:Date.now(),end:Date.now()};
  S.data.tracks.push(t); rec={track:t,last:0};
  S.fixListeners.add(onFix); wakeOn(); A.restartGPS();
  if(S.fix && Date.now()-S.fix.t<8000) onFix(S.fix);
  badge(); A.saveData(); A.render();
  toast(`Trail started · a point every ${ivLabel(S.set.interval)}`);
}
function stop(quiet){
  if(!rec) return;
  const t=rec.track; rec=null;
  S.fixListeners.delete(onFix); wakeOff(); A.restartGPS();
  t.end=Date.now();
  if(t.pts.length<2){ S.data.tracks=S.data.tracks.filter(x=>x!==t); if(!quiet) toast('Trail was too short to keep'); }
  else if(!quiet) toast(`Trail saved · ${fmtLen(trackLen(t),S.set.units)}`);
  badge(); A.saveData(true); A.render();
}
const ivLabel = s => s<60 ? `${s} s` : `${s/60} min`;

A.paintTracks=function(ctx,T,k){
  if(!S.data||!S.xf) return;
  for(const t of S.data.tracks){
    if(t.visible===false||!t.pts.length) continue;
    const P=t.pts.map(p=>{ const q=S.xf.toPix(p[0],p[1]); return T(q.x,q.y); });
    ctx.lineJoin=ctx.lineCap='round';
    if(P.length>1){
      ctx.beginPath(); P.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      ctx.strokeStyle='rgba(255,255,255,.9)'; ctx.lineWidth=5.4*k; ctx.stroke();
      ctx.strokeStyle=t.color; ctx.lineWidth=3*k; ctx.stroke();
    }
    let last=null;
    P.forEach((p,i)=>{
      const end=i===0||i===P.length-1;
      if(!end && last && Math.hypot(p.x-last.x,p.y-last.y)<13*k) return;
      last=p; ctx.beginPath(); ctx.arc(p.x,p.y,(end?5.2:3)*k,0,7); ctx.fillStyle=end?t.color:'#fff'; ctx.fill();
      ctx.lineWidth=(end?2.2:1.6)*k; ctx.strokeStyle=end?'#fff':t.color; ctx.stroke();
    });
  }
};

function trackSheet(){
  const body=h('div',{});
  const draw=()=>{
    body.innerHTML='';
    const u=S.set.units;
    if(rec){
      const t=rec.track;
      body.append(h('div',{class:'stat'},
        h('div',{},h('b',{},fmtLen(trackLen(t),u)),h('span',{},'Distance')),
        h('div',{},h('b',{},fmtDur(Date.now()-t.start)),h('span',{},'Time')),
        h('div',{},h('b',{},String(t.pts.length)),h('span',{},'Points'))),
        h('button',{class:'btn recb wide',onclick:()=>{ stop(); draw(); },html:ICON.stop+'<span>Stop and save trail</span>'}));
    } else {
      body.append(h('button',{class:'btn primary wide',onclick:()=>{ start(); draw(); },html:ICON.rec+'<span>Start a trail</span>'}));
      if(!S.xf) body.append(h('div',{class:'note'},'This map isn\'t calibrated, so the trail will record but won\'t draw until it is.'));
    }
    body.append(h('div',{class:'sec'},'Drop a point every'));
    const ch=h('div',{class:'chips'});
    [5,10,30,60,120,300].forEach(s=>ch.append(h('button',{class:'chip'+(S.set.interval===s?' on':''),onclick:()=>{ S.set.interval=s; saveSet(); if(rec) A.restartGPS(); draw(); }},ivLabel(s))));
    body.append(ch);
    const tog=(key,l1,l2)=>{ const b=h('button',{class:'tog'+(S.set[key]?' on':''),onclick:()=>{ S.set[key]=!S.set[key]; saveSet(); b.classList.toggle('on',S.set[key]);
        if(rec){ if(key==='wake'){ S.set.wake?wakeOn():wakeOff(); } else A.restartGPS(); } }});
      return h('div',{class:'row'},h('div',{class:'rm'},h('div',{class:'r1'},l1),h('div',{class:'r2'},l2)),b); };
    body.append(h('div',{class:'sec'},'While recording'),
      tog('wake','Keep the screen on','Recording pauses if the phone locks'),
      tog('saver','Battery saver','GPS rests between points; your dot updates less often'),
      h('div',{class:'note'},'Trails record only while this app is open on screen. Points closer than about 6 ft to the last one are skipped.'));
    const saved=S.data.tracks.filter(t=>!rec||t!==rec.track);
    if(saved.length){
      body.append(h('div',{class:'sec'},'Saved trails'));
      for(const t of [...saved].reverse()){
        body.append(h('div',{class:'row tap',onclick:()=>editTrack(t)},
          h('span',{class:'sw',style:{background:t.color}}),
          h('div',{class:'rm'},h('div',{class:'r1'},t.name),h('div',{class:'r2'},`${fmtLen(trackLen(t),u)} · ${fmtDur(t.end-t.start)} · ${t.pts.length} points`)),
          h('button',{class:'rbtn'+(t.visible===false?' off':''),html:ICON[t.visible===false?'eyeoff':'eye'],title:'Show or hide',
            onclick:e=>{ e.stopPropagation(); t.visible=t.visible===false; A.saveData(); A.render(); draw(); }})));
      }
    }
  };
  draw(); sheetLive=draw;
  sheet('Breadcrumb trails',body,{onclose:()=>{ sheetLive=null; }});
}
A.trackSheet=trackSheet;
function editTrack(t){
  const name=h('input',{class:'inp',value:t.name,oninput:e=>{ t.name=e.target.value.slice(0,60)||'Trail'; A.saveData(); }});
  const row=(icon,label,fn,cls='')=>h('div',{class:'row tap',onclick:fn},h('span',{html:ICON[icon]}),h('div',{class:'rm'},h('div',{class:'r1'},label)));
  sheet('Trail',h('div',{},
    h('label',{class:'fld'},h('span',{},'Name'),name),
    S.xf?row('target','Show on map',()=>{ closeSheet(); t.visible=true;
      const P=t.pts.map(p=>S.xf.toPix(p[0],p[1])); A.zoomToBox(Math.min(...P.map(p=>p.x)),Math.min(...P.map(p=>p.y)),Math.max(...P.map(p=>p.x)),Math.max(...P.map(p=>p.y))); }):null,
    S.xf?row('polygon','Covered area from a swath',async()=>{ closeSheet(); await A.coverSheet(t.pts.map(p=>[p[0],p[1]]), t.name); }):null,
    S.xf?row('line','Copy to a line I can edit',()=>{ const P=t.pts.map(p=>{ const q=S.xf.toPix(p[0],p[1]); return [q.x,q.y]; });
      S.data.features.push({id:uid('f'),type:'line',layer:S.data.activeLayer,name:t.name,note:'',t:Date.now(),pts:P}); A.commit(); closeSheet(); A.render(); toast('Added as a line on the active layer'); }):null,
    row('share','Export this trail (GPX)',()=>A.exportTrackGPX(t)),
    row('trash','Delete trail',async()=>{ const ok=await dialog({title:'Delete this trail?',text:t.name,ok:'Delete',danger:true});
      if(ok){ S.data.tracks=S.data.tracks.filter(x=>x!==t); A.saveData(); A.render(); trackSheet(); } }),
    h('div',{class:'brow'},h('button',{class:'btn primary',onclick:()=>trackSheet(),html:ICON.check+'<span>Done</span>'}))));
}
A.trackOpen=()=>{ rec=null; badge(); };
A.trackClose=()=>{ if(rec) stop(true); };
export function initTrack(){ $('trackb').onclick=trackSheet; }
