# Field Locator

A small offline web app that shows where you're standing on a georeferenced PDF site plan.

Built for field ecology / restoration work on sites that are bare dirt with no landmarks —
where the only reference is a PDF plan.

## What it does

- Reads the georeferencing embedded in a **GeoPDF** (the `/VP` `/Measure` block that ArcGIS
  writes when "Export Map Georeference Information" is ticked)
- Renders the plan and plots your GPS position on it, with an accuracy circle
- Pinch/pan/zoom, feet or metres, scale bar, off-map distance warning
- **Fully offline** once installed — map, code and the PDF importer are all cached
- Everything stays on the phone. No uploads, no accounts, no network calls.

## Use

Open the site, "Add map from PDF", pick a georeferenced PDF. Then tap the map to locate.

On a phone: open in the browser → Share → **Add to Home Screen** for offline use.

## How the georeferencing works

The PDF carries four corner points as lat/lon (`/GPTS`) paired to fractional positions within
the map frame (`/LPTS`), plus the frame's bounding box in PDF points (`/BBox`). The app fits a
least-squares affine transform from (lon, lat) to image pixels over those four points, which
tolerates slight rotation or skew.

Ground scale is derived from local metre-per-degree values rather than a spherical earth
approximation — verified against the test plan's own printed graphic scale bar to within 0.08%.

## Accuracy

Phone GPS is roughly ±10–30 ft under open sky, worse near equipment or treelines. The
georeferencing itself contributes well under a metre. Good for "which outlot am I in",
not for staking boundaries.

## Files

| File | Purpose |
|---|---|
| `index.html` | Shell and styles |
| `app.js` | Canvas renderer, GPS, gestures, map library, PDF import |
| `geo.js` | GeoPDF extraction and geo maths |
| `store.js` | IndexedDB map library |
| `sw.js` | Service worker — offline caching |
| `pdf*.mjs` | pdf.js, for rendering imported PDFs |
