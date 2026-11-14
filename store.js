/* ============ IndexedDB: maps (image + georeference) and data (layers, features, tracks) ============ */
const DB='fieldlocator';
let dbp=null;
function open(){
  if(dbp) return dbp;
  dbp=new Promise((res,rej)=>{
    const r=indexedDB.open(DB,2);
    r.onupgradeneeded=()=>{ const d=r.result;
      if(!d.objectStoreNames.contains('maps')) d.createObjectStore('maps',{keyPath:'id'});
      if(!d.objectStoreNames.contains('data')) d.createObjectStore('data',{keyPath:'id'}); };
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
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
}
