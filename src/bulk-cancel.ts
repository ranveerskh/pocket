import type {Job} from './vault';
import {mergeJobStatus} from './timing';

const ACTIVE = new Set(['staging', 'submitting', 'submission_unknown', 'queued', 'running', 'unknown']);
export const canCancelBulk = (job: Job) => Boolean(job.batchId && (job.cancelRequested || ACTIVE.has(job.state)));
export type BatchCancellation = {
  batch_ids: string[];
  items: {id: string; batchId: string; index: number; state: string; files?: Job['files']; startedAt?: number; completedAt?: number; elapsedSeconds?: number}[];
};

export function applyBatchCancellation(job: Job, base: string, result: BatchCancellation): Job {
  if (job.base !== base || !job.batchId || !result.batch_ids.includes(job.batchId) || !canCancelBulk(job)) return job;
  const item = result.items.find(item => item.id === job.id || (item.batchId === job.batchId && item.index === job.batchIndex));
  if (item?.state === 'complete') return {...mergeJobStatus({...job, id:item.id}, item), cancelRequested:undefined};
  if (item && ['queued', 'running'].includes(item.state)) {
    return {...job, id:item.id, state:item.state, cancelRequested:true, error:'Cancellation requested. Waiting for RunPod to stop this shot.'};
  }
  return {...job, id:item?.id || job.id, state:'cancelled', cancelRequested:undefined, error:undefined, queuePosition:undefined};
}
