import type {Job} from './vault';
export function timingBucket(j:Job){return[j.workflowId||j.mode||'video',j.mode==='image'?'image':j.durationMapped===false?'default':j.duration,j.quality,j.aspect,j.turbo?'turbo':'normal',j.referenceUsed?'reference':'text',j.referenceProfile||'',j.device||j.base].join('|');}
export function timingStats(jobs:Job[],candidate:Job){const matches=jobs.filter(j=>!j.hidden&&j.state==='complete'&&!!j.timingSource&&typeof j.elapsedSeconds==='number'&&j.elapsedSeconds>=0&&timingBucket(j)===timingBucket(candidate)).sort((a,b)=>(b.completedAt||b.created)-(a.completedAt||a.created)).slice(0,20);if(!matches.length)return null;const times=matches.map(j=>j.elapsedSeconds!);return{count:times.length,last:times[0],average:times.reduce((a,b)=>a+b,0)/times.length,max:Math.max(...times)};}
export function timeLabel(seconds:number){const n=Math.max(0,Math.round(seconds));return n<60?n+'s':Math.floor(n/60)+'m '+String(n%60).padStart(2,'0')+'s';}
export function estimatedPercent(elapsed:number,last:number,complete=false){return complete?100:Math.max(0,Math.min(95,Math.round(elapsed/Math.max(1,last)*100)));}
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
export function mergeJobStatus(job:Job,status:any,now=Date.now()):Job{
 const next:Job={...job,state:status.state,files:status.files||job.files,error:status.error,queuePosition:status.state==='queued'?status.position:undefined};
 const serverStart=positive(status.startedAt)?status.startedAt:undefined;
 const start=serverStart||job.startedAt||(status.state==='running'?now:undefined);
 if(start){next.startedAt=start;next.timingSource=serverStart?'server':job.timingSource||'observed';next.queueSeconds=Math.max(0,(start-job.created)/1000);}
 if(status.state==='complete'){
  const end=positive(status.completedAt)?status.completedAt:job.completedAt||now;
  next.completedAt=end;next.totalSeconds=Math.max(0,(end-job.created)/1000);
  if(serverStart&&typeof status.elapsedSeconds==='number'&&Number.isFinite(status.elapsedSeconds)&&status.elapsedSeconds>=0)next.elapsedSeconds=status.elapsedSeconds;
  else if(start)next.elapsedSeconds=Math.max(0,(end-start)/1000);
  else {delete next.elapsedSeconds;delete next.timingSource;}
 }
 return next;
}
export function jobTiming(job:Job,now=Date.now()){
 const done=job.state==='complete',end=done?(job.completedAt||now):now;
 const generation=done?(job.timingSource&&typeof job.elapsedSeconds==='number'?job.elapsedSeconds:null):job.state==='running'&&job.startedAt?Math.max(0,(now-job.startedAt)/1000):null;
 const queue=job.queueSeconds??(job.startedAt?Math.max(0,(job.startedAt-job.created)/1000):!done?Math.max(0,(now-job.created)/1000):null);
 const total=job.totalSeconds??(done&&!job.timingSource&&typeof job.elapsedSeconds==='number'?job.elapsedSeconds:Math.max(0,(end-job.created)/1000));
 return{generation,queue,total};
}
export function pruneTimingHistory(jobs:Job[]){
 const keep=new Set(jobs.filter(j=>j.state==='complete'&&typeof j.elapsedSeconds==='number').sort((a,b)=>(b.completedAt||b.created)-(a.completedAt||a.created)).slice(0,20).map(j=>JSON.stringify([j.base,j.id])));
 return jobs.map(j=>{if(typeof j.elapsedSeconds==='number'&&j.state==='complete'&&!keep.has(JSON.stringify([j.base,j.id]))){const {elapsedSeconds,startedAt,timingSource,queueSeconds,totalSeconds,...record}=j;return record;}return j;});
}
