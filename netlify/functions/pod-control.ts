import {getStore} from '@netlify/blobs';
const HEADERS={'Cache-Control':'no-store'};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:HEADERS});
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
// Runpod's official REST v2 contract: /v2/pods and /v2/pods/{id}/action.
// Only expose safe UI fields; pod env, registry and startup args may contain secrets.
function safePod(p:any){if(!validId(p?.id))throw Error('Invalid pod response.');return{id:p.id,name:String(p.name||p.id).slice(0,160),status:String(p.status||'UNKNOWN'),actions:Array.isArray(p.actions)?p.actions.filter((a:unknown)=>a==='start'||a==='stop'):[],gpu:typeof p.gpu?.id==='string'?p.gpu.id:'CPU / unavailable',ports:Array.isArray(p.ports)?p.ports.filter((x:unknown)=>typeof x==='string'&&/^\d+\/(http|tcp)$/.test(x)).slice(0,30):[]};}
async function bounded(req:Request){const reader=req.body?.getReader();if(!reader)return{};let raw='';const decoder=new TextDecoder();try{while(true){const {done,value}=await reader.read();if(done)break;raw+=decoder.decode(value,{stream:true});if(raw.length>3000){await reader.cancel();throw Error('Request too large.');}}}finally{reader.releaseLock();}return JSON.parse(raw||'{}');}
export default async function control(req:Request){
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Cross-site request rejected.'},403);
 if(!['GET','PUT','POST','DELETE'].includes(req.method))return json({error:'Method unavailable.'},405);
 const token=req.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)return json({error:'Add your RunPod API key in Settings first.'},401);
 try{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));const id=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
 const cipherKey=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode('pod-control:'+token)),'AES-GCM',false,['encrypt','decrypt']);
 const store=getStore({name:'pocket-pod-credentials-v1',consistency:'strong'});
 if(req.method==='DELETE'){await store.delete(id);return json({configured:false});}
 const saved=await store.get(id,{type:'json'}) as {iv:number[];data:number[]}|null;
 if(req.method==='GET'&&!saved)return json({configured:false,pods:[]});
 if(req.method!=='PUT'&&!saved)return json({error:'Add your RunPod API key first.'},401);
 const body=req.method==='GET'?{}:await bounded(req);
 const key=req.method==='PUT'?(typeof body.key==='string'?body.key.trim():''):saved?new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(saved.iv)},cipherKey,new Uint8Array(saved.data))):'';
 if(!key||key.length<20||key.length>512||!/^[A-Za-z0-9_-]+$/.test(key))return json({error:'Enter a valid RunPod API key.'},400);
 async function api(path:string,method='GET',data?:object){const response=await fetch('https://api.runpod.io/v2'+path,{method,headers:{Authorization:'Bearer '+key,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(25000),redirect:'error'});const raw=await response.text();let result:any;try{result=JSON.parse(raw);}catch{throw Error('RunPod returned an unreadable response. Refresh status before retrying an action.');}if(!response.ok){const detail=typeof result.detail==='string'?result.detail.slice(0,500).split(key).join('[redacted]'):'';throw Error(response.status===401?'RunPod rejected this key.':response.status===403?'This key needs Pods read/write permission.':response.status===429?'RunPod rate limit reached. Wait and refresh status.':detail||'RunPod returned HTTP '+response.status+'. Refresh status before retrying.');}return result;}
 async function list(){const pods:any[]=[];let cursor='';for(let page=0;page<10;page++){const data=await api('/pods?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(!Array.isArray(data.pods))throw Error('RunPod did not return a pod list.');pods.push(...data.pods.map(safePod));if(!data.pagination?.hasNextPage)return pods;const next=data.pagination.nextCursor;if(typeof next!=='string'||!next||next===cursor)throw Error('Invalid RunPod pagination.');cursor=next;}throw Error('Too many pod pages. Use the RunPod console to narrow the account.');}
 if(req.method==='PUT'){const pods=await list();const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},cipherKey,new TextEncoder().encode(key));await store.setJSON(id,{iv:Array.from(iv),data:Array.from(new Uint8Array(data))});return json({configured:true,pods});}
 if(!saved)return json({error:'Add your RunPod API key first.'},401);
 const podId=req.method==='GET'?new URL(req.url).searchParams.get('pod'):body.id;
 if(req.method==='GET')return podId?(validId(podId)?json({configured:true,pod:safePod(await api('/pods/'+encodeURIComponent(podId)))}):json({error:'Invalid pod.'},400)):json({configured:true,pods:await list()});
 if(!validId(podId)||!['start','stop'].includes(body.action))return json({error:'Choose a pod and Start or Stop.'},400);
 const pod=await api('/pods/'+encodeURIComponent(podId));
 if(!Array.isArray(pod.actions)||!pod.actions.includes(body.action))return json({error:'This pod cannot '+body.action+' while '+String(pod.status)+'. Refresh its status.'},409);
 if(body.action==='stop'){
  const port=body.port===undefined?8188:Number(body.port);if(!Number.isInteger(port)||port<1||port>65535)return json({error:'Invalid ComfyUI port.'},400);
  let queue:any;try{if(!/^[a-z0-9-]+$/.test(podId))throw Error();const response=await fetch('https://'+podId+'-'+port+'.proxy.runpod.net/queue',{signal:AbortSignal.timeout(8000),redirect:'error'});if(!response.ok)throw Error();queue=await response.json();if(!Array.isArray(queue.queue_running)||!Array.isArray(queue.queue_pending))throw Error();}catch{if(body.allowUnavailable!==true)return json({error:'ComfyUI queue could not be checked. Confirm stopping without queue verification, or check the pod in RunPod.',code:'QUEUE_UNAVAILABLE'},409);}
  if(queue&&(queue.queue_running.length||queue.queue_pending.length))return json({error:'This pod still has running or queued shots. Pause them in Workspace or let them finish before stopping.',code:'QUEUE_ACTIVE'},409);
 }
 const result=await api('/pods/'+encodeURIComponent(podId)+'/action','POST',{action:body.action});return json({configured:true,pod:safePod(result)});
 }catch(e){return json({error:(e as Error).message||'RunPod controls are unavailable. Refresh status before retrying.'},502);}
}
