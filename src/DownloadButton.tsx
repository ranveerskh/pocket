import {useEffect,useRef,useState} from 'react';
import {Download} from 'lucide-react';
import type {Job,MediaFile} from './vault';
import {useDeviceMedia} from './LocalMedia';
import SaveFileDialog from './SaveFileDialog';
export function mediaURL(base:string,file:MediaFile,download=false){return '/api/media?'+new URLSearchParams({base,filename:file.filename,subfolder:file.subfolder||'',type:file.type||'output',download:download?'1':'0'});}
export function fileType(name:string){return /\.mp4$|\.m4v$/i.test(name)?'video/mp4':/\.webm$/i.test(name)?'video/webm':/\.mov$/i.test(name)?'video/quicktime':/\.png$/i.test(name)?'image/png':/\.jpe?g$/i.test(name)?'image/jpeg':/\.webp$/i.test(name)?'image/webp':'application/octet-stream';}
export default function DownloadButton({job,file=job.files![0],className='download',label='Save to phone'}:{job:Job;file?:MediaFile;className?:string;label?:string}){
 const service=useDeviceMedia(),[open,setOpen]=useState(false),[loading,setLoading]=useState(false),[prepared,setPrepared]=useState<File|null>(null),[error,setError]=useState('');const alive=useRef(true);useEffect(()=>()=>{alive.current=false;},[]);
 async function prepare(){setOpen(true);setError('');setLoading(true);try{const blob=await service.ensure(job,file);if(alive.current)setPrepared(new File([blob],file.filename,{type:fileType(file.filename)==='application/octet-stream'?blob.type:fileType(file.filename)}));}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setLoading(false);}}
 return <><button className={className} onClick={prepare} aria-label="Save creation to phone"><Download size={15}/>{label}</button>{open&&<SaveFileDialog file={prepared} loading={loading} error={error} onClose={()=>setOpen(false)}/>}</>;
}
