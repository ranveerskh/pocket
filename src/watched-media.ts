import {localStorage} from './local-mode';
import type {Job} from './vault';
export const WATCHED_EVENT='pocket-media-watched';
export function watchedKey(job:Job){const file=job.files?.[0];return 'pocket-watched:'+JSON.stringify([job.base,job.id,file?.subfolder||'',file?.filename||'',file?.type||'output']);}
export function isWatched(job:Job){try{return localStorage.getItem(watchedKey(job))==='watched';}catch{return false;}}
export function markWatched(job:Job){if(job.mode==='image'||!job.files?.length)return;try{localStorage.setItem(watchedKey(job),'watched');}catch{}window.dispatchEvent(new CustomEvent(WATCHED_EVENT,{detail:watchedKey(job)}));}
