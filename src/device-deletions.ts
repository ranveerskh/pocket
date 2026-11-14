import {localStorage} from './local-mode.ts';
const KEY='pocket-device-deleted-jobs';
export function readDeviceDeletions(storage:Storage=localStorage):string[]{try{const data=JSON.parse(storage.getItem(KEY)||'[]');return Array.isArray(data)?data.filter(id=>typeof id==='string'):[];}catch{return [];}}
export function rememberDeviceDeletions(ids:string[],storage:Storage=localStorage){storage.setItem(KEY,JSON.stringify([...new Set([...readDeviceDeletions(storage),...ids])]));}
