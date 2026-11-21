import {useRef,useState} from 'react';
import {mergeJobStatus} from './timing';
import type {Job,useGalleryStore} from './vault';
export const executionId=(job:Job)=>job.executionId||job.id;
export const canPause=(job:Job)=>!job.cancelRequested&&['queued','running','unknown','pausing'].includes(job.state);
const revision=(job:Job)=>Math.max(Date.now(),(job.controlAt||0)+1);
async function call(base:string,action:string,params:object){const r=await fetch('/api/comfy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base,action,...params}),signal:AbortSignal.timeout(90000)});const d=await r.json();if(!r.ok||d.error)throw Error(d.error||'Queue operation failed.');return d;}
export function useQueuePause(vault:ReturnType<typeof useGalleryStore>){
 const live=useRef(vault);live.current=vault;const working=useRef(false);const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 function save(changes:Map<string,Job>){const current=live.current;const jobs=current.jobs.map(j=>changes.get(j.id)||j);current.saveProjectChanges({jobs,folders:current.folders,characters:current.characters,characterIds:current.characterIds});live.current={...current,jobs};}
 async function pause(targets:Job[],mode:'now'|'after'){
  if(working.current||!vault.loaded||vault.legacyLocked)return;working.current=true;setBusy(true);setMessage('Saving workflows before pausing…');
  try{
   targets=targets.filter(canPause);if(!targets.length)return;
   for(const base of new Set(targets.map(j=>j.base))){const selected=targets.filter(j=>j.base===base);
    for(let offset=0;offset<selected.length;offset+=50){const group=selected.slice(offset,offset+50);
     const prepared=await call(base,'pause_prepare',{ids:group.map(executionId)});const changes=new Map<string,Job>();
     for(const original of group){const current=live.current.jobs.find(j=>j.id===original.id);if(!current)continue;const found=prepared.items.find((x:any)=>x.id===executionId(current));
      if(found?.state==='complete'){changes.set(current.id,{...mergeJobStatus(current,found),controlAt:revision(current)});continue;}
      const graph=current.resumeGraph||found?.graph;if(!graph)throw Error(found?.error||'Original workflow unavailable. No further shots were paused.');
      changes.set(current.id,{...current,resumeGraph:graph,state:'pausing',pauseMode:mode,controlAt:revision(current),error:undefined});
     }
     // Synchronous durable browser save must succeed before removing a remote prompt.
     save(changes);
     const pending=[...changes.values()].filter(j=>j.state==='pausing');if(!pending.length)continue;
     const result=await call(base,'pause_commit',{ids:pending.map(executionId),pauseMode:mode});const confirmed=new Map<string,Job>();
     for(const old of pending){const current=live.current.jobs.find(j=>j.id===old.id)||old;const found=result.items.find((x:any)=>x.id===executionId(old));if(!found)continue;
      confirmed.set(old.id,found.state==='complete'?{...mergeJobStatus(current,found),resumeGraph:undefined,pauseMode:undefined,controlAt:revision(current)}:{...current,state:found.state,controlAt:revision(current),pauseMode:found.state==='pausing'?mode:undefined,error:undefined});
     }save(confirmed);
    }
   }
   const uncertain=live.current.jobs.some(j=>j.state==='pausing');setMessage(uncertain?'Pause still needs confirmation. Retry Pause before stopping the pod.':mode==='after'?'Pending shots paused. Let the running shot finish before stopping the pod. Resume is manual.':'Pause confirmed. Paused shots restart from the beginning when you press Resume.');
  }catch(e){setMessage('Pause needs attention: '+(e as Error).message+' Keep the pod online; retry Pause to confirm.');}finally{working.current=false;setBusy(false);}
 }
 async function resume(targets:Job[]){
  if(working.current||!vault.loaded||vault.legacyLocked)return;working.current=true;setBusy(true);setMessage('Resuming saved shots…');
  try{for(const original of [...targets].sort((a,b)=>(a.batchIndex??0)-(b.batchIndex??0))){const job=live.current.jobs.find(j=>j.id===original.id);if(!job||!['paused','resuming'].includes(job.state))continue;if(!job.resumeGraph)throw Error('Saved workflow unavailable. Use Reuse prompt for this shot.');
    const pending={...job,state:'resuming',controlAt:revision(job),error:undefined};save(new Map([[job.id,pending]]));
    const r=await fetch('/.netlify/functions/resume-shot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base:job.base,id:executionId(job),graph:job.resumeGraph,batchId:job.batchId,batchIndex:job.batchIndex}),signal:AbortSignal.timeout(90000)});const d=await r.json();if(!r.ok||d.error)throw Error(d.error||'Resume was not confirmed.');
    const next:Job={...pending,executionId:d.id,state:'queued',controlAt:revision(pending),created:Date.now(),startedAt:undefined,completedAt:undefined,elapsedSeconds:undefined,timingSource:undefined,totalSeconds:undefined,queueSeconds:undefined,queuePosition:undefined,files:undefined,autoCopyPending:undefined,cancelRequested:undefined,pauseMode:undefined};save(new Map([[job.id,next]]));
   }setMessage('Selected shots resumed in order. Completed shots were kept.');
  }catch(e){setMessage('Resume needs attention: '+(e as Error).message+' Retry Resume to recover the existing submission; it will not be sent twice.');}finally{working.current=false;setBusy(false);}
 }
 return{busy,message,pause,resume};
}
