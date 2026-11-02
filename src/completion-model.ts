import type {Job} from './vault';
export const completionKey=(job:Pick<Job,'base'|'id'>)=>JSON.stringify([job.base,job.id]);
export function completedSince(previous:Map<string,string>,jobs:Job[]){
 return jobs.filter(job=>!job.hidden&&job.state==='complete'&&['queued','running','unknown'].includes(previous.get(completionKey(job))||''));
}
export function completionSnapshot(jobs:Job[]){return new Map(jobs.map(job=>[completionKey(job),job.state]));}

export function alertsEnabled(value:string|null){return value!=='off';}
