import {useEffect,useRef,useState} from 'react';
import {Check,Copy,ImagePlus,LoaderCircle,Trash2} from 'lucide-react';
import type {Character} from './reference-model';
import {localId} from './gallery-model';
import {MAX_REFERENCE_PHOTOS,photoErrors,photoName,uploadReference,type PhotoDraft} from './reference-import';
function PhotoPreview({file}:{file:File}){const [url,setURL]=useState('');useEffect(()=>{const value=URL.createObjectURL(file);setURL(value);return()=>URL.revokeObjectURL(value);},[file]);return <img src={url||undefined} alt="Selected reference" loading="lazy"/>;}
type Props={base:string;connected:boolean;locked:boolean;disabled:boolean;characters:Character[];onSave:(c:Character)=>void;onBusy:(busy:boolean)=>void;onClose:()=>void};
export default function MultiReferenceUpload(p:Props){
 const [rows,setRows]=useState<PhotoDraft[]>([]),[saving,setSaving]=useState(false),[note,setNote]=useState('');
 const running=useRef(false),abort=useRef<AbortController|null>(null),alive=useRef(true),live=useRef(p);live.current=p;
 const errors=photoErrors(rows,p.characters.filter(c=>c.base===p.base).map(c=>c.name));
 const pending=rows.filter(r=>r.state!=='saved'),saved=rows.length-pending.length,blocked=p.disabled||p.locked||saving;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;abort.current?.abort();p.onBusy(false);};},[p.onBusy]);
 useEffect(()=>{abort.current?.abort();setRows([]);setNote('');},[p.base]);
 useEffect(()=>{if(!p.connected||p.locked)abort.current?.abort();},[p.connected,p.locked]);
 function choose(files:FileList|null){if(!files)return;const selected=Array.from(files);if(rows.length+selected.length>MAX_REFERENCE_PHOTOS){setNote('Choose up to 20 photos per batch. Save this batch before adding more.');return;}if([...rows.map(r=>r.file),...selected].reduce((n,f)=>n+f.size,0)>150*1024*1024){setNote('Keep a batch under 150 MB. Add fewer photos at a time.');return;}setRows(old=>[...old,...selected.map(file=>({id:localId(),name:photoName(file.name),file,state:'ready' as const}))]);setNote('Review each character name before uploading.');}
 function rename(id:string,name:string){setRows(old=>old.map(r=>r.id===id?{...r,name,state:'ready',error:undefined}:r));}
 async function paste(id:string){try{const text=await navigator.clipboard.readText();if(alive.current&&!running.current)rename(id,text.trim().slice(0,60));}catch{setNote('Clipboard unavailable. Paste into the character name field manually.');}}
 async function save(){
  if(running.current||blocked||!p.connected||!pending.length||errors.size)return;
  running.current=true;setSaving(true);p.onBusy(true);setNote('Uploading one photo at a time…');const controller=new AbortController();abort.current=controller;const base=p.base;
  let success=0,failed=0;
  try{for(const row of pending){
   if(controller.signal.aborted||!alive.current||live.current.base!==base||live.current.locked||!live.current.connected)break;
   // Recheck names against newly synced characters before each network write.
   const issue=photoErrors([row],live.current.characters.filter(c=>c.base===base).map(c=>c.name)).get(row.id);
   if(issue){failed++;setRows(old=>old.map(r=>r.id===row.id?{...r,state:'error',error:issue}:r));continue;}
   setRows(old=>old.map(r=>r.id===row.id?{...r,state:'uploading',error:undefined}:r));
   try{const image=await uploadReference(base,row.file,'image',controller.signal);
    if(controller.signal.aborted||!alive.current||live.current.base!==base||live.current.locked)break;
    live.current.onSave({id:row.id,name:row.name.trim(),base,image});success++;
    setRows(old=>old.map(r=>r.id===row.id?{...r,state:'saved',error:undefined}:r));
   }catch(e){if(controller.signal.aborted)break;failed++;setRows(old=>old.map(r=>r.id===row.id?{...r,state:'error',error:(e as Error).message}:r));}
  }}finally{running.current=false;if(alive.current){setSaving(false);if(live.current.base===base){setRows(old=>old.map(r=>r.state==='uploading'?{...r,state:'ready'}:r));setNote(controller.signal.aborted?'Upload stopped. Already saved references are kept.':failed?success+' saved · '+failed+' need attention. Retry only uploads that are not saved.':success+' references saved. Use their names in CHARACTERS: for each shot.');}}p.onBusy(false);}
 }
 return <section className="reference-import" aria-label="Add multiple reference photos"><header><strong>Add multiple photos</strong><span>{saved} / {rows.length} saved</span></header><p className="bulk-note">Review names before saving. Your cast can have many references; each shot still uses up to 3, chosen by its CHARACTERS: line. Manual checkbox selections stay unchanged.</p>
 <label className="reference-import-picker"><ImagePlus size={16}/>Choose photos · up to 20<input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={blocked} onChange={e=>{choose(e.target.files);e.target.value='';}}/></label>
 <div className="reference-import-list">{rows.map(row=>{const issue=errors.get(row.id)||row.error;return <article className="reference-import-row" key={row.id}><PhotoPreview file={row.file}/><div className="reference-import-fields"><label htmlFor={'reference-name-'+row.id}>Character name</label><div className="reference-import-name"><input id={'reference-name-'+row.id} value={row.name} maxLength={60} disabled={blocked||row.state==='saved'} onChange={e=>rename(row.id,e.target.value)} aria-invalid={!!issue}/><button className="text-button" disabled={blocked||row.state==='saved'} onClick={()=>void paste(row.id)} aria-label={'Paste name for '+row.file.name}><Copy size={13}/>Paste</button></div><small title={row.file.name}>{row.file.name}</small>{row.state==='saved'?<span className="reference-import-saved"><Check size={13}/>Saved</span>:row.state==='uploading'?<span role="status"><LoaderCircle size={13} className="spin"/>Uploading…</span>:issue?<small className="error" role="alert">{issue}</small>:<small>Ready</small>}</div>{row.state!=='saved'&&<button className="icon-button" disabled={blocked} onClick={()=>setRows(old=>old.filter(r=>r.id!==row.id))} aria-label={'Remove '+row.file.name}><Trash2 size={15}/></button>}</article>;})}</div>
 <div className="character-form-actions"><button className="button primary" disabled={blocked||!p.connected||!pending.length||errors.size>0} onClick={save}>{saving?<LoaderCircle size={15} className="spin"/>:<ImagePlus size={15}/>} {saving?'Uploading…':rows.some(r=>r.state==='error')?'Retry remaining · '+pending.length:'Save references · '+pending.length}</button><button className="button secondary" disabled={saving} onClick={p.onClose}>{pending.length?'Cancel':'Done'}</button></div>{!p.connected&&<p className="bulk-note">Connect RunPod before uploading.</p>}{note&&<p className="bulk-note" role="status">{note}</p>}
 </section>;
}
