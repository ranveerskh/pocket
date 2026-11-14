import {mediaURL as resolveMediaURL} from './local-mode';
import {useEffect,useRef,useState} from 'react';
import {Download} from 'lucide-react';
import type {Job,MediaFile} from './vault';
import {useDeviceMedia} from './LocalMedia';
import {mediaKey} from './media-db';
import {exportFile} from './file-export';
import SaveFileDialog from './SaveFileDialog';
import {creationDownloadName} from './gallery-model';
export function mediaURL(base:string,file:MediaFile,download=false){return resolveMediaURL(base,file,download);}
export function fileType(name:string){return /\.mp4$|\.m4v$/i.test(name)?'video/mp4':/\.webm$/i.test(name)?'video/webm':/\.mov$/i.test(name)?'video/quicktime':/\.png$/i.test(name)?'image/png':/\.jpe?g$/i.test(name)?'image/jpeg':/\.webp$/i.test(name)?'image/webp':'application/octet-stream';}
export default function DownloadButton({job,file=job.files![0],className='download',label='Save'}:{job:Job;file?:MediaFile;className?:string;label?:string}){
 const service=useDeviceMedia(),[open,setOpen]=useState(false),[loading,setLoading]=useState(false),[prepared,setPrepared]=useState<File|null>(null),[error,setError]=useState(''),[note,setNote]=useState('');
 const alive=useRef(true),inFlight=useRef(false),currentKey=useRef('');
 const key=mediaKey(job,file)+JSON.stringify([job.base,job.hidden]);currentKey.current=key;
 const controller=useRef<AbortController|null>(null),cancelled=useRef(false);
 const ready=useRef<{key:string;file:File}|null>(null);
 function makeFile(blob:Blob){return new File([blob],creationDownloadName(job,file.filename),{type:fileType(file.filename)==='application/octet-stream'?blob.type:fileType(file.filename)});}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
 // Read existing device copies only. A row's Save button never starts a background download.
 const saved=service.saved.has(mediaKey(job,file));
 useEffect(()=>{let gone=false;ready.current=null;setPrepared(null);if(saved)void service.read(job,file).then(blob=>{if(!gone&&blob)ready.current={key,file:makeFile(blob)};}).catch(()=>{});return()=>{gone=true;};},[key,saved,service.changes[job.id]]);
 async function prepare(){
  if(inFlight.current)return;inFlight.current=true;cancelled.current=false;controller.current=new AbortController();setError('');setNote('');setLoading(true);
  const requestKey=key;
  try{
   const cached=ready.current?.key===key?ready.current.file:null;
   // Cached files open the native share sheet in the original tap, without an app menu.
   let output:File,result:Awaited<ReturnType<typeof exportFile>>;
   if(cached){output=cached;result=await exportFile(output);}
   else{setOpen(true);output=makeFile(await service.ensure(job,file,controller.current.signal));if(cancelled.current||!alive.current||currentKey.current!==requestKey)return;ready.current={key,file:output};result=await exportFile(output);}
   if(cancelled.current||!alive.current||currentKey.current!==requestKey)return;
   setPrepared(output);
   if(result==='needs-tap'){setOpen(true);}else{setOpen(false);setNote(result==='downloaded'?'Download started':result==='shared'?'Share sheet closed':'');}
  }catch(e){if(!cancelled.current&&alive.current&&currentKey.current===requestKey){setOpen(true);setError((e as Error).message);}}
  finally{inFlight.current=false;if(alive.current&&currentKey.current===requestKey)setLoading(false);}
 }
 return <><button className={className} disabled={loading} onClick={()=>void prepare()} aria-label="Save creation" title={note||'Save this file'}><Download size={15}/>{loading?'Preparing…':label}</button>{note&&<span className="save-feedback" role="status">{note}</span>}{open&&<SaveFileDialog title="Save file" file={prepared} loading={loading} error={error} onClose={()=>{cancelled.current=true;controller.current?.abort();setOpen(false);}}/>}</>;
}
