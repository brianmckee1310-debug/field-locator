/* ============ IndexedDB map library ============ */
const DB='fieldlocator', STORE='maps';
let dbp=null;
function open(){
  if(dbp) return dbp;
  dbp=new Promise((res,rej)=>{
    const r=indexedDB.open(DB,1);
    r.onupgradeneeded=()=>{ const d=r.result;
      if(!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE,{keyPath:'id'}); };
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
  return dbp;
}
async function tx(mode,fn){
  const d=await open();
  return new Promise((res,rej)=>{
    const t=d.transaction(STORE,mode), s=t.objectStore(STORE);
    let out; try{ out=fn(s); }catch(e){ rej(e); return; }
    t.oncomplete=()=>res(out && out.result!==undefined ? out.result : out);
    t.onerror=()=>rej(t.error);
    t.onabort=()=>rej(t.error);
  });
}
export const listMaps  = ()=>tx('readonly',  s=>s.getAll());
export const getMap    = id=>tx('readonly',  s=>s.get(id));
export const putMap    = m =>tx('readwrite', s=>s.put(m));
export const deleteMap = id=>tx('readwrite', s=>s.delete(id));
