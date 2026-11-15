/* ============ small UI helpers ============ */
export const $ = id => document.getElementById(id);
export const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export const uid = (p='f') => p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
export const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function h(tag, attrs={}, ...kids){
  const e=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(v==null||v===false) continue;
    if(k==='class') e.className=v;
    else if(k==='html') e.innerHTML=v;
    else if(k.startsWith('on')) e.addEventListener(k.slice(2),v);
    else if(k==='style'&&typeof v==='object') Object.assign(e.style,v);
    else if(k in e && k!=='list') e[k]=v;
    else e.setAttribute(k,v===true?'':v);
  }
  for(const c of kids.flat()){ if(c==null||c===false) continue; e.append(c.nodeType?c:document.createTextNode(c)); }
  return e;
}

let tt=null;
export function toast(msg,ms=2800){
  const t=$('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(tt); tt=setTimeout(()=>t.classList.remove('show'),ms);
}

/* ---------- sheets (bottom sheet on phones, side panel on wide screens) ---------- */
let openSheetEl=null;
export function sheet(title, body, opts={}){
  closeSheet();
  const wrap=h('div',{class:'sheet'+(opts.modal===false?' nomodal':'')+(opts.cls?' '+opts.cls:'')});
  const box=h('div',{class:'sbox'},
    h('div',{class:'shead'}, h('div',{class:'stitle'},title),
      h('button',{class:'sx','aria-label':'Close',onclick:()=>closeSheet()},'✕')),
    h('div',{class:'sbody'}, body));
  wrap.append(box);
  if(opts.modal!==false) wrap.addEventListener('pointerdown',e=>{ if(e.target===wrap) closeSheet(); });
  document.body.append(wrap);
  wrap._onclose=opts.onclose;
  openSheetEl=wrap; document.body.classList.add('sheeton');
  requestAnimationFrame(()=>wrap.classList.add('show'));
  return wrap;
}
export function closeSheet(){
  const w=openSheetEl; if(!w) return;
  openSheetEl=null; w.classList.remove('show'); document.body.classList.remove('sheeton');
  if(w._onclose) try{ w._onclose(); }catch(e){}
  setTimeout(()=>w.remove(),320);
}
export const sheetOpen = () => !!openSheetEl;

/* ---------- dialogs ---------- */
export function dialog({title, text, fields=[], ok='OK', cancel='Cancel', danger=false}){
  return new Promise(res=>{
    const inputs={};
    const body=h('div',{},
      text?h('p',{class:'dtext'},text):null,
      fields.map(f=>{
        const inp = f.type==='textarea' ? h('textarea',{class:'inp',rows:3,placeholder:f.placeholder||''})
                                         : h('input',{class:'inp',type:f.type||'text',placeholder:f.placeholder||'',
                                                      inputMode:f.inputMode||null,autocomplete:'off'});
        inp.value=f.value??''; inputs[f.name]=inp;
        return h('label',{class:'fld'}, f.label?h('span',{},f.label):null, inp);
      }));
    const done=v=>{ wrap.classList.remove('show'); setTimeout(()=>wrap.remove(),260); res(v); };
    const okb=h('button',{class:'btn '+(danger?'danger':'primary'),onclick:()=>{
      const out={}; for(const k in inputs) out[k]=inputs[k].value; done(fields.length?out:true); }},ok);
    const wrap=h('div',{class:'dlg'}, h('div',{class:'dbox'},
      h('h3',{},title), body,
      h('div',{class:'drow'}, cancel?h('button',{class:'btn ghost',onclick:()=>done(null)},cancel):null, okb)));
    wrap.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA'){ e.preventDefault(); okb.click(); }
                                         if(e.key==='Escape') done(null); });
    document.body.append(wrap);
    requestAnimationFrame(()=>{ wrap.classList.add('show'); const f=Object.values(inputs)[0]; if(f){ f.focus(); f.select&&f.select(); } });
  });
}

/* ---------- saving files: share sheet on phones when possible, download otherwise ---------- */
export async function saveFile(name, blob, {share=false}={}){
  if(share && navigator.canShare){
    try{
      const file=new File([blob],name,{type:blob.type||'application/octet-stream'});
      if(navigator.canShare({files:[file]})){ await navigator.share({files:[file],title:name}); return 'shared'; }
    }catch(e){ if(e&&e.name==='AbortError') return 'cancelled'; }
  }
  const url=URL.createObjectURL(blob);
  const a=h('a',{href:url,download:name,style:{display:'none'}});
  document.body.append(a); a.click();
  setTimeout(()=>{ a.remove(); URL.revokeObjectURL(url); },4000);
  return 'downloaded';
}

/* ---------- unit formatting ---------- */
export const M_PER_YD = 0.9144, SQM_PER_SQYD = 0.83612736;
export const toYd   = m  => m/M_PER_YD;
export const toSqYd = m2 => m2/SQM_PER_SQYD;
export function fmtLen(m, units){
  if(units==='ft'){ const ft=m/0.3048; return ft>=5280 ? (ft/5280).toFixed(2)+' mi' : (ft<100?ft.toFixed(1):Math.round(ft).toLocaleString())+' ft'; }
  if(units==='yd'){ const yd=toYd(m); return yd>=1760 ? (yd/1760).toFixed(2)+' mi' : (yd<100?yd.toFixed(1):Math.round(yd).toLocaleString())+' yd'; }
  return m>=1000 ? (m/1000).toFixed(2)+' km' : (m<100?m.toFixed(1):Math.round(m).toLocaleString())+' m';
}
export function fmtArea(m2, units){
  if(units==='ft'){ const ac=m2/4046.8564; return ac>=0.1 ? ac.toFixed(2)+' ac' : Math.round(m2/0.09290304).toLocaleString()+' sq ft'; }
  /* square yards all the way up: in yard mode the number you want is the one you order blanket by */
  if(units==='yd'){ const sy=toSqYd(m2); return (sy<100?sy.toFixed(1):Math.round(sy).toLocaleString())+' sq yd'; }
  const ha=m2/10000; return ha>=0.1 ? ha.toFixed(2)+' ha' : Math.round(m2).toLocaleString()+' m²';
}
export const fmtLL = (lat,lon) => `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
export function fmtDur(ms){ const s=Math.round(ms/1000), hh=Math.floor(s/3600), mm=Math.floor(s%3600/60);
  return hh ? `${hh} h ${mm} min` : mm ? `${mm} min` : `${s} s`; }
