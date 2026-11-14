import {useEffect,useRef,useState} from 'react';
import {X,Trash2} from 'lucide-react';
import type {Job} from './vault';
import {useDeviceMedia} from './LocalMedia';
import {deleteDeviceItems,type ActionResult} from './gallery-actions';
export default function DeleteDialog({items,onClose,onBusy,onFinish}:{items:Job[];onClose:()=>void;onBusy:(busy:boolean)=>void;onFinish:(results:ActionResult[])=>void}){
 const local=useDeviceMedia(),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),inFlight=useRef(false);
 useEffect(()=>{onBusy(busy);return()=>onBusy(false);},[busy]);
 async function confirm(){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');const ids=items.map(job=>job.id);local.pause(ids);
  try{const results=await deleteDeviceItems(ids,id=>local.remove([id]),(n,total)=>setProgress('Deleting '+n+' / '+total));onFinish(results);}
  catch(e){setError((e as Error).message);}
  finally{local.resume(ids);setBusy(false);inFlight.current=false;setProgress('');}
 }
 return <div className="modal-backdrop delete-backdrop" onClick={busy?undefined:onClose}><section className="panel delete-dialog" role="dialog" aria-modal="true" aria-label="Delete from this device" onClick={e=>e.stopPropagation()}><div className="modal-heading"><h2>Delete {items.length} item{items.length===1?'':'s'} from this device?</h2><button className="icon-button" disabled={busy} aria-label="Cancel deletion" onClick={onClose}><X size={20}/></button></div><p className="delete-note">Removes the selected gallery records and app media copies from this browser only. Files on your PC or RunPod, other browsers/devices, and Photos/Files exports are kept.</p><p className="delete-note">For PC or RunPod output cleanup, use Settings → Storage → Cleanup guide.</p>{error&&<p className="error" role="alert">{error}</p>}{progress&&<p role="status">{progress}</p>}<div className="workflow-actions"><button className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button danger" disabled={busy||!items.length} onClick={()=>void confirm()}><Trash2 size={15}/>{busy?'Deleting…':'Delete from this device'}</button></div></section></div>;
}
