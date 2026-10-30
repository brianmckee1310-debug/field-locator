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
