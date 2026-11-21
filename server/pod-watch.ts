import {getStore} from '@netlify/blobs';
export const watchStore=()=>getStore({name:'pocket-pod-watch-v1',consistency:'strong'});
export type PodWatch={owner:string;access:string;pod:string;port:number;generation:string;state:'armed'|'idle'|'stopping'|'stopped'|'attention'|'off';ids:string[];armedAt:number;checkedAt?:number;idleAt?:number;message?:string};
export const watchKey=(owner:string,pod:string)=>owner+'/'+pod;
export function publicWatch(w:PodWatch|null){return w?{state:w.state,pod:w.pod,armedAt:w.armedAt,checkedAt:w.checkedAt,message:w.message||'',count:w.ids.length}:null;}
export async function credentialId(access:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(access))),v=>v.toString(16).padStart(2,'0')).join('');}
export async function readPodKey(access:string){
 const owner=await credentialId(access),saved=await getStore({name:'pocket-pod-credentials-v1',consistency:'strong'}).get(owner,{type:'json'}) as {iv:number[];data:number[]}|null;
 if(!saved)throw Error('RunPod API key removed. Auto-stop disabled.');
 const cipher=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode('pod-control:'+access)),'AES-GCM',false,['decrypt']);
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(saved.iv)},cipher,new Uint8Array(saved.data)));
}
export async function podAPI(key:string,path:string,method='GET',body?:object){
 const r=await fetch('https://api.runpod.io/v2'+path,{method,headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000),redirect:'error'});
 if(!r.ok)throw Error('RunPod request failed ('+r.status+').');return r.json();
}
export async function comfyRead(pod:string,port:number,path:string){
 if(!/^[a-z0-9-]+$/.test(pod)||!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid pod address.');
 const r=await fetch('https://'+pod+'-'+port+'.proxy.runpod.net'+path,{signal:AbortSignal.timeout(4000),redirect:'error'});if(!r.ok)throw Error('ComfyUI unavailable. Auto-stop will retry.');return r.json();
}
export function queueIds(q:any):string[]{
 if(!Array.isArray(q?.queue_running)||!Array.isArray(q?.queue_pending))throw Error('Queue status unavailable.');
 return [...q.queue_running,...q.queue_pending].map((entry:any)=>{if(!Array.isArray(entry)||typeof entry[1]!=='string'||!/^[A-Za-z0-9-]{1,180}$/.test(entry[1]))throw Error('Invalid queue entry.');return entry[1];});
}
// Fail closed: an empty queue alone never authorizes a stop. Every captured
// execution must be finished: successful with saved output, or failed.
export function inspectWatch(w:PodWatch,q:any,history:any,now:number):PodWatch{
 const current=queueIds(q),ids=[...new Set([...w.ids,...current])];
 if(ids.length>1000)return{...w,state:'attention',checkedAt:now,message:'Too many tracked shots. Auto-stop disabled.'};
 if(now-w.armedAt>172800000)return{...w,state:'attention',checkedAt:now,message:'Auto-stop expired after 48 hours. Arm it again.'};
 if(current.length)return{...w,ids,state:'armed',idleAt:undefined,checkedAt:now,message:'Waiting for queue to finish.'};
 const success=ids.length>0&&ids.every(id=>{const h=history?.[id];if(h?.status?.messages?.some((m:any)=>m?.[0]==='execution_interrupted'))return false;if(h?.status?.status_str==='error')return true;return h?.status?.completed===true&&h.status.status_str==='success'&&Object.values(h.outputs||{}).some((output:any)=>['images','gifs','videos','audio'].some(field=>Array.isArray(output?.[field])&&output[field].some((f:any)=>typeof f.filename==='string'&&f.filename.length>0&&f.type==='output')));});
 if(!success)return{...w,ids,state:'attention',checkedAt:now,message:'A shot is paused, missing or has no confirmed saved output. Pod kept running.'};
 return{...w,ids,state:'idle',idleAt:w.idleAt||now,checkedAt:now,message:'Queue complete. Confirming idle before stopping.'};
}
export async function checkWatch(key:string,now=Date.now()){
 const store=watchStore(),record=await store.getWithMetadata(key,{type:'json'});if(!record)return;
 const w=record.data as PodWatch;if(!['armed','idle','stopping'].includes(w.state))return;
 try{
  const apiKey=await readPodKey(w.access);
  if(w.state==='stopping'){
   if(now-(w.checkedAt||w.armedAt)<120000)return;
   const pod=await podAPI(apiKey,'/pods/'+w.pod);
   if(['EXITED','STOPPED'].includes(pod.status)){await store.setJSON(key,{...w,state:'stopped',access:'',checkedAt:now,message:'Pod stopped. Storage charges may continue.'},{onlyIfMatch:record.etag});return;}
   // Recover a worker crash or lost response through fresh queue/history checks.
   // Never blindly repeat a power action from an ambiguous response.
   await store.setJSON(key,{...w,state:'armed',idleAt:undefined,checkedAt:now,message:'Rechecking queue before retrying an unconfirmed stop.'},{onlyIfMatch:record.etag});return;
  }

  const [q,history]=await Promise.all([comfyRead(w.pod,w.port,'/queue'),comfyRead(w.pod,w.port,'/history?max_items=1000')]);
  const next=inspectWatch(w,q,history,now);
  if(next.state!=='idle'||!w.idleAt||now-w.idleAt<60000){await store.setJSON(key,next.state==='attention'?{...next,access:''}:next,{onlyIfMatch:record.etag});return;}
  // A lease prevents another worker or UI re-arm from racing this stop decision.
  const claim={...next,state:'stopping' as const,message:'Stopping pod after completed queue.'};
  const claimed=await store.setJSON(key,claim,{onlyIfMatch:record.etag});if(!claimed.modified)return;
  const latest=await store.getWithMetadata(key,{type:'json'});if(!latest||latest.data.generation!==w.generation||latest.data.state!=='stopping')return;
  const [pod,finalQueue]=await Promise.all([podAPI(apiKey,'/pods/'+w.pod),comfyRead(w.pod,w.port,'/queue')]);
  if(queueIds(finalQueue).length){await store.setJSON(key,{...claim,state:'armed',idleAt:undefined,message:'New queued work detected.'},{onlyIfMatch:latest.etag});return;}
  if(!Array.isArray(pod.actions)||!pod.actions.includes('stop'))throw Error('Pod cannot stop in its current state. Check RunPod.');
  const stopped=await podAPI(apiKey,'/pods/'+w.pod+'/action','POST',{action:'stop'});
  // Never automatically retry an ambiguous power write.
  await store.setJSON(key,{...claim,state:'stopped',access:'',checkedAt:Date.now(),message:'Stop accepted by RunPod. Storage charges may continue.'},{onlyIfMatch:latest.etag});
  void stopped;
 }catch(e){
  const latest=await store.getWithMetadata(key,{type:'json'});if(!latest||latest.data.generation!==w.generation)return;
  const stopping=latest.data.state==='stopping',removed=(e as Error).message.includes('API key removed');
  await store.setJSON(key,{...latest.data,state:removed?'attention':latest.data.state,access:removed?'':latest.data.access,checkedAt:now,message:stopping?'Verifying an unconfirmed stop with RunPod.':(e as Error).message},{onlyIfMatch:latest.etag});
 }
}
