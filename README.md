# Field Locator

An offline web app for field work on sites where the only reference is a map: it shows where you are
standing on your own site plan, and lets you pin, draw, measure and record on top of it.

Live: https://brianmckee1310-debug.github.io/field-locator/

## What it does

- **Maps from anything.** Georeferenced PDFs (GeoPDF) work straight away. Any other PDF, image or
  screenshot is placed on the ground with pins. Free USGS aerial imagery can be downloaded for any US site.
- **Multi-sheet sites.** Pick several georeferenced PDFs at once, or one PDF with several map pages,
  and they are cut to their own map frames and joined into a single continuous map. No matchlines
  needed: each sheet is placed by its own coordinates. A key or inset drawn inside a sheet's frame
  can be boxed out, sheets can be turned off, and the map rebuilt at another quality -- drawings are
  carried across through ground coordinates, so nothing moves.
- **Your position** on the map, with accuracy circle, heading, off-map warning and a scale bar.
- **Drawing tools**: pins, lines, areas, freehand, rectangles, circles, arrows, text and a measure tool,
  with live lengths and areas. Points can be dropped at your GPS position, so you can walk a boundary.
- **Layers**: Management Notes, Inventory, Sampling and Trials by default, plus your own.
- **Breadcrumb trails** at an interval you choose.
- **Exports**: CSV, KML, GeoJSON, GPX, a picture of the map with drawings, and a `.fieldmap` site file
  that carries the map, drawings and trails to another device or person.
- **Imports**: KML, KMZ and GeoJSON land on the open map as pins, lines and areas on a new layer.
- **Covered area**: give a trail or a line a working width -- mower deck, spray boom, blanket width --
  and get the swath back as an area. The outline is an offset buffer; the figure is measured by
  rasterising the swath, so ground crossed twice is counted once.
- **Offline**: once opened, everything is cached. Maps and data stay on the device.

## Calibration

Each pin ties a spot on the image to a latitude and longitude, either by standing there or by typing
coordinates. Two pins make the map live. The fit is a similarity transform (uniform scale, rotation,
shift), solved by least squares in a local metre frame, which stays stable with noisy GPS pins. From
three pins the app reports each pin's error; from four it can tell which pin disagrees, and an optional
"stretch fix" switches to a full affine fit for scans that are not true to scale.

GeoPDFs are read directly: the `/VP` `/Measure` block gives four corner coordinates (`/GPTS`) and the
map frame (`/BBox`), fitted with an affine transform. Viewports are looked up through each page
object's own `/VP`, so every page of a multi-sheet PDF gets the right one; a whole-file scan is the
fallback. The `/BBox` is the neatline, which is what makes cropping the border, title block, header,
footer and margin legend exact rather than a guess.

## Files

| File | Purpose |
|---|---|
| `index.html`, `app.css` | Shell and styles |
| `app.js` | Library, imports, map view, gestures, GPS, menu, embed API |
| `tools.js` | Drawing tools, selection and editing, layers, undo |
| `calib.js` | Pin calibration |
| `track.js` | Breadcrumb trails |
| `io.js` | Exports, site files |
| `aerial.js` | USGS aerial download |
| `geo.js` | GeoPDF extraction, transforms, geometry |
| `mosaic.js` | Multi-sheet sites: neatline crop and reprojection into one raster |
| `sheets.js` | Sheets panel, masking a key, rebuilding a combined map |
| `coverage.js` | A walked line plus a width -> the ground it covered |
| `store.js`, `state.js`, `ui.js` | Storage, shared state, UI helpers |
| `sw.js` | Offline caching. Bump `CACHE` on every release. |

## Data model

- Store `maps`: `{id, name, blob, imgW, imgH, ctrl:[{px,py,lat,lon}], fit, geoSrc, origCtrl, thumb, site}`
  - a combined map also carries `sheets:[{name,file,page,scale,w,h,crop,ctrl,masks,visible}]`,
    `sources:[{name,blob}]` (the original PDFs, so it can be rebuilt without them being re-picked)
    and `mosaic:{mPerPx,latMin,latMax,lonMin,lonMax,budgetMP,trimPt,W,H}`.
    `sources` is deliberately left out of the `.fieldmap` export.
- Store `data` (same id): `{layers:[{id,name,color,visible}], features:[...], tracks:[...], activeLayer}`
- Feature: `{id, type: point|line|polygon|circle|text, layer, name, note, pts:[[x,y]], r, text, size,
  color, width, fill, dash, arrow, gps:{lat,lon,acc}, t, link}`. Geometry is stored in image pixels
  and converted to coordinates on export, so drawings stay put on the map if calibration changes.
- Track: `{id, name, color, visible, pts:[[lat,lon,time,acc]], start, end}`

## Embedding (for the FQA app merge)

`window.FieldLocator` exposes `listMaps()`, `getSite(mapId)`, `toGeoJSON(mapId)`, `open(mapId)` and
`on('open'|'close'|'change', fn)`. When run inside an iframe the same events are posted to the parent as
`{source:'field-locator', type, mapId}`. Maps carry an optional `site` field and features an optional
`link` field, reserved for tying them to FQA sites and records.

## Accuracy

Phone GPS is roughly ±10 to 30 ft in the open and worse under canopy or near equipment. Good for
"which unit am I in" and mapping patches; not for staking boundaries.

Aerial imagery: USGS The National Map / USDA NAIP, public domain.
