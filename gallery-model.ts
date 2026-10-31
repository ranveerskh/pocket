import type {Job} from './vault';
export function galleryItems(jobs:Job[],view:string,filter='all',query='') {
 return jobs.filter(j=>(view==='hidden'?j.hidden===true:!j.hidden)&&(view==='hidden'||view==='all'||(view==='unfiled'?!j.folder:j.folder===view))&&(filter==='all'||(j.mode==='image'?'image':'video')===filter)&&(!query||j.prompt.toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>b.created-a.created);
}
export function localId(){return 'local-'+Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');}
