import type {Job} from './vault';
export type GallerySort='scene'|'oldest'|'newest';
export function sceneDetails(job:Job){
 const prompt=job.basePrompt||job.prompt;
 const match=prompt.match(/(?:^|\n)[^\n]{0,100}?\bSCENE[ \t]+(\d{1,4})\b([^\n]*)/i);
 const number=match?Number(match[1]):undefined;
 const title=match?.[2].replace(/^[\s—–:|.\-]+/,'').trim();
 return{number:number&&number>0?number:undefined,title:title||undefined};
}
export function creationLabel(job:Job){const scene=sceneDetails(job).number;return scene?'Scene '+String(scene).padStart(2,'0'):Number.isInteger(job.batchIndex)?'Prompt '+String(job.batchIndex!+1).padStart(2,'0'):job.mode==='image'?'Image':'Video';}
export function creationTitle(job:Job){return sceneDetails(job).title||(job.basePrompt||job.prompt).trim();}
export function creationDownloadName(job:Job,filename:string){const scene=sceneDetails(job).number;return scene?'Scene_'+String(scene).padStart(2,'0')+'_'+filename:Number.isInteger(job.batchIndex)?'Prompt_'+String(job.batchIndex!+1).padStart(2,'0')+'_'+filename:filename;}
export function galleryItems(jobs:Job[],view:string,filter='all',query='',sort:GallerySort='scene') {
 const entries=jobs.filter(j=>(view==='hidden'?j.hidden===true:!j.hidden)&&(view==='hidden'||view==='all'||(view==='unfiled'?!j.folder:j.folder===view))&&(filter==='all'||(j.mode==='image'?'image':'video')===filter)&&(!query||(j.basePrompt||j.prompt).toLowerCase().includes(query.toLowerCase())));
 const groups=new Map<string,number>(),batchTimes=new Map<string,number>();for(const j of entries){const group=j.folder||'';groups.set(group,Math.max(groups.get(group)||0,j.created));if(j.batchId)batchTimes.set(j.batchId,Math.min(batchTimes.get(j.batchId)??Infinity,j.created));}
 return entries.sort((a,b)=>{
  if(sort==='newest')return b.created-a.created||a.id.localeCompare(b.id);
  if(sort==='oldest')return a.created-b.created||a.id.localeCompare(b.id);
  const ag=a.folder||'',bg=b.folder||'';
  if(ag!==bg)return (groups.get(bg)!-groups.get(ag)!)||ag.localeCompare(bg);
  const an=sceneDetails(a).number,bn=sceneDetails(b).number;
  if(an!==undefined||bn!==undefined){if(an===undefined)return 1;if(bn===undefined)return -1;if(an!==bn)return an-bn;}
  // A total ordering keeps unnumbered batches together, then orders their prompt indices.
  const batchTime=(j:Job)=>j.batchId?batchTimes.get(j.batchId)!:j.created;
  if(an===undefined&&bn===undefined){const delta=batchTime(a)-batchTime(b);if(delta)return delta;const groupDelta=(a.batchId||a.id).localeCompare(b.batchId||b.id);if(groupDelta)return groupDelta;if(a.batchId===b.batchId&&a.batchId)return (a.batchIndex??0)-(b.batchIndex??0)||a.id.localeCompare(b.id);}
  return a.created-b.created||a.id.localeCompare(b.id);
 });
}
export function localId(){return 'local-'+Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');}
