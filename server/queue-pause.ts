import {jsonUp,upstream,videoFiles,historyTiming,validateCustomGraph} from './comfy.ts';
const valid=(id:unknown):id is string=>typeof id==='string'&&/^[a-zA-Z0-9-]{1,180}$/.test(id);
export async function pauseQueue(base:string,p:any){
 if(!Array.isArray(p.ids)||!p.ids.length||p.ids.length>50||!p.ids.every(valid))throw Error('Choose 1–50 submitted shots.');
 const ids=new Set<string>(p.ids);
 const [queue,history]=await Promise.all([jsonUp(base,'/queue'),jsonUp(base,'/history?max_items=500')]);
 const entries=[...(queue.queue_running||[]),...(queue.queue_pending||[])];
 const complete=(id:string)=>{const item=history[id];return item?.status?.completed&&item.status.status_str!=='error'?{id,state:'complete',files:videoFiles(item),...historyTiming(item)}:undefined;};
 if(p.action==='pause_prepare')return {items:p.ids.map((id:string)=>{const done=complete(id);if(done)return done;const entry=entries.find((q:any)=>q[1]===id)||history[id]?.prompt;if(!entry?.[2])return{id,state:'unknown',error:'Original workflow not found. Keep the pod online and recover its queue first.'};return{id,state:'prepared',graph:validateCustomGraph(entry[2])};})};
 if(p.action!=='pause_commit'||!['now','after'].includes(p.pauseMode))throw Error('Invalid pause request.');
 // Preserve only the shot that was already rendering before pending items were removed.
 const leaveRunning=new Set((queue.queue_running||[]).filter((q:any)=>ids.has(q[1])).map((q:any)=>q[1]));
 const deleted=await upstream(base,'/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delete:[...ids]})});if(!deleted.ok)throw Error('Could not pause pending shots.');
 const next=await jsonUp(base,'/queue');
 for(const q of next.queue_running||[])if(ids.has(q[1])&&(p.pauseMode==='now'||!leaveRunning.has(q[1]))){const r=await upstream(base,'/interrupt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt_id:q[1]})});if(!r.ok)throw Error('Queued shots paused; running shot still needs interruption. Retry Pause.');}
 const [remaining,latest]=await Promise.all([jsonUp(base,'/queue'),jsonUp(base,'/history?max_items=500')]);
 return{items:p.ids.map((id:string)=>{const item=latest[id];if(item?.status?.completed&&item.status.status_str!=='error')return{id,state:'complete',files:videoFiles(item),...historyTiming(item)};if(remaining.queue_running?.some((q:any)=>q[1]===id))return{id,state:p.pauseMode==='after'&&leaveRunning.has(id)?'running':'pausing'};if(remaining.queue_pending?.some((q:any)=>q[1]===id))return{id,state:'pausing'};return{id,state:'paused'};})};
}
