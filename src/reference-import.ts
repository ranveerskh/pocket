export const MAX_REFERENCE_PHOTOS=20;
export type PhotoDraft={id:string;name:string;file:File;state:'ready'|'uploading'|'saved'|'error';error?:string};
export function photoName(filename:string){return filename.replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().slice(0,60);}
const normalized=(name:string)=>name.trim().normalize('NFKC').toLocaleLowerCase();
export function photoErrors(rows:PhotoDraft[],existingNames:string[]){
 const names=new Set(existingNames.map(normalized)),errors=new Map<string,string>();
 const counts=new Map<string,number>();for(const row of rows.filter(r=>r.state!=='saved')){const key=normalized(row.name);counts.set(key,(counts.get(key)||0)+1);}
 for(const row of rows){if(row.state==='saved')continue;const name=row.name.trim(),key=normalized(name);
  if(!/\.(png|jpe?g|webp)$/i.test(row.file.name)||row.file.type&&!['image/png','image/jpeg','image/webp'].includes(row.file.type))errors.set(row.id,'Choose a JPG, PNG or WebP photo.');
  else if(row.file.size>15*1024*1024)errors.set(row.id,'Photo must be under 15 MB.');
  else if(!row.file.size)errors.set(row.id,'This photo is empty. Choose another file.');
  else if(!name||name.length>60||/[\r\n|]/.test(name))errors.set(row.id,'Use a name of 1–60 characters, without | or line breaks.');
  else if(names.has(key)||(counts.get(key)||0)>1)errors.set(row.id,'Use a unique name, e.g. Martha Young or Martha Present.');
 }
 return errors;
}
export async function uploadReference(base:string,file:File,kind:'image'|'audio',signal?:AbortSignal){
 if(file.size>15*1024*1024)throw Error('Each reference file must be under 15 MB.');
 const form=new FormData();form.set('base',base);form.set('kind',kind);form.set(kind,file);
 const res=await fetch('/api/comfy',{method:'POST',body:form,signal});const data=await res.json();
 if(!res.ok||data.error)throw Error(data.error||'Reference upload failed.');
 if(typeof data.name!=='string'||!data.name)throw Error('Upload returned no file name. Retry this photo.');
 return(data.subfolder?data.subfolder+'/':'')+data.name;
}
