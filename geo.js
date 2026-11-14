/* ============ GeoPDF extraction + geo math (shared) ============ */
export const D2R = Math.PI / 180;

export function mPerDeg(lat){
  const f = lat * D2R;
  return {
    lat: 111132.92 - 559.82*Math.cos(2*f) + 1.175*Math.cos(4*f) - 0.0023*Math.cos(6*f),
    lon: 111412.84*Math.cos(f) - 93.5*Math.cos(3*f) + 0.118*Math.cos(5*f)
  };
}
export function dist(aLat,aLon,bLat,bLon){
  const m = mPerDeg((aLat+bLat)/2);
  return Math.hypot((bLat-aLat)*m.lat, (bLon-aLon)*m.lon);
}

function solve3(A,y){
  const M = A.map((r,i)=>[...r,y[i]]);
  for(let i=0;i<3;i++){
    let p=i; for(let r=i+1;r<3;r++) if(Math.abs(M[r][i])>Math.abs(M[p][i])) p=r;
    [M[i],M[p]]=[M[p],M[i]];
    if(Math.abs(M[i][i])<1e-12) return null;
    for(let r=0;r<3;r++){ if(r===i) continue;
      const f=M[r][i]/M[i][i];
      for(let c=i;c<4;c++) M[r][c]-=f*M[i][c];
    }
  }
  return [M[0][3]/M[0][0], M[1][3]/M[1][1], M[2][3]/M[2][2]];
}

/* least-squares affine  (lon,lat,1) -> pixel */
export function fitAffine(map){
  const P = map.pts.map(p=>({
    lon:p.lon, lat:p.lat,
    px: map.frame.x + p.lx*map.frame.w,
    py: map.frame.y + p.ly*map.frame.h
  }));
  const A=[[0,0,0],[0,0,0],[0,0,0]], bx=[0,0,0], by=[0,0,0];
  for(const p of P){
    const v=[p.lon,p.lat,1];
    for(let i=0;i<3;i++){
      for(let j=0;j<3;j++) A[i][j]+=v[i]*v[j];
      bx[i]+=v[i]*p.px; by[i]+=v[i]*p.py;
    }
  }
  const X=solve3(A.map(r=>[...r]),bx), Y=solve3(A.map(r=>[...r]),by);
  if(!X||!Y) return null;
  return {X,Y};
}

/* ---------- raw-byte GeoPDF scan ---------- */
const nums = s => (s.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)||[]).map(Number);

function sliceBalanced(txt, from, open='[', close=']'){
  let i = txt.indexOf(open, from);
  if(i<0) return null;
  let d=0;
  for(let j=i;j<txt.length;j++){
    if(txt[j]===open) d++;
    else if(txt[j]===close){ d--; if(d===0) return txt.slice(i+1,j); }
  }
  return null;
}

async function inflateStreams(bytes, txt){
  if(typeof DecompressionStream==='undefined') return '';
  let out='';
  const re=/stream\r?\n/g; let m, count=0;
  while((m=re.exec(txt)) && count<400){
    const start=m.index+m[0].length;
    const end=txt.indexOf('endstream', start);
    if(end<0) continue;
    const head=txt.slice(Math.max(0,m.index-700), m.index);
    if(!/FlateDecode/.test(head)) continue;
    count++;
    try{
      const ds=new DecompressionStream('deflate');
      const buf=await new Response(
        new Blob([bytes.slice(start,end)]).stream().pipeThrough(ds)
      ).arrayBuffer();
      const s=new TextDecoder('latin1').decode(buf);
      if(/\/GPTS|\/Measure|\/VP/.test(s)) out += '\n' + s;
    }catch(e){ /* not a deflate stream, skip */ }
  }
  return out;
}

/**
 * Pull the georeferencing out of a GeoPDF.
 * Returns {framePt:{x,y,w,h}, pts:[{lx,ly,lat,lon}], wkt} in PDF-point space
 * (y measured from the TOP of the page), or null.
 */
export async function extractGeo(bytes, pageHeightPt){
  let txt = new TextDecoder('latin1').decode(bytes);
  let found = scan(txt, pageHeightPt);
  if(!found){
    const extra = await inflateStreams(bytes, txt);
    if(extra) found = scan(txt + extra, pageHeightPt);
  }
  return found;
}

function scan(txt, pageHeightPt){
  // every viewport in the file; take the largest that has a Measure with GPTS
  const results=[];
  let idx=0;
  while(true){
    const vp = txt.indexOf('/VP', idx);
    if(vp<0) break;
    idx = vp+3;
    const body = sliceBalanced(txt, vp);
    if(!body) continue;
    const bb = /\/BBox\s*\[([^\]]*)\]/.exec(body);
    const mr = /\/Measure\s+(\d+)\s+(\d+)\s+R/.exec(body);
    let gptsTxt=null, lptsTxt=null, wkt=null;

    if(mr){
      const re=new RegExp('(?:^|[^0-9])'+mr[1]+'\\s+'+mr[2]+'\\s+obj([\\s\\S]{0,4000}?)endobj');
      const om=re.exec(txt);
      if(om){
        const g=/\/GPTS\s*\[([^\]]*)\]/.exec(om[1]); if(g) gptsTxt=g[1];
        const l=/\/LPTS\s*\[([^\]]*)\]/.exec(om[1]); if(l) lptsTxt=l[1];
        const w=/\/WKT\s*\(([^)]*)\)/.exec(om[1]);   if(w) wkt=w[1];
        if(!wkt){ const gw=/\/WKT\s*\(([^)]*)\)/.exec(txt); if(gw) wkt=gw[1]; }
      }
    }
    if(!gptsTxt){                       // inline /Measure dict
      const g=/\/GPTS\s*\[([^\]]*)\]/.exec(body); if(g) gptsTxt=g[1];
      const l=/\/LPTS\s*\[([^\]]*)\]/.exec(body); if(l) lptsTxt=l[1];
    }
    if(!bb || !gptsTxt) continue;

    const B=nums(bb[1]), G=nums(gptsTxt);
    let L = lptsTxt ? nums(lptsTxt) : [0,1,0,0,1,0,1,1];
    if(B.length<4 || G.length<8 || L.length<8) continue;

    const x0=Math.min(B[0],B[2]), x1=Math.max(B[0],B[2]);
    const yA=B[1], yB=B[3];            // BBox order encodes the frame's y direction
    // convert to top-left origin
    const topY  = pageHeightPt - yA;
    const botY  = pageHeightPt - yB;
    const frameX = x0, frameW = x1-x0;
    const frameY = Math.min(topY,botY), frameH = Math.abs(botY-topY);
    // LPTS y is measured from BBox[1] toward BBox[3]
    const flip = topY > botY;

    const pts=[];
    for(let i=0;i<4;i++){
      const lx=L[i*2], lyRaw=L[i*2+1];
      const ly = flip ? 1-lyRaw : lyRaw;
      pts.push({ lx, ly, lat:G[i*2], lon:G[i*2+1] });
    }
    if(pts.some(p=>!isFinite(p.lat)||!isFinite(p.lon)||Math.abs(p.lat)>90||Math.abs(p.lon)>180)) continue;
    results.push({ framePt:{x:frameX,y:frameY,w:frameW,h:frameH}, pts, wkt, area:frameW*frameH });
  }
  if(!results.length) return null;
  results.sort((a,b)=>b.area-a.area);
  return results[0];
}

/* ================= v3: control-point transforms =================
   ctrl = [{px,py,lat,lon}]  (image pixels <-> WGS84)
   Works in a local metre frame centred on the control points, so the
   numbers stay well conditioned and the inverse is a plain 2x2.        */
export function fitTransform(ctrl, mode='similarity'){
  const n = ctrl ? ctrl.length : 0;
  if(n < 2) return null;
  const lat0 = ctrl.reduce((s,c)=>s+c.lat,0)/n, lon0 = ctrl.reduce((s,c)=>s+c.lon,0)/n;
  const md = mPerDeg(lat0), mx = md.lon, my = md.lat;
  const P = ctrl.map(c=>({u:(c.lon-lon0)*mx, v:-(c.lat-lat0)*my, x:c.px, y:c.py}));
  let A,B,C,D,E,F, type = mode;
  if(mode==='affine' && n>=3){
    const N=[[0,0,0],[0,0,0],[0,0,0]], bx=[0,0,0], by=[0,0,0];
    for(const p of P){ const w=[p.u,p.v,1];
      for(let i=0;i<3;i++){ for(let j=0;j<3;j++) N[i][j]+=w[i]*w[j]; bx[i]+=w[i]*p.x; by[i]+=w[i]*p.y; } }
    const X=solve3(N.map(r=>[...r]),bx), Y=solve3(N.map(r=>[...r]),by);
    if(X&&Y){ [A,B,C]=X; [D,E,F]=Y; } else type='similarity';
  } else type='similarity';
  if(type==='similarity'){
    const ub=P.reduce((s,p)=>s+p.u,0)/n, vb=P.reduce((s,p)=>s+p.v,0)/n,
          xb=P.reduce((s,p)=>s+p.x,0)/n, yb=P.reduce((s,p)=>s+p.y,0)/n;
    let sa=0,sb=0,den=0;
    for(const p of P){ const du=p.u-ub,dv=p.v-vb,dx=p.x-xb,dy=p.y-yb;
      sa+=du*dx+dv*dy; sb+=du*dy-dv*dx; den+=du*du+dv*dv; }
    if(den<1e-9) return null;                      // pins on the same ground spot
    const a=sa/den, b=sb/den;
    A=a; B=-b; C=xb-a*ub+b*vb; D=b; E=a; F=yb-b*ub-a*vb;
  }
  const det=A*E-B*D;
  if(!isFinite(det) || Math.abs(det)<1e-12) return null;
  const toPix=(lat,lon)=>{ const u=(lon-lon0)*mx, v=-(lat-lat0)*my; return {x:A*u+B*v+C, y:D*u+E*v+F}; };
  const toLocal=(x,y)=>({ u:(E*(x-C)-B*(y-F))/det, v:(-D*(x-C)+A*(y-F))/det });   // metres east, metres south
  const toGeo=(x,y)=>{ const l=toLocal(x,y); return {lat:lat0-l.v/my, lon:lon0+l.u/mx}; };
  const mPerPx=1/Math.sqrt(Math.abs(det));
  const residuals=ctrl.map(c=>{ const p=toPix(c.lat,c.lon); return Math.hypot(p.x-c.px,p.y-c.py)*mPerPx; });
  const dof = type==='affine' ? n-3 : n-2;
  const rms = dof>0 ? Math.sqrt(residuals.reduce((s,r)=>s+r*r,0)/n) : null;
  let spreadPx=0; for(let i=0;i<n;i++) for(let j=i+1;j<n;j++)
    spreadPx=Math.max(spreadPx,Math.hypot(ctrl[i].px-ctrl[j].px,ctrl[i].py-ctrl[j].py));
  return { type, n, lat0, lon0, toPix, toLocal, toGeo, mPerPx, residuals, rms, spreadPx,
           flipped: det<0, rotation: Math.atan2(D,A)/D2R };
}

/* geometry helpers in local metres (pts = [{u,v}]) */
export function pathLength(pts, closed=false){
  let d=0; for(let i=1;i<pts.length;i++) d+=Math.hypot(pts[i].u-pts[i-1].u, pts[i].v-pts[i-1].v);
  if(closed && pts.length>2) d+=Math.hypot(pts[0].u-pts[pts.length-1].u, pts[0].v-pts[pts.length-1].v);
  return d;
}
export function polyArea(pts){
  let a=0; for(let i=0;i<pts.length;i++){ const p=pts[i], q=pts[(i+1)%pts.length]; a+=p.u*q.v-q.u*p.v; }
  return Math.abs(a)/2;
}
/* Web Mercator */
const RM=6378137;
export const mercX = lon => RM*lon*D2R;
export const mercY = lat => RM*Math.log(Math.tan(Math.PI/4+lat*D2R/2));
export const mercLon = x => x/RM/D2R;
export const mercLat = y => (2*Math.atan(Math.exp(y/RM))-Math.PI/2)/D2R;

/* parse "42.0067, -88.2059", "42.0067 N 88.2059 W", or D M S forms */
export function parseLatLon(str){
  if(!str) return null;
  const s=str.toUpperCase();
  const ns=(s.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number);
  if(![2,4,6].includes(ns.length)) return null;
  const h=ns.length/2, hemis=(s.match(/[NSEW]/g)||[]);
  const dec=g=>{ const v=Math.abs(g[0])+(g[1]||0)/60+(g[2]||0)/3600; return g[0]<0||Object.is(g[0],-0)?-v:v; };
  let a=dec(ns.slice(0,h)), b=dec(ns.slice(h));
  let ha=hemis[0]||'', hb=hemis[1]||'';
  if(hemis.length===1){ if(/[EW]/.test(ha)){ hb=ha; ha=''; } }
  if(ha==='S'||ha==='W') a=-Math.abs(a);
  if(hb==='S'||hb==='W') b=-Math.abs(b);
  if(/[EW]/.test(ha) || /[NS]/.test(hb)) [a,b]=[b,a];
  if(!isFinite(a)||!isFinite(b)||Math.abs(a)>90||Math.abs(b)>180) return null;
  return {lat:a, lon:b};
}
