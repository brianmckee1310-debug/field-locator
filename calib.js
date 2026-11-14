/* ============ pin calibration: place any map or image on the ground ============ */
import { S, A, ICON } from './state.js';
import { $, h, toast, dialog, fmtLen, fmtLL } from './ui.js';
import { parseLatLon, fitTransform } from './geo.js';

let adding=false, avg=null;

/* which pin is the odd one out?  Refit without each pin in turn: if dropping one makes the rest agree, that's the culprit. */
function suspect(){
  const c=S.map.ctrl, T=S.xf;
  if(!T||T.rms==null||T.rms<=12||c.length<4) return -1;
  let best=-1, bestR=Infinity;
  c.forEach((_,i)=>{ const t=fitTransform(c.filter((_,j)=>j!==i),S.map.fit); if(t&&t.rms!=null&&t.rms<bestR){ bestR=t.rms; best=i; } });
  return bestR<T.rms*0.4 ? best : -1;
}
const usingOriginal = () => S.map.origSrc && S.map.geoSrc===S.map.origSrc;
const cb=(icon,label,fn,cls='')=>h('button',{class:'cb '+cls,onclick:fn,html:(icon?ICON[icon]:'')+`<span>${label}</span>`});

function status(){
  const n=S.map.ctrl.length, T=S.xf, u=S.set.units;
  if(n===0) return ['Add a pin at a spot you can find both on this map and on the ground: a corner, a gate, a culvert.',''];
  if(n===1) return ['One more pin and the map goes live. Pick a spot far from the first one.',''];
  if(!T) return ['These pins are at the same place on the ground. Move or replace one.','bad'];
  const diag=Math.hypot(S.map.imgW,S.map.imgH), bunched=T.spreadPx<diag*0.22;
  if(T.flipped) return ['These pins imply a mirrored map, so one is probably misplaced.','bad'];
  if(n===2) return ['The map is live. A third pin lets me check the fit and show the error.'+(bunched?' These two are close together; a far-apart pin will help a lot.':''),bunched?'bad':'good'];
  if(T.rms==null) return ['The map is live. One more pin lets me check the fit.','good'];
  const bad=T.rms>12, sus=suspect();
  return [`Typical error ${fmtLen(T.rms,u)} across ${n} pins.`+(bad?(sus>=0?` Pin ${sus+1} disagrees with the others; check it or remove it.`:' The pins disagree. Add another pin so I can tell which one is off.'):'')+(bunched?' Pins are bunched together; spread them out for a better fit.':''),
          bad||bunched?'bad':'good'];
}
function draw(){
  const c=$('calib'); c.innerHTML='';
  const head=h('div',{class:'calh'},h('b',{},'Calibrate map'),cb('check','Done',()=>A.exitCalib(),'pri'));
  if(avg){ c.append(head,h('div',{class:'cals'},`Averaging GPS… hold still (${avg.left})`)); return; }
  if(adding){
    c.append(h('div',{class:'calh'},h('b',{},`Pin ${S.map.ctrl.length+1}`)),
      h('div',{class:'cals'},'Move the map until the red crosshair sits exactly on a spot you can identify.'),
      h('div',{class:'calb'}, cb('gps','I\'m standing here',pinFromGPS,'pri'), cb('edit','Type coordinates',pinFromText), cb('x','Cancel',()=>{ setAdding(false); })));
    return;
  }
  if(usingOriginal()){
    c.append(head,h('div',{class:'cals good'}, S.map.geoSrc==='pdf'
      ? 'This map came georeferenced from the PDF. You only need your own pins if your position looks wrong on it.'
      : 'This aerial is already georeferenced. You only need your own pins if your position looks wrong on it.'),
      h('div',{class:'calb'},cb('calib','Use my own pins instead',async()=>{
        const ok=await dialog({title:'Replace the built-in georeferencing?',text:'Your position will disappear until you add two pins. You can restore the original at any time.',ok:'Replace'});
        if(!ok) return; S.map.ctrl=[]; S.map.geoSrc='pins'; S.map.fit='similarity'; apply(); })));
    return;
  }
  const [msg,cls]=status(), T=S.xf, u=S.set.units, sus=suspect();
  c.append(head,h('div',{class:'cals '+cls},msg));
  if(S.map.ctrl.length){
    const list=h('div',{class:'pins'});
    S.map.ctrl.forEach((p,i)=>{
      const r=T&&T.rms!=null?T.residuals[i]:null, bad=i===sus;
      list.append(h('div',{class:'pinr'},h('span',{class:'pinn'},String(i+1)),
        h('span',{class:'g',onclick:()=>A.centerOn(p.px,p.py)},fmtLL(p.lat,p.lon)),
        h('span',{class:'e'+(bad?' bad':'')}, r!=null?`off ${fmtLen(r,u)}`:(p.src==='gps'?`±${fmtLen(p.acc||0,u)}`:'typed')),
        h('button',{title:'Remove pin',onclick:()=>{ S.map.ctrl.splice(i,1); apply(); }},'✕')));
    });
    c.append(list);
  }
  const row=h('div',{class:'calb'},cb('plus','Add pin',()=>setAdding(true),'pri'));
  if(S.map.ctrl.length>=4) row.append(cb(null,S.map.fit==='affine'?'Stretch fix: on':'Stretch fix: off',()=>{ S.map.fit=S.map.fit==='affine'?'similarity':'affine'; apply(); },S.map.fit==='affine'?'on':''));
  if(S.map.origCtrl) row.append(cb('undo','Restore original',()=>{ S.map.ctrl=S.map.origCtrl.map(p=>({...p})); S.map.geoSrc=S.map.origSrc; S.map.fit=S.map.origFit||'affine'; apply(); }));
  c.append(row);
}
function apply(){
  if(S.map.ctrl.length<4 && S.map.geoSrc==='pins') S.map.fit='similarity';
  A.refit(); A.saveMap(); draw();
}
function setAdding(v){ adding=v; $('cross').classList.toggle('on',v); draw(); A.render(); }
function addPin(lat,lon,extra){
  const was=!!S.xf, ip=A.toImage(S.W/2,S.H/2);
  S.map.ctrl.push({px:ip.x,py:ip.y,lat,lon,...extra});
  S.map.geoSrc='pins';
  setAdding(false); apply();
  if(!was&&S.xf) toast('The map is live — your position now shows on it',3800);
}
function pinFromGPS(){
  if(!('geolocation' in navigator)){ toast('This device has no GPS'); return; }
  if(!S.fix || Date.now()-S.fix.t>15000){ toast('No GPS fix yet — wait for the dot at the top to turn green'); return; }
  const samples=[S.fix]; const on=f=>samples.push(f);
  S.fixListeners.add(on);
  avg={left:5}; draw();
  const tick=setInterval(()=>{
    avg.left--;
    if(avg.left>0){ draw(); return; }
    clearInterval(tick); S.fixListeners.delete(on); avg=null;
    let sw=0,la=0,lo=0,ac=0;
    for(const f of samples){ const w=1/Math.max(1,f.acc*f.acc); sw+=w; la+=f.lat*w; lo+=f.lon*w; ac+=f.acc; }
    const acc=ac/samples.length;
    addPin(la/sw,lo/sw,{src:'gps',acc});
    if(acc>20) toast(`GPS was rough for that pin (±${fmtLen(acc,S.set.units)}). Consider redoing it in the open.`,5200);
  },1000);
}
async function pinFromText(){
  const r=await dialog({title:'Coordinates of the crosshair',text:'Latitude, then longitude. In Google Maps, press and hold a spot to see them.',
    fields:[{name:'c',placeholder:'42.00700, -88.20600',inputMode:'text'}],ok:'Add pin'});
  if(!r) return;
  const g=parseLatLon(r.c);
  if(!g){ toast('Couldn\'t read those coordinates. Try: 42.00700, -88.20600',4200); return; }
  addPin(g.lat,g.lon,{src:'typed'});
}

A.paintCalib=function(ctx){
  if(S.mode!=='calib'||!S.map||usingOriginal()) return;
  const sus=suspect();
  S.map.ctrl.forEach((p,i)=>{
    const s=A.toScreen(p.px,p.py), bad=i===sus;
    ctx.lineWidth=4; ctx.strokeStyle='rgba(255,255,255,.9)';
    ctx.beginPath(); ctx.moveTo(s.x-15,s.y); ctx.lineTo(s.x+15,s.y); ctx.moveTo(s.x,s.y-15); ctx.lineTo(s.x,s.y+15); ctx.stroke();
    ctx.lineWidth=2; ctx.strokeStyle=bad?'#f0c674':'#ff3b5c'; ctx.stroke();
    ctx.beginPath(); ctx.arc(s.x+15,s.y-15,10,0,7); ctx.fillStyle=bad?'#f0c674':'#ff3b5c'; ctx.fill(); ctx.lineWidth=2; ctx.strokeStyle='#fff'; ctx.stroke();
    ctx.fillStyle=bad?'#222':'#fff'; ctx.font='700 11px system-ui,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(String(i+1),s.x+15,s.y-14.5);
  });
};
A.enterCalib=function(){
  if(!S.map||S.mode==='calib') return;
  A.setTool('select'); S.sel=null;
  S.mode='calib'; adding=false; avg=null;
  $('dock').classList.add('gone'); $('hist').classList.add('gone'); $('calib').classList.remove('gone');
  A.refreshCtx(); draw(); A.render();
  if(!usingOriginal() && S.map.ctrl.length<2) setAdding(true);
};
A.exitCalib=function(silent){
  S.mode='map'; adding=false; avg=null; $('cross').classList.remove('on');
  $('dock').classList.remove('gone'); $('hist').classList.remove('gone'); $('calib').classList.add('gone');
  if(!silent){ A.setTool('select'); A.updateReadout(); A.render();
    if(!S.xf) toast('Not calibrated yet — you can still draw, but GPS and measurements need two pins',4600); }
};
export function initCalib(){}
