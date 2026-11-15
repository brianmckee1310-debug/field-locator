/* ============ IndexedDB: maps (image + georeference) and data (layers, features, tracks) ============ */
const DB='fieldlocator';
let dbp=null;
function open(){
  if(dbp) return dbp;
  dbp=new Promise((res,rej)=>{
    const r=indexedDB.open(DB,3);
    r.onupgradeneeded=()=>{ const d=r.result;
      if(!d.objectStoreNames.contains('maps')) d.createObjectStore('maps',{keyPath:'id'});
      if(!d.objectStoreNames.contains('data')) d.createObjectStore('data',{keyPath:'id'});
      /* v3: photos, kept beside the drawings rather than inside them, so a
         feature record stays small and a photo is loaded only when looked at */
      if(!d.objectStoreNames.contains('photos')){
        const p=d.createObjectStore('photos',{keyPath:'id'});
        p.createIndex('fid','fid',{unique:false});
        p.createIndex('mid','mid',{unique:false});
      } };
    r.onsuccess=()=>{
      const d=r.result;
      /* another tab on an older version would otherwise block the next upgrade
         forever; close this handle and let that tab be reloaded */
      d.onversionchange=()=>{ try{ d.close(); }catch(e){} dbp=null; };
      res(d);
    };
    r.onerror=()=>rej(r.error);
    r.onblocked=()=>rej(new Error('Field Locator is open in another tab or window. Close it and reload.'));
  });
  return dbp;
}
async function tx(store,mode,fn){
  const d=await open();
  return new Promise((res,rej)=>{
    const t=d.transaction(store,mode); let rq;
    try{ rq=fn(t.objectStore(store)); }catch(e){ rej(e); return; }
    t.oncomplete=()=>res(rq?rq.result:undefined);
    t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error);
  });
}
export const listMaps  = ()=>tx('maps','readonly', s=>s.getAll());
export const getMap    = id=>tx('maps','readonly', s=>s.get(id));
export const putMap    = m =>tx('maps','readwrite',s=>s.put(m));
export const getData   = id=>tx('data','readonly', s=>s.get(id));
export const putData   = d =>tx('data','readwrite',s=>s.put(d));
export async function deleteMap(id){
  await tx('maps','readwrite',s=>s.delete(id));
  await tx('data','readwrite',s=>s.delete(id));
  await delPhotosOfMap(id);
}

/* ---- photos ---- */
export const putPhoto   = p  => tx('photos','readwrite',s=>s.put(p));
export const getPhoto   = id => tx('photos','readonly', s=>s.get(id));
export const delPhoto   = id => tx('photos','readwrite',s=>s.delete(id));
export const photosFor  = fid=> tx('photos','readonly', s=>s.index('fid').getAll(fid));
export const photosOfMap= mid=> tx('photos','readonly', s=>s.index('mid').getAll(mid));
export async function delPhotosFor(fid){
  const ps=await photosFor(fid).catch(()=>[]);
  for(const p of ps) await delPhoto(p.id).catch(()=>{});
  return ps.length;
}
export async function delPhotosOfMap(mid){
  const ps=await photosOfMap(mid).catch(()=>[]);
  for(const p of ps) await delPhoto(p.id).catch(()=>{});
  return ps.length;
}
export async function photoUsage(mid){
  const ps=await (mid?photosOfMap(mid):tx('photos','readonly',s=>s.getAll())).catch(()=>[]);
  return { count:ps.length, bytes:ps.reduce((n,p)=>n+(p.blob?p.blob.size:0)+(p.thumb?p.thumb.size:0),0) };
}
