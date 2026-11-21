import {getStore} from '@netlify/blobs';
import {runpodURL,jsonUp,upstream,validateCustomGraph} from '../../server/comfy.ts';
const headers={'Cache-Control':'no-store'};
export default async function resume(req:Request){
 if(req.method!=='POST')return Response.json({error:'Method unavailable.'},{status:405,headers});
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return Response.json({error:'Cross-site request rejected.'},{status:403,headers});
 try{
 const raw=await req.text();if(raw.length>150000)return Response.json({error:'Workflow too large.'},{status:413,headers});
 const p=JSON.parse(raw),base=runpodURL(p.base);if(typeof p.id!=='string'||!/^[a-zA-Z0-9-]{1,180}$/.test(p.id))throw Error('Invalid paused shot.');
 const graph=validateCustomGraph(p.graph);
 const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(base+':'+p.id))),v=>v.toString(16).padStart(2,'0')).join('');
 const store=getStore({name:'pocket-resume-receipts-v1',consistency:'strong'});
 const old=await store.get(key,{type:'json'}) as any;if(old?.id)return Response.json({id:old.id},{headers});
 // Recover an accepted submission if the reply or receipt write was interrupted.
 const [queue,history]=await Promise.all([jsonUp(base,'/queue'),jsonUp(base,'/history?max_items=500')]);
 const existing=[...(queue.queue_running||[]),...(queue.queue_pending||[]),...Object.values(history).map((h:any)=>h.prompt)].find((q:any)=>q?.[3]?.pocket_resume_from===p.id);
 if(existing){await store.setJSON(key,{id:existing[1]});return Response.json({id:existing[1]},{headers});}
 if(old)throw Error('Resume submission needs recovery. It was not automatically sent again. Keep the pod online and retry shortly.');
 const claimed=await store.setJSON(key,{pending:true,at:Date.now()},{onlyIfNew:true});
 if(!claimed.modified)throw Error('Another device is resuming this shot. Retry shortly to recover its status.');
 try{
 const response=await upstream(base,'/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,client_id:crypto.randomUUID(),extra_data:{pocket_resume_from:p.id,pocket_submitted_at:Date.now(),...(p.batchId?{pocket_batch_id:p.batchId,pocket_item_index:p.batchIndex}:{})}})});
 const result=await response.json();if(!response.ok){if(response.status>=400&&response.status<500)await store.delete(key);throw Error(typeof result.error==='string'?result.error:result.error?.message||'ComfyUI rejected this workflow. Check models and reference files.');}
 if(typeof result.prompt_id!=='string')throw Error('ComfyUI did not confirm the resumed shot.');
 await store.setJSON(key,{id:result.prompt_id});return Response.json({id:result.prompt_id},{headers});
 }catch(error){
 // A definite validation rejection is safe to retry after fixing missing nodes/files.
 if(String(error).includes('validation')||String(error).includes('not in list'))await store.delete(key);
 throw error;
 }
 }catch(e){return Response.json({error:(e as Error).message},{status:400,headers});}
}
