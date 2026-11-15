/* ============ shared state, settings, icons ============ */
export const VERSION = '3.2';

export const S = {
  map:null,            // current map record
  xf:null,             // fitted transform (null when not calibrated)
  img:null,            // decoded map image
  data:null,           // {layers, features, tracks, activeLayer}
  view:{s:1,x:0,y:0},  // image px -> screen px
  W:0, H:0,
  fix:null,            // latest GPS fix {lat,lon,acc,heading,t}
  follow:false,
  tool:'select',
  sel:null,            // selected feature id
  mode:'map',          // 'map' | 'calib'
  set:{ units:'ft', labels:true, interval:30, saver:false, wake:true,
        roll:100, olap:10, bw:8 },   // blanket: sq yd per roll, overlap %, strip width in ft
  fixListeners:new Set(),
};
/* functions the modules register for each other (keeps imports acyclic) */
export const A = {};

export function loadSet(){
  try{ Object.assign(S.set, JSON.parse(localStorage.getItem('fl.settings')||'{}')); }catch(e){}
}
export function saveSet(){
  try{ localStorage.setItem('fl.settings', JSON.stringify(S.set)); }catch(e){}
}

export const PRESET_ORDER = ['mgmt','trial','inv','samp'];
export const DEFAULT_LAYERS = () => [
  {id:'mgmt',  name:'Management Notes', color:'#e8590c', visible:true},
  {id:'trial', name:'Trials',           color:'#9334e6', visible:true},
  {id:'inv',   name:'Inventory',        color:'#0f9d58', visible:true},
  {id:'samp',  name:'Sampling',         color:'#1a73e8', visible:true},
];
/* presets first in their fixed order, then custom layers in the order they were made */
export function orderLayers(ls){
  const rank = l => { const i=PRESET_ORDER.indexOf(l.id); return i<0 ? PRESET_ORDER.length : i; };
  return ls.map((l,i)=>[l,i]).sort((a,b)=>rank(a[0])-rank(b[0]) || a[1]-b[1]).map(p=>p[0]);
}
export const PALETTE = ['#e8590c','#d93025','#f9ab00','#0f9d58','#12b5cb','#1a73e8','#9334e6','#e52592','#795548','#202124','#ffffff'];

const P = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICON = {
  back:   P('<path d="M15 5l-7 7 7 7"/>'),
  menu:   P('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
  select: P('<path d="M5 3l6.5 17 2.3-7.2L21 10.5z"/>'),
  point:  P('<path d="M12 21s-6.5-6.1-6.5-11A6.5 6.5 0 0 1 18.5 10c0 4.9-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  line:   P('<path d="M5 18L10 8l5 7 4-9"/><circle cx="5" cy="18" r="1.6" fill="currentColor"/><circle cx="19" cy="6" r="1.6" fill="currentColor"/>'),
  polygon:P('<path d="M12 3.5l8 5.5-3 10.5H7L4 9z"/>'),
  free:   P('<path d="M3 16c3-9 6-9 7-3s4 5 5-2 4-6 6-3"/>'),
  text:   P('<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>'),
  more:   P('<circle cx="6" cy="6" r="2"/><rect x="14" y="4" width="6" height="4" rx="1"/><path d="M4 18l6-4M14 20l6-6"/>'),
  rect:   P('<rect x="4" y="6" width="16" height="12" rx="1.5"/>'),
  circle: P('<circle cx="12" cy="12" r="8"/>'),
  arrow:  P('<path d="M5 19L19 5M10 5h9v9"/>'),
  measure:P('<path d="M3 16l13-13 5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/>'),
  undo:   P('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo:   P('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  layers: P('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  track:  P('<circle cx="5" cy="19" r="1.7" fill="currentColor"/><circle cx="19" cy="5" r="1.7" fill="currentColor"/><path d="M8 17.5c3-.5 2-5 5-6s3-3.500 4-5" stroke-dasharray="2.2 3"/>'),
  target: P('<path d="M12 3.2l7.2 16.4-7.2-3.5-7.2 3.5z" stroke-width="1.8"/>'),
  eye:    P('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeoff: P('<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.300 6.300C3.600 8.100 2 12 2 12s3.600 7 10 7c1.500 0 2.900-.4 4.100-1"/>'),
  trash:  P('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  edit:   P('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  move:   P('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'),
  gps:    P('<circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="8"/>'),
  check:  P('<path d="M5 12.500l4.500 4.500L19 7.500"/>'),
  x:      P('<path d="M6 6l12 12M18 6L6 18"/>'),
  share:  P('<path d="M12 15V3M8 7l4-4 4 4M5 12v7h14v-7"/>'),
  calib:  P('<path d="M12 2v6M12 16v6M2 12h6M16 12h6"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
  plus:   P('<path d="M12 5v14M5 12h14"/>'),
  globe:  P('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.200 3 14.800 0 18M12 3c-3 3.200-3 14.800 0 18"/>'),
  search: P('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.8 4.8"/>'),
  gear:   P('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.900 4.900l2.100 2.100M17 17l2.100 2.100M4.900 19.100L7 17M17 7l2.100-2.100"/>'),
  rec:    P('<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>'),
  stop:   P('<rect x="7" y="7" width="10" height="10" rx="1.500" fill="currentColor" stroke="none"/>'),
  vertex: P('<path d="M4 18L18 6"/><rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor"/>'),
};
