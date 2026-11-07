import type {Job} from './vault';
export function timingBucket(j:Job){return[j.workflowId||j.mode||'video',j.mode==='image'?'image':j.durationMapped===false?'default':j.duration,j.quality,j.aspect,j.turbo?'turbo':'normal',j.referenceUsed?'reference':'text',j.referenceProfile||'',j.device||j.base].join('|')+(j.workflowId==='builtin-qwen-image21'?'|cfg'+(j.guidance??1):'');}
export const TIMING_LIMIT=5;
export const TIMING_STORAGE_KEY='pocket-timing-v1';
export type TimingSample={id:string;bucket:string;seconds:number;completedAt:number};
export function mergeTimingSamples(previous:TimingSample[],jobs:Job[]):TimingSample[]{
 const hidden=new Set(jobs.filter(j=>j.hidden).map(j=>JSON.stringify([j.base,j.id])));
 const samples=new Map<string,TimingSample>();
 for(const sample of previous)if(sample&&typeof sample.id==='string'&&sample.id.length<1000&&typeof sample.bucket==='string'&&sample.bucket.length<1000&&Number.isFinite(sample.seconds)&&sample.seconds>=0&&Number.isFinite(sample.completedAt)&&!hidden.has(sample.id))samples.set(sample.id,sample);
 for(const j of jobs)if(!j.hidden&&j.state==='complete'&&j.timingSource&&typeof j.elapsedSeconds==='number'&&Number.isFinite(j.elapsedSeconds)&&j.elapsedSeconds>=0){const id=JSON.stringify([j.base,j.id]);samples.set(id,{id,bucket:timingBucket(j),seconds:j.elapsedSeconds,completedAt:j.completedAt||j.created});}
 const counts=new Map<string,number>(),buckets=new Set<string>();
 return [...samples.values()].sort((a,b)=>b.completedAt-a.completedAt||a.id.localeCompare(b.id)).filter(s=>{if(!buckets.has(s.bucket)&&buckets.size>=32)return false;buckets.add(s.bucket);const count=counts.get(s.bucket)||0;if(count>=TIMING_LIMIT)return false;counts.set(s.bucket,count+1);return true;});
}
export function readTimingSamples(storage:Pick<Storage,'getItem'>):TimingSample[]{try{const raw=storage.getItem(TIMING_STORAGE_KEY);if(!raw||raw.length>200000)return[];const value=JSON.parse(raw);return Array.isArray(value)?mergeTimingSamples(value,[]):[];}catch{return[];}}
export function saveTimingSamples(storage:Pick<Storage,'setItem'>,samples:TimingSample[]){storage.setItem(TIMING_STORAGE_KEY,JSON.stringify(mergeTimingSamples(samples,[])));}
export function timingStats(jobs:Job[],candidate:Job,saved:TimingSample[]=[]){const matches=mergeTimingSamples(saved,jobs).filter(s=>s.bucket===timingBucket(candidate)).slice(0,TIMING_LIMIT);if(!matches.length)return null;const times=matches.map(s=>s.seconds);return{count:times.length,last:times[0],average:times.reduce((a,b)=>a+b,0)/times.length,max:Math.max(...times)};}
export function timeLabel(seconds:number){const n=Math.max(0,Math.round(seconds));return n<60?n+'s':Math.floor(n/60)+'m '+String(n%60).padStart(2,'0')+'s';}
export function estimatedPercent(elapsed:number,last:number,complete=false){return complete?100:Math.max(0,Math.min(95,Math.round(elapsed/Math.max(1,last)*100)));}
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
export function mergeJobStatus(job:Job,status:any,now=Date.now()):Job{
 const next:Job={...job,state:status.state,files:status.files||job.files,error:status.error,queuePosition:status.state==='queued'?status.position:undefined};
 const serverStart=positive(status.startedAt)?status.startedAt:undefined;
 const start=serverStart||job.startedAt||(status.state==='running'?now:undefined);
 if(start){next.startedAt=start;next.timingSource=serverStart?'server':job.timingSource||'observed';next.queueSeconds=Math.max(0,(start-job.created)/1000);}
 if(status.state==='complete'){
  next.autoCopyPending=Boolean(next.files?.length);
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
 const keep=new Set(mergeTimingSamples([],jobs).map(s=>s.id));
 return jobs.map(j=>{if(typeof j.elapsedSeconds==='number'&&j.state==='complete'&&!keep.has(JSON.stringify([j.base,j.id]))){const {elapsedSeconds,startedAt,timingSource,queueSeconds,totalSeconds,...record}=j;return record;}return j;});
}
