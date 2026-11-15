/* ============ a walked line -> the ground it covered ============
   Give a trail (or a line you drew) a working width -- mower deck, spray
   boom, blanket width -- and get the swath back as an area you can see and
   report. The outline is built by offsetting the line on both sides with
   round joins; the AREA is measured by rasterising the swath, because a
   trail that doubles back overlaps itself and an outline would count that
   ground twice.                                                           */

import { S, A } from './state.js';
import { uid, toast, dialog, fmtLen, fmtArea, toSqYd } from './ui.js';

/* one side of the offset, walking the line forwards */
function offsetSide(P, r, segs){
  const out=[], n=P.length;
  const norm=(a,b)=>{ const dx=b.x-a.x, dy=b.y-a.y, L=Math.hypot(dx,dy)||1;
                      return {x:-dy/L*r, y:dx/L*r}; };
  for(let i=0;i<n-1;i++){
    const a=P[i], b=P[i+1], v=norm(a,b);
    out.push([a.x+v.x, a.y+v.y], [b.x+v.x, b.y+v.y]);
    if(i+2<n){                                   // round the corner at b
      const v2=norm(b,P[i+2]);
      const a0=Math.atan2(v.y,v.x); let d=Math.atan2(v2.y,v2.x)-a0;
      while(d>Math.PI) d-=2*Math.PI;
      while(d<-Math.PI) d+=2*Math.PI;
      const k=Math.max(1,Math.ceil(Math.abs(d)/(Math.PI/segs)));
      for(let j=1;j<k;j++){ const ang=a0+d*j/k;
        out.push([b.x+Math.cos(ang)*r, b.y+Math.sin(ang)*r]); }
    }
  }
  return out;
}
/* a round end cap. The arc has to bulge AWAY from the line, so the sweep is
   chosen as the one that passes through the outward direction rather than
   whichever way happens to be positive. */
function cap(c, from, to, r, segs, out){
  const a0=Math.atan2(from[1]-c.y, from[0]-c.x);
  const a1=Math.atan2(to[1]-c.y, to[0]-c.x);
  const ao=Math.atan2(out.y, out.x);
  const wrap=v=>{ while(v<0) v+=2*Math.PI; while(v>=2*Math.PI) v-=2*Math.PI; return v; };
  let d=wrap(a1-a0) || 2*Math.PI;
  if(wrap(ao-a0) > d) d-=2*Math.PI;      // outward lies the other way round
  const k=Math.max(2,Math.ceil(Math.abs(d)/(Math.PI/segs))), pts=[];
  for(let j=1;j<k;j++){ const ang=a0+d*j/k;
    pts.push([c.x+Math.cos(ang)*r, c.y+Math.sin(ang)*r]); }
  return pts;
}
export function bufferRing(P, r, segs=10){
  if(P.length<2) return null;
  const rev=[...P].reverse();
  const fwd=offsetSide(P, r, segs), bck=offsetSide(rev, r, segs);
  if(!fwd.length||!bck.length) return null;
  const dir=(a,b)=>{ const dx=b.x-a.x, dy=b.y-a.y, L=Math.hypot(dx,dy)||1; return {x:dx/L,y:dy/L}; };
  const endOut=dir(P[P.length-2], P[P.length-1]);
  const startOut=dir(P[1], P[0]);
  return [...fwd,
          ...cap(P[P.length-1], fwd[fwd.length-1], bck[0], r, segs, endOut),
          ...bck,
          ...cap(P[0], bck[bck.length-1], fwd[0], r, segs, startOut)];
}

/* Ground actually covered, in square metres. Rasterised, so a trail that
   passes over itself is counted once. */
export function coveredArea(P, rPx, mPerPx){
  const xs=P.map(p=>p.x), ys=P.map(p=>p.y);
  const x0=Math.min(...xs)-rPx-2, x1=Math.max(...xs)+rPx+2;
  const y0=Math.min(...ys)-rPx-2, y1=Math.max(...ys)+rPx+2;
  const w=Math.max(1,x1-x0), h=Math.max(1,y1-y0);
  const half=Math.max(rPx,1e-6);
  /* aim for a swath about 24 raster pixels across, but never blow the budget */
  const kWant=12/half, kBudget=Math.sqrt(3e6/(w*h));
  const k=Math.min(kWant, kBudget);
  if(!isFinite(k)||k<=0) return null;
  const cw=Math.max(2,Math.round(w*k)), ch=Math.max(2,Math.round(h*k));
  const cv=document.createElement('canvas'); cv.width=cw; cv.height=ch;
  const ctx=cv.getContext('2d',{willReadFrequently:true});
  if(!ctx) return null;
  ctx.lineCap=ctx.lineJoin='round';
  ctx.lineWidth=Math.max(0.6, 2*rPx*k);
  ctx.strokeStyle='#000';
  ctx.beginPath();
  P.forEach((p,i)=>{ const x=(p.x-x0)*k, y=(p.y-y0)*k; i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
  ctx.stroke();
  /* alpha is the fraction of each pixel the swath covers, and one stroke of one
     path never composites over itself, so summing it gives the area to subpixel
     accuracy and counts ground crossed twice only once */
  const d=ctx.getImageData(0,0,cw,ch).data;
  let cov=0;
  for(let i=3;i<d.length;i+=4) cov+=d[i];
  cov/=255;
  const px=mPerPx/k;
  return cov*px*px;
}

/* shoelace, in image pixels */
function ringArea(ring){
  let a=0;
  for(let i=0;i<ring.length;i++){ const p=ring[i], q=ring[(i+1)%ring.length];
    a+=p[0]*q[1]-q[0]*p[1]; }
  return Math.abs(a)/2;
}

const FT=0.3048;

/* pts: [[lat,lon],...] or image pixels already. name: what it came from. */
export async function coverSheet(latlon, name){
  if(!S.xf){ toast('Calibrate this map first'); return null; }
  if(!latlon || latlon.length<2){ toast('That needs at least two points'); return null; }
  const metric = S.set.units==='m';
  const unit = metric ? 'm' : 'ft';
  const def = S.set.swath!=null ? S.set.swath : (metric ? 2.5 : 8);
  const r=await dialog({
    title:'Covered area',
    text:`How wide is the strip you covered along “${name}”? A mower deck, a spray boom, or a blanket width.`,
    fields:[{name:'w', label:`Width in ${unit}`, value:String(def), inputMode:'decimal'}],
    ok:'Measure'});
  if(!r) return null;
  const wNum=parseFloat(r.w);
  if(!isFinite(wNum)||wNum<=0){ toast('That width did not look like a number'); return null; }
  S.set.swath=wNum;
  try{ localStorage.setItem('fl.settings', JSON.stringify(S.set)); }catch(e){}

  const widthM = metric ? wNum : wNum*FT;
  const P = latlon.map(p=>S.xf.toPix(p[0],p[1]));
  const rPx = (widthM/2)/S.xf.mPerPx;

  const ring=bufferRing(P, rPx);
  if(!ring){ toast('Could not build a swath from that'); return null; }
  const real=coveredArea(P, rPx, S.xf.mPerPx);
  if(real==null){ toast('Could not measure that'); return null; }
  const outline=ringArea(ring)*S.xf.mPerPx*S.xf.mPerPx;
  const overlaps = outline>0 && (outline-real)/outline > 0.03;

  const u=S.set.units;
  const note=[`Swath ${wNum} ${unit} along ${name}.`,
              `Covered ${fmtArea(real,u)} (${Math.round(toSqYd(real)).toLocaleString()} sq yd).`,
              overlaps?'The line doubles back, so the outline encloses more ground than was covered; the figure above counts it once.':null]
             .filter(Boolean).join(' ');

  const f={ id:uid('f'), type:'polygon', layer:S.data.activeLayer,
            name:`${name} covered`, note, t:Date.now(),
            pts:ring, fill:0.2, width:2.4 };
  S.data.features.push(f);
  A.commit();
  A.selectFeature(f.id,false);
  A.render();
  toast(`${fmtArea(real,u)} covered · ${Math.round(toSqYd(real)).toLocaleString()} sq yd`,5200);
  return f;
}

export function initCoverage(){
  A.coverSheet=coverSheet;
}
