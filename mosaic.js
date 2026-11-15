/* ============ multi-sheet sites: crop each sheet to its neatline and
   reproject the lot into one north-up raster ============

   Why one raster and not a stack of sheets: everything downstream of a map
   (drawing, selection, exports, .fieldmap, the FQA embed API) assumes
   one map = one image = one transform, with feature geometry stored in
   image pixels. Mosaicking at import keeps that promise intact.          */

import { fitTransform, mPerDeg } from './geo.js';

/* A sheet: { canvas, geo:{framePt, pts}, scale, name }
   geo is in PDF points, canvas pixels are points * scale.                */

/* lat/lon -> this sheet's canvas pixels, from the four GPTS/LPTS corners */
export function sheetFit(sheet){
  const f = sheet.geo.framePt, k = sheet.scale;
  const ctrl = sheet.geo.pts.map(p => ({
    px: (f.x + p.lx*f.w)*k,
    py: (f.y + p.ly*f.h)*k,
    lat: p.lat, lon: p.lon
  }));
  return fitTransform(ctrl, 'affine');
}

/* Points shaved off each sheet edge by default. Measured on a real ArcMap
   export (Nov 2026): the neatline is a 1 pt stroke centred on the /VP BBox, so
   half a point of it sits inside the frame. 0.6 pt left a grey hairline once
   the sheet was resampled; 1 pt clears it with room for the blur. */
export const DEFAULT_TRIM_PT = 1.0;
export const TRIM_STEPS = [0, 0.3, 0.6, 1, 1.5, 2, 3, 5, 8];

/* the untrimmed map frame of a stored sheet, in its own pixels. Sheets saved
   before v3.7 carry no `frame`, but their control points ARE the frame's
   corners, so it can always be recovered. */
export function frameOf(s){
  if(s.frame) return s.frame;
  const xs=s.ctrl.map(c=>c.px), ys=s.ctrl.map(c=>c.py);
  const x=Math.min(...xs), y=Math.min(...ys);
  return { x, y, w:Math.max(...xs)-x, h:Math.max(...ys)-y };
}

/* frame -> crop: shave `trimPx` off every edge and clamp to the page */
export function cropFromFrame(fr, trimPx, w, h){
  const d = Math.max(0, Math.min(trimPx, fr.w/4, fr.h/4));
  const x = Math.max(0, fr.x + d), y = Math.max(0, fr.y + d);
  return { x, y,
    w: Math.max(1, Math.min(w, fr.x+fr.w - d) - x),
    h: Math.max(1, Math.min(h, fr.y+fr.h - d) - y) };
}

/* the neatline, in canvas pixels, clamped to the page. Needs only the page
   size, so a sheet can be planned before it is rendered. The neatline is
   usually STROKED on the BBox edge, so half its width falls inside the crop
   and two neighbours meet as a double line; trimming removes it at the cost
   of a hairline gap between sheets that only just touch -- which is why it is
   a setting and not a constant. */
export function cropRect(sheet, trimPt=0){
  const f = sheet.geo.framePt, k = sheet.scale;
  return cropFromFrame({x:f.x*k, y:f.y*k, w:f.w*k, h:f.h*k}, trimPt*k, sheet.w, sheet.h);
}

/* ground extent of every sheet, and the resolution the mosaic will use */
export function planMosaic(placed, {budgetMP=24, maxDim=12000}={}){
  let latMin=90, latMax=-90, lonMin=180, lonMax=-180;
  for(const s of placed){
    const c = s.crop;
    for(const [x,y] of [[c.x,c.y],[c.x+c.w,c.y],[c.x+c.w,c.y+c.h],[c.x,c.y+c.h]]){
      const g = s.xf.toGeo(x,y);
      if(g.lat<latMin) latMin=g.lat; if(g.lat>latMax) latMax=g.lat;
      if(g.lon<lonMin) lonMin=g.lon; if(g.lon>lonMax) lonMax=g.lon;
    }
  }
  const latC=(latMin+latMax)/2, md=mPerDeg(latC);
  const widthM=(lonMax-lonMin)*md.lon, heightM=(latMax-latMin)*md.lat;
  const finest=Math.min(...placed.map(s=>s.xf.mPerPx));
  /* never finer than the sharpest sheet (no invented detail), never past the budget */
  let r = Math.max(finest, Math.sqrt(widthM*heightM/(budgetMP*1e6)));
  r = Math.max(r, widthM/maxDim, heightM/maxDim);
  const W = Math.max(1, Math.round(widthM/r)), H = Math.max(1, Math.round(heightM/r));
  return { latMin, latMax, lonMin, lonMax, md, mPerPx:r, W, H, widthM, heightM, finest,
           mp:(W*H)/1e6 };
}

export const mosaicGeoAt = (plan, x, y) => ({
  lat: plan.latMax - y*plan.mPerPx/plan.md.lat,
  lon: plan.lonMin + x*plan.mPerPx/plan.md.lon
});

/* sheet canvas px -> mosaic px, as a plain affine (both ends are affine) */
function compose(xf, plan){
  const to = (x,y) => {
    const g = xf.toGeo(x,y);
    return { X:(g.lon-plan.lonMin)*plan.md.lon/plan.mPerPx,
             Y:(plan.latMax-g.lat)*plan.md.lat/plan.mPerPx };
  };
  const p0=to(0,0), p1=to(1,0), p2=to(0,1);
  return { a:p1.X-p0.X, b:p1.Y-p0.Y, c:p2.X-p0.X, d:p2.Y-p0.Y, e:p0.X, f:p0.Y };
}

/* Draw every sheet into one canvas. `masks` are rectangles in sheet canvas
   pixels that should not be painted (a key or inset inside the neatline).
   Sheets are rendered one at a time through `render` and released straight
   after, so seven 12-megapixel pages never sit in memory together. */
export async function drawMosaic(placed, plan, {bg='#ffffff', onStep, render}={}){
  const cv = document.createElement('canvas');
  cv.width = plan.W; cv.height = plan.H;
  /* phones cap canvas size well below desktops, and a refused canvas silently
     comes back at its default size rather than throwing */
  if(cv.width!==plan.W || cv.height!==plan.H)
    throw new Error('TOO_BIG');
  const ctx = cv.getContext('2d', {alpha:false});
  if(!ctx) throw new Error('TOO_BIG');
  ctx.fillStyle = bg; ctx.fillRect(0,0,plan.W,plan.H);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  for(let i=0;i<placed.length;i++){
    const s = placed[i];
    if(onStep) onStep(i, placed.length);
    const canvas = s.canvas || (render ? await render(s,i) : null);
    if(!canvas) continue;
    const A = compose(s.xf, plan), c = s.crop;
    ctx.save();
    ctx.setTransform(A.a, A.b, A.c, A.d, A.e, A.f);
    ctx.beginPath();
    ctx.rect(c.x, c.y, c.w, c.h);
    for(const m of (s.masks||[])) ctx.rect(m.x, m.y, m.w, m.h); // even-odd makes these holes
    ctx.clip('evenodd');
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
    if(!s.canvas){ canvas.width=1; canvas.height=1; }   // let it go
  }
  if(onStep) onStep(placed.length, placed.length);
  return cv;
}

/* four corners of the mosaic as control points, so the existing
   transform machinery places it with no special cases */
export function mosaicCtrl(plan){
  return [[0,0],[plan.W,0],[0,plan.H],[plan.W,plan.H]].map(([x,y]) => {
    const g = mosaicGeoAt(plan, x, y);
    return { px:x, py:y, lat:g.lat, lon:g.lon };
  });
}

/* A sheet whose coordinates put it far from the rest is usually a mis-read,
   not a real outlier: report it rather than letting it stretch the mosaic. */
export function outliers(placed){
  if(placed.length < 3) return [];
  const cs = placed.map(s => {
    const c=s.crop, g=s.xf.toGeo(c.x+c.w/2, c.y+c.h/2);
    const d=s.xf.toGeo(c.x,c.y), e=s.xf.toGeo(c.x+c.w,c.y+c.h);
    return { lat:g.lat, lon:g.lon, span:Math.abs(e.lat-d.lat)+Math.abs(e.lon-d.lon) };
  });
  const med = a => { const b=[...a].sort((x,y)=>x-y); return b[b.length>>1]; };
  const mLat=med(cs.map(c=>c.lat)), mLon=med(cs.map(c=>c.lon));
  const span=Math.max(1e-6, med(cs.map(c=>c.span)));
  return placed.map((s,i)=>({s,i,far:Math.abs(cs[i].lat-mLat)+Math.abs(cs[i].lon-mLon)}))
               .filter(o => o.far > span*12);
}
