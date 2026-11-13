import {mediaURL as resolveMediaURL, isLocal} from './local-mode';
import {localStorage} from './local-mode';
import {useEffect,useState,useRef} from 'react';
import {useGalleryStore,type Job} from './vault';
import Gallery from './Gallery';
import ProjectWorkspace from './ProjectWorkspace';
import DeviceStorage from './DeviceStorage';
import DeviceSync, {useDeviceSync} from './DeviceSync';
import ThemeSettings, {useTheme} from './ThemeSettings';
import FolderExportSettings, {useFolderExport} from './FolderExportSettings';
import LocalMedia,{DeviceBadge,DeviceLibraryProvider,useDeviceLibrary} from './LocalMedia';
import Timing from './Timing';
import {mergeJobStatus,jobTiming,timeLabel} from './timing';
import {creationLabel} from './gallery-model';
import PasteButton from './PasteButton';
import DownloadButton from './DownloadButton';
import BulkPanel,{type BulkState} from './BulkPanel';
import PrivateAccess from './PrivateAccess';
import CompletionAlerts from './CompletionAlerts';
import CharacterReferences from './CharacterReferences';
import {characterReferences,currentCharacterIds,referencePrompt} from './reference-model';
import {chunks, type BulkFormat} from './bulk-model';
import {applyBatchCancellation, canCancelBulk, type BatchCancellation} from './bulk-cancel';
import {planShot, planShots} from './shot-plan';
import ShotPreview from './ShotPreview';
import {localId} from './gallery-model';
import Templates,{applyTemplates} from './Templates';
import {Clapperboard,Plus,ArrowUpRight,Settings2,Film,Link2,ImagePlus,X,Sparkles,Check,LoaderCircle,AlertCircle,RotateCcw,ChevronRight,Wifi,Zap} from 'lucide-react';

type VideoFile={filename:string;subfolder:string;type:string};

const samples=['A quiet cinematic moment','A character speaks','Product in motion'];
const samplePrompts=["One continuous cinematic shot inside a warm café on a rainy night. An adult woman in a navy coat looks up from her coffee and gives a subtle, hopeful smile to someone off camera. Locked camera, natural expressions, realistic skin and soft window reflections. Audio: quiet café ambience, gentle rain. No music, text or subtitles.","One continuous medium close-up of an adult man seated inside a parked bus at night. He looks toward the front-right entrance with quiet concern, remaining seated throughout. At 0.1 seconds he says softly: ‘I thought you weren't coming back.’ His expression stays serious. Audio: low engine hum and rain outside. No other speakers, no music, no text or subtitles.","A cinematic studio shot of a matte black perfume bottle on a wet stone pedestal. A slow, controlled camera orbit reveals soft reflections, with a narrow beam of warm light behind the bottle. Preserve the bottle's shape throughout. Audio: subtle water droplets. No text, labels or music."];
const newSeed=()=>Math.floor(Math.random()*1000000000000000);
function size(quality:string,aspect:string){const s=quality==='high'?[1344,768]:quality==='balanced'?[1152,640]:[832,480];return aspect==='square'?[quality==='high'?1024:quality==='balanced'?864:640,quality==='high'?1024:quality==='balanced'?864:640]:aspect==='portrait'?[...s].reverse():s;}
function media(base:string,f:VideoFile,download=false){return resolveMediaURL(base,f,download);}
async function api(base:string,action:string,params:any={}) {const r=await fetch('/api/comfy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base,action,...params})});const d:any=await r.json();if(!r.ok||d.error)throw new Error(d.error||'Could not reach RunPod.');return d;}
export default function Studio(){
 const pageRef=useRef<HTMLElement>(null);
 const [refBusy,setRefBusy]=useState(false);const[galleryBusy,setGalleryBusy]=useState(false);
 const [privatePrompt,setPrivatePrompt]=useState(false),[privateOpen,setPrivateOpen]=useState(false);
 const [bulkState,setBulkState]=useState<BulkState>({adding:false,added:0,total:0,error:'',finished:false});const stopBulk=useRef(false);const [recovering,setRecovering]=useState(false);
 const vault=useGalleryStore();const localMedia=useDeviceLibrary(vault);const {jobs,setJobs}=vault;
 const folderExport=useFolderExport(vault,localMedia);
 const deviceSync=useDeviceSync(vault);
 const theme=useTheme();
 const [mediaProject,setMediaProject]=useState('');
 const [projectColumns,setProjectColumns]=useState(()=>{
  try{
   const saved=JSON.parse(localStorage.getItem('pocket-project-columns')||'{}');
   return {
    phone:[1,2,3].includes(saved.phone)?Number(saved.phone):2,
    laptop:[2,3,4].includes(saved.laptop)?Number(saved.laptop):0,
   };
  }catch{return {phone:2,laptop:0};}
 });
 function changeProjectColumns(screen:'phone'|'laptop',value:number){
  const next={...projectColumns,[screen]:value};
  setProjectColumns(next);
  try{localStorage.setItem('pocket-project-columns',JSON.stringify(next));}
  catch{setMessage('This browser could not remember the grid setting.');}
 }
 const [standaloneBulk,setStandaloneBulk]=useState(false);
 const [bulkDraft,setBulkDraft]=useState('');
 const [bulkFormat,setBulkFormat]=useState<BulkFormat>('auto');
 const [cancelling,setCancelling]=useState<string[]>([]);
 const [bulkCancelBusy,setBulkCancelBusy]=useState(false),[bulkCancelMessage,setBulkCancelMessage]=useState('');
 const cancelInFlight=useRef(false),bulkRequest=useRef<Promise<any>|null>(null);

 const [enabledTemplates,setEnabledTemplates]=useState<string[]>([]);const [saveFolder,setSaveFolder]=useState('');
 const [mode,setMode]=useState(isLocal?'image':'video');const isQwen=mode==='qwen',isImage=mode==='image'||isQwen,isR2V=mode==='r2v';const modelName=isQwen?'Qwen Image 2.1':isImage?'Z-Image Turbo':isR2V?'MiniMax H3 R2V':'MiniMax H3 T2V';const workflowId=isR2V?'builtin-r2v':isQwen?'builtin-qwen-image21':undefined;const supportsReference=mode==='video';
 const [tab,setTab]=useState('library');const [base,setBase]=useState(isLocal?'http://127.0.0.1:8188':'');const [draftBase,setDraftBase]=useState(isLocal?'http://127.0.0.1:8188':'');const [connected,setConnected]=useState(false);const [checking,setChecking]=useState(false);const [device,setDevice]=useState('');const [turboReady,setTurboReady]=useState(false);
 const [negativePrompt,setNegativePrompt]=useState(''),[guidance,setGuidance]=useState(1);const [prompt,setPrompt]=useState('');const [duration,setDuration]=useState(5);const [aspect,setAspect]=useState('landscape');const [quality,setQuality]=useState('draft');const [turbo,setTurbo]=useState(false);const [seed,setSeed]=useState('');const [file,setFile]=useState<File|null>(null);const [preview,setPreview]=useState('');
 const [current,setCurrent]=useState<string|null>(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [jobMessage,setJobMessage]=useState('');const [ready,setReady]=useState(false);const [advanced,setAdvanced]=useState(false);const [elapsed,setElapsed]=useState(0);const fileInput=useRef<HTMLInputElement>(null);
 const job=jobs.find(j=>j.id===current&&!j.hidden); const active=job&&['queued','running','unknown'].includes(job.state);const dims=size(quality,aspect);
 useEffect(()=>{try{const p=JSON.parse(localStorage.getItem('pocket-settings')||'{}');if(['video','r2v','image','qwen'].includes(p.mode))setMode(p.mode);if(typeof p.negativePrompt==='string')setNegativePrompt(p.negativePrompt);if(typeof p.guidance==='number'&&p.guidance>=1&&p.guidance<=10)setGuidance(p.guidance);if(p.base){setBase(p.base);setDraftBase(p.base);}if(typeof p.saveFolder==='string')setSaveFolder(p.saveFolder);if(p.workspace===true)setTab('create');if(p.prompt)setPrompt(p.prompt);if(p.duration)setDuration(p.duration);if(p.aspect)setAspect(p.aspect);if(p.quality)setQuality(p.quality);const tp=JSON.parse(localStorage.getItem('pocket-templates')||'[]');if(Array.isArray(tp))setEnabledTemplates(tp);}catch{}setReady(true);},[]);
 useEffect(()=>{if(ready){localStorage.setItem('pocket-settings',JSON.stringify({base,prompt,negativePrompt,guidance,duration,aspect,quality,mode,saveFolder,workspace:tab==='create'||tab==='bulk'}));localStorage.setItem('pocket-templates',JSON.stringify(enabledTemplates));}},[ready,base,prompt,negativePrompt,guidance,duration,aspect,quality,mode,enabledTemplates,saveFolder,tab]);
 useEffect(()=>{if(vault.loaded&&saveFolder&&!vault.folders.some(folder=>folder.id===saveFolder))setSaveFolder('');},[vault.loaded,vault.folders,saveFolder]);
 useEffect(()=>{if(vault.legacyLocked){setCurrent(null);setPrompt('');setFile(null);return;}if(vault.loaded){const currentJob=jobs.find(j=>j.id===current);if(!currentJob||!['queued','running','unknown'].includes(currentJob.state)){const candidates=jobs.filter(j=>['queued','running','unknown'].includes(j.state)).sort((a,b)=>a.created-b.created);const pending=candidates.find(j=>j.state==='running')||candidates[0];if(pending)setCurrent(pending.id);}}},[vault.legacyLocked,vault.loaded,jobs.length,jobs.map(j=>j.state).join('|')]);
 useEffect(()=>{if(!file){setPreview('');return;}const u=URL.createObjectURL(file);setPreview(u);return()=>URL.revokeObjectURL(u);},[file]);
 const activeCharacterIds=currentCharacterIds(vault.characters,vault.characterIds,base);
 function shotOptions(){return {duration,mode,characters:vault.characters,selectedIds:activeCharacterIds,base};}
 const refProfile=mode==='r2v'?'i'+vault.characters.filter(c=>activeCharacterIds.includes(c.id)&&c.image).length+'-a'+vault.characters.filter(c=>activeCharacterIds.includes(c.id)&&c.audio).length:undefined;
 const cancellationPending=jobs.some(j=>j.base===base&&j.cancelRequested);
 const bulkCancelStatus=bulkCancelMessage&&!bulkCancelBusy&&!jobs.some(j=>j.cancelRequested)&&!bulkCancelMessage.startsWith('Could not save')?'Bulk cancellation confirmed. Queued shots stopped.':bulkCancelMessage;
 const pendingKey=jobs.filter(j=>j.cancelRequested||['queued','running','unknown'].includes(j.state)).map(j=>j.id+(j.cancelRequested?'!':'')).join(',');
 useEffect(()=>{
  if(vault.legacyLocked||!pendingKey)return;
  let gone=false;
  let timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   try{
    const pending=jobs.filter(job=>job.cancelRequested||['queued','running','unknown'].includes(job.state));
    for(const url of new Set(pending.map(job=>job.base))){
     const cancelled=pending.filter(job=>job.base===url&&job.cancelRequested&&job.batchId);
     if(cancelled.length&&!cancelInFlight.current){
      for(const batchIds of chunks([...new Set(cancelled.map(job=>job.batchId!))],100)){
       const result:BatchCancellation=await api(url,'cancel_batches',{batch_ids:batchIds});
       if(gone)return;
       setJobs(previous=>previous.map(job=>applyBatchCancellation(job,url,result)));
      }
     }
     const ids=pending.filter(job=>job.base===url&&!job.cancelRequested).map(job=>job.id);
     for(const group of chunks(ids,100)){
      const data=await api(url,'statuses',{ids:group});
      if(gone)return;
      setJobs(previous=>previous.map(job=>{
       const status=job.base===url?data.statuses[job.id]:undefined;
       return status&&!job.cancelRequested&&['queued','running','unknown'].includes(job.state)?mergeJobStatus(job,status):job;
      }));
      const status=current?data.statuses[current]:undefined;
      if(status)setJobMessage(status.state==='queued'?'Waiting in queue · position '+status.position:status.state==='running'?'Generating on your RunPod GPU':status.state==='unknown'?'Job not found. Check this pod’s queue.':'');
     }
    }
   }catch(error){if(!gone)setJobMessage('Connection interrupted. Cancellation requests will retry when RunPod is reachable. '+(error as Error).message);}
   if(!gone)timer=setTimeout(poll,5000);
  };
  void poll();
  return()=>{gone=true;clearTimeout(timer);};
 },[pendingKey,vault.legacyLocked,current]);
 useEffect(()=>{function leave(){if(document.hidden){setPrivateOpen(false);setPrivatePrompt(false);setTab(t=>t==='private'?'library':t);}}document.addEventListener('visibilitychange',leave);return()=>document.removeEventListener('visibilitychange',leave);},[]);

 useEffect(()=>{if(!active||!job)return;const update=()=>setElapsed(Math.floor((Date.now()-(job.state==='running'&&job.startedAt?job.startedAt:job.created))/1000));update();const t=setInterval(update,1000);return()=>clearInterval(t);},[active,job?.id,job?.state,job?.created,job?.startedAt]);
 async function connectModel(url:string,selectedMode:string){setChecking(true);setMessage('');setConnected(false);try{const origin=new URL(url.trim()).origin;const d=await api(origin,'connect',{mode:selectedMode});setBase(origin);setDraftBase(origin);setConnected(true);setDevice(d.device);setTurboReady(d.turboReady);if(!d.turboReady)setTurbo(false);}catch(e){setMessage((e as Error).message);}finally{setChecking(false);}}
 async function connect(){await connectModel(draftBase,mode);}
 function switchMode(next:string){if(next===mode)return;setMode(next);setAspect((next==='image'||next==='qwen')?'square':'landscape');setQuality((next==='image'||next==='qwen')?'high':'draft');setConnected(false);setFile(null);setCurrent(null);setMessage('');if(base)void connectModel(base,next);}
 async function useAsReference(j:Job){if(!j.files?.length)return;setBusy(true);setMessage('');try{const blob=await localMedia.ensure(j,j.files[0]);if(blob.size>15*1024*1024)throw new Error('Reference image must be under 15 MB.');setMode('video');setCurrent(null);setPrompt('');setFile(new File([blob],j.files[0].filename,{type:blob.type}));setTab('create');if(base)await connectModel(base,'video');}catch(e){setMessage((e as Error).message);setTab('create');}finally{setBusy(false);}}
 async function generate(){setMessage('');if(cancelInFlight.current||cancellationPending){setMessage('Finish cancelling the previous batch on this RunPod before submitting new prompts.');return;}if(vault.legacyLocked){setTab('library');return;}if(!vault.loaded){setMessage('Gallery is loading. Please wait.');return;}if(!connected){setTab('settings');setMessage('Connect your RunPod first.');return;}if(!prompt.trim()){setMessage('Write a prompt first.');return;}setBusy(true);try{const shot=planShot(prompt,shotOptions());const references=shot.references;let image='';if(file&&mode!=='r2v'){const form=new FormData();form.append('base',base);form.append('image',file);const r=await fetch('/api/comfy',{method:'POST',body:form});const d:any=await r.json();if(!r.ok||d.error)throw new Error(d.error||'Image upload failed.');image=(d.subfolder?d.subfolder+'/':'')+d.name;}
 const usedSeed=seed.trim()?Number(seed):newSeed();const effectivePrompt=referencePrompt(applyTemplates(shot.prompt,enabledTemplates,isImage?'image':'video'),references);const d=await api(base,'generate',{prompt:effectivePrompt,negativePrompt:isQwen?negativePrompt:undefined,guidance:isQwen?guidance:undefined,duration:shot.duration,aspect,quality,turbo,seed:usedSeed,image,mode,references});const j:Job={device:device||base,turbo:!isImage&&turbo,referenceUsed:isR2V?!!(references.images.length||references.audios.length):!!image,referenceProfile:isR2V?'i'+references.images.length+'-a'+references.audios.length:undefined,referenceCharacterIds:isR2V?shot.characterIds:undefined,durationMapped:true,mode:isImage?'image':'video',workflowId,workflowName:modelName,basePrompt:prompt,negativePrompt:isQwen?negativePrompt:undefined,guidance:isQwen?guidance:undefined,templates:enabledTemplates,folder:vault.folders.some(f=>f.id===saveFolder)?saveFolder:undefined,seedMapped:true,id:d.prompt_id,base,prompt:effectivePrompt,created:Date.now(),state:'queued',duration:shot.duration,aspect,quality,seed:usedSeed};setJobs(prev=>[j,...prev]);setCurrent(j.id);setJobMessage('Submitted to ComfyUI');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 async function enqueueBulk(prompts:string[]){
 setMessage('');if(!connected||vault.legacyLocked||!vault.loaded){setTab(vault.legacyLocked?'library':'settings');return;}if(bulkState.adding||cancelInFlight.current||cancellationPending)return;stopBulk.current=false;setCurrent(null);const batchId=localId();setBulkState({adding:true,added:0,total:prompts.length,error:'',finished:false});let added=0;
 try{const shots=planShots(prompts,shotOptions());let image='';if(file&&mode!=='r2v'){const form=new FormData();form.append('base',base);form.append('image',file);const r=await fetch('/api/comfy',{method:'POST',body:form});const d:any=await r.json();if(!r.ok||d.error)throw new Error(d.error||'Image upload failed.');image=(d.subfolder?d.subfolder+'/':'')+d.name;}
 const plans=shots.map((shot,index)=>({...shot,index,prompt:referencePrompt(applyTemplates(shot.prompt,enabledTemplates,isImage?'image':'video'),shot.references),basePrompt:prompts[index],seed:seed.trim()?Number(seed):newSeed()}));
 const placeholders:Job[]=plans.map(p=>({id:'pending-'+batchId+'-'+p.index,batchId,batchIndex:p.index,base,mode:isImage?'image':'video',workflowId,workflowName:modelName,basePrompt:p.basePrompt,negativePrompt:isQwen?negativePrompt:undefined,guidance:isQwen?guidance:undefined,prompt:p.prompt,templates:enabledTemplates,folder:saveFolder||undefined,created:Date.now(),state:'staging',duration:p.duration,aspect,quality,seed:p.seed,seedMapped:true,durationMapped:true,device:device||base,turbo:!isImage&&turbo,referenceUsed:isR2V?!!(p.references.images.length||p.references.audios.length):!!image,referenceProfile:isR2V?'i'+p.references.images.length+'-a'+p.references.audios.length:undefined,referenceCharacterIds:isR2V?p.characterIds:undefined}));
 setJobs(prev=>[...placeholders,...prev]);
 for(const group of chunks(plans,5)){if(stopBulk.current)break;setJobs(prev=>prev.map(job=>job.batchId===batchId&&group.some(item=>item.index===job.batchIndex)?{...job,state:'submitting'}:job));
 let d:any;try{bulkRequest.current=api(base,'bulk',{batch_id:batchId,items:group.map(p=>({index:p.index,prompt:p.prompt,seed:p.seed,duration:p.duration,references:p.references})),negativePrompt:isQwen?negativePrompt:undefined,guidance:isQwen?guidance:undefined,mode,duration,aspect,quality,turbo,image});d=await bulkRequest.current;}catch(e){setJobs(prev=>prev.map(j=>j.batchId===batchId&&group.some(p=>p.index===j.batchIndex)?{...j,state:'submission_unknown'}:j));throw new Error('Connection interrupted while adding prompts. Use Recover queue status before trying again. '+(e as Error).message);}
 setJobs(prev=>prev.map(j=>{if(j.batchId!==batchId||!group.some(p=>p.index===j.batchIndex))return j;const result=d.items.find((x:any)=>x.index===j.batchIndex);return result?{...j,id:result.id,state:'queued'}:{...j,state:'submission_unknown'};}));if(d.items[0])setCurrent(old=>old||d.items[0].id);added+=d.items.length;setBulkState({adding:true,added,total:prompts.length,error:'',finished:false});if(d.partial_error)throw new Error(d.partial_error);}
 setBulkState({adding:false,added,total:prompts.length,error:added<prompts.length?'Stopped adding remaining prompts.':'',finished:added===prompts.length});
 }catch(e){setBulkState({adding:false,added,total:prompts.length,error:(e as Error).message,finished:false});}finally{bulkRequest.current=null;setJobs(prev=>prev.map(j=>j.batchId===batchId&&j.state==='staging'?{...j,state:'cancelled',cancelRequested:undefined}:j));}}
 async function recoverBulk(){setRecovering(true);try{const pending=jobs.filter(j=>j.batchId&&!j.cancelRequested&&['submitting','submission_unknown'].includes(j.state));const batches=[...new Set(pending.map(j=>j.base+'|'+j.batchId))];for(const key of batches){const [url,batchId]=key.split('|');const d=await api(url,'recover_batch',{batch_id:batchId});setJobs(prev=>prev.map(j=>{if(j.batchId!==batchId||j.base!==url||j.cancelRequested||!['submitting','submission_unknown'].includes(j.state))return j;const found=d.items.find((x:any)=>x.index===j.batchIndex);return found?{...j,id:found.id,state:'queued'}:j;}));}setBulkState(prev=>({...prev,error:'Queue status recovered where available. Unconfirmed items were not automatically resubmitted.'}));}catch(e){setBulkState(prev=>({...prev,error:(e as Error).message}));}finally{setRecovering(false);}}
 async function cancelBulk(batchId?:string){
  if(cancelInFlight.current||vault.legacyLocked||!vault.loaded)return;
  const targets=jobs.filter(job=>!job.hidden&&(job.folder||'')===saveFolder&&canCancelBulk(job)&&(!batchId||job.batchId===batchId));
  if(!targets.length)return;
  const groups=new Map<string,string[]>();
  for(const job of targets)groups.set(job.base,[...new Set([...(groups.get(job.base)||[]),job.batchId!])]);
  stopBulk.current=true;
  cancelInFlight.current=true;
  setBulkCancelBusy(true);
  setBulkCancelMessage('Cancelling queued and running shots…');
  try{
   // Persist intent before contacting a pod so an offline cancellation survives reload.
   vault.saveProjectChanges({jobs:jobs.map(job=>groups.get(job.base)?.includes(job.batchId||'')&&canCancelBulk(job)?{...job,cancelRequested:true,error:'Cancellation pending. Connect the original RunPod to finish stopping this batch.'}:job),folders:vault.folders,characters:vault.characters,characterIds:vault.characterIds});
   // A request already being submitted must finish before its batch is removed.
   await bulkRequest.current?.catch(()=>{});
   setBulkState(previous=>({...previous,finished:false}));
   let failed=false;
   let stopping=false;
   for(const [url,batchIds] of groups){
    try{
     for(const group of chunks(batchIds,100)){
      const result:BatchCancellation=await api(url,'cancel_batches',{batch_ids:group});
      setJobs(previous=>previous.map(job=>applyBatchCancellation(job,url,result)));
      stopping ||= result.items.some(item=>item.state==='running'||item.state==='queued');
     }
    }catch{failed=true;}
   }
   setBulkCancelMessage(failed?'Cancel pending. Keep the app open and connect the original RunPod; cancellation will retry automatically.':stopping?'Queue cleared. Waiting for RunPod to finish stopping the running shot.':'Bulk cancellation confirmed. Queued shots stopped.');
  }catch(error){setBulkCancelMessage('Could not save cancellation. '+(error as Error).message);}
  finally{cancelInFlight.current=false;setBulkCancelBusy(false);}
 }
 async function cancel(target:Job){
  if(cancelling.includes(target.id))return;
  setCancelling(ids=>[...ids,target.id]);
  try{
   await api(target.base,'cancel',{id:target.id});
   setJobs(prev=>prev.map(j=>j.id===target.id&&j.base===target.base&&['queued','running','unknown'].includes(j.state)?{...j,state:'cancelled'}:j));
  }catch(e){setJobMessage('Could not stop this generation. '+(e as Error).message);}
  finally{setCancelling(ids=>ids.filter(id=>id!==target.id));}
 }
 function selectFile(f?:File){if(!f)return;if(!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>15*1024*1024){setMessage('Choose a JPG, PNG or WebP under 15 MB. On iPhone, export HEIC photos as JPG first.');return;}setFile(f);setMessage('');}
 function reuse(j:Job){const next=j.workflowId==='builtin-qwen-image21'?'qwen':j.workflowId==='builtin-r2v'?'r2v':j.mode==='image'?'image':'video';if(next!==mode)switchMode(next);setPrompt(j.basePrompt||j.prompt);setNegativePrompt(j.negativePrompt||'');setGuidance(j.guidance??(j.negativePrompt?3:1));setEnabledTemplates(j.templates||[]);setDuration(j.duration);setQuality(j.quality);setAspect(j.aspect);setSeed(String(j.seed));if(j.workflowId==='builtin-r2v')vault.setCharacterIds(j.referenceCharacterIds||[]);setTurbo(!!j.turbo);setSaveFolder(j.folder||'');setFile(null);setTab('create');setCurrent(j.id);}
 const standalone=tab==='standalone';
 const isBulk=tab==='bulk'||standalone&&standaloneBulk;
 const isCreation=tab==='create'||tab==='bulk';
 const recentJob=job&&(job.folder||'')===saveFolder?job:
  jobs.find(item=>!item.hidden&&(item.folder||'')===saveFolder);
 useEffect(()=>{if(!isLocal)pageRef.current?.scrollTo(0,0);else window.scrollTo(0,0);},[tab]);
 const lockedForSubmit=busy||refBusy||checking||bulkState.adding||bulkCancelBusy;
 function openProject(project?:string){setSaveFolder(project||'');setMessage('');setTab('create');}
 function openCreate(project?:string){setSaveFolder(project||'');setMessage('');setTab('standalone');}
 const nav=[
  {id:'library',label:'Projects',icon:Film},
  {id:'create',label:'Workspace',icon:Clapperboard},
  {id:'standalone',label:'Create',icon:Plus},
  {id:'settings',label:'Settings',icon:Settings2},
 ];
 const composer=<>
 <details className="workspace-settings"><summary>{modelName} · {isImage?'Image':duration+'s default'} · {quality}</summary><div className="mode-switch" aria-label="Generation type"><button disabled={checking||busy||refBusy||!!active||bulkState.adding} className={mode==='video'?'active':''} onClick={()=>switchMode('video')}><Film size={16}/><span>Video<small>MiniMax H3</small></span>{mode==='video'&&<Check size={14}/>}</button><button disabled={checking||busy||refBusy||!!active||bulkState.adding} className={isR2V?'active':''} onClick={()=>switchMode('r2v')}><Film size={16}/><span>Reference<small>Photos + voices</small></span>{isR2V&&<Check size={14}/>}</button><button disabled={checking||busy||refBusy||!!active||bulkState.adding} className={mode==='image'?'active':''} onClick={()=>switchMode('image')}><ImagePlus size={16}/><span>Image<small>Z-Image Turbo</small></span>{mode==='image'&&<Check size={14}/>}</button><button disabled={checking||busy||refBusy||!!active||bulkState.adding} className={isQwen?'active':''} onClick={()=>switchMode('qwen')}><ImagePlus size={16}/><span>Qwen Image<small>2.1 · negative prompt</small></span>{isQwen&&<Check size={14}/>}</button></div><div className="workflow-current-label">{isBulk?'Bulk generation':'Single generation'} · {modelName}</div></details>
 {!connected&&<button className="connect-banner" onClick={()=>setTab('settings')}><span className="banner-icon"><Wifi size={19}/></span><span><strong>Connect your RunPod.</strong><small>Check your connection before creating.</small></span><ArrowUpRight size={20}/></button>}
 {isR2V&&<details className="workspace-settings"><summary>{activeCharacterIds.length?activeCharacterIds.map((id,index)=>'Picture '+(index+1)+' · '+(vault.characters.find(c=>c.id===id)?.name||'Reference')).join(' / '):'Character references'}</summary><CharacterReferences characters={vault.characters} selected={vault.characterIds} base={base} connected={connected} disabled={busy||checking||bulkState.adding} locked={vault.legacyLocked||!vault.loaded} onSelected={vault.setCharacterIds} onSave={c=>vault.setCharacters(prev=>[...prev,c])} onRemove={id=>{vault.setCharacters(prev=>prev.filter(c=>c.id!==id));vault.setCharacterIds(prev=>prev.filter(x=>x!==id));}} onBusy={setRefBusy}/></details>}
<section className="panel editor">{!isBulk&&<><label className="field-label" htmlFor="prompt">Your prompt <span>{isImage?'Describe the subject, light & style.':'Include dialogue & sound, if you like.'}</span></label><textarea id="prompt" maxLength={20000} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={isImage?'A cinematic portrait beside a rainy café window. Warm light, natural skin texture, soft reflections…':'A rain-soaked city at midnight. A stranger steps off the last bus… Describe the scene, camera, movement and sound.'}/><div className="prompt-footer"><span>{prompt.length.toLocaleString()} / 20,000</span><div className="prompt-tools"><PasteButton onPaste={setPrompt} disabled={bulkState.adding}/><button className="text-button" onClick={()=>setPrompt('')} disabled={!prompt}>Clear</button></div></div><ShotPreview prompts={prompt.trim()?[prompt]:[]} options={shotOptions()}/><div className="ideas">{(isImage?['Cinematic portrait','Rainy city','Product photography']:samples).map((s,i)=><button key={s} onClick={()=>setPrompt(isImage?['Cinematic close-up portrait of an adult woman with wavy brown hair beside a rainy café window. Navy wool coat, thoughtful expression, natural skin texture, warm light, shallow depth of field, realistic photography. No text or logos.','A quiet Canadian city street at midnight after rain. Empty sidewalks, warm café lights reflected on wet pavement, a bus stop in the distance, cinematic wide shot, realistic photography. No text or logos.','Studio product photograph of a matte black perfume bottle on dark wet stone, narrow warm backlight, subtle water droplets, precise reflections and deep shadows. Premium editorial photography, no label, no text.'][i]:samplePrompts[i])}><Sparkles size={11}/>{s}</button>)}</div></>}
 <div hidden={!isBulk}><BulkPanel onCancel={cancelBulk} cancelling={bulkCancelBusy} cancelMessage={bulkCancelStatus} alwaysOpen showQueue={standalone} text={bulkDraft} onText={setBulkDraft} format={bulkFormat} onFormat={setBulkFormat} jobs={jobs.filter(j=>!j.hidden&&(j.folder||'')===saveFolder)} onStart={enqueueBulk} onStop={()=>{stopBulk.current=true;}} state={bulkState} disabled={busy||refBusy||checking||bulkCancelBusy||cancellationPending||!connected||vault.legacyLocked||!vault.loaded} recovering={recovering} onRecover={recoverBulk} shotOptions={shotOptions()} hasUncertain={jobs.some(j=>['submitting','submission_unknown'].includes(j.state))}/></div>
 {supportsReference&&<><input type="file" accept="image/jpeg,image/png,image/webp" ref={fileInput} hidden onChange={e=>selectFile(e.target.files?.[0])}/>{preview?<div className="reference-loaded"><img src={preview} alt="Reference first frame"/><div><strong>{file?.name}</strong><small>Reference first frame</small></div><button className="icon-button" aria-label="Remove reference image" onClick={()=>{setFile(null);if(fileInput.current)fileInput.current.value='';}}><X size={18}/></button></div>:<button className="reference" onClick={()=>fileInput.current?.click()}><ImagePlus size={22}/><span><strong>Add a reference image</strong><small>Optional first frame · JPG, PNG, WebP</small></span><Plus size={18}/></button>}</>}
 {isQwen&&<section className="negative-prompt-section"><label className="field-label" htmlFor="negative-prompt">Negative prompt <span>{isBulk?'Applies to every image in this batch.':'Optional · what to avoid.'}</span></label><textarea id="negative-prompt" maxLength={10000} value={negativePrompt} onChange={e=>{setNegativePrompt(e.target.value);if(e.target.value.trim()&&guidance===1)setGuidance(3);}} placeholder="Blurry, distorted hands, text, watermark…"/><p className="negative-prompt-help">Adding a negative prompt sets guidance above 1 so it can affect the image.</p></section>}
 <details className="workspace-settings"><summary>Render settings</summary><Templates kind={isImage?'image':'video'} enabled={enabledTemplates} onChange={setEnabledTemplates}/><div className="section-line"/>{!isImage&&<><div className="setting-row"><label className="field-label" htmlFor="duration">Default duration</label><span className="muted">seconds</span></div><div className="segments duration" id="duration">{[4,5,6,8,10].map(n=><button aria-pressed={duration===n} className={duration===n?'chosen':''} key={n} onClick={()=>setDuration(n)}>{n}s</button>)}</div></>}
 {<div className="two-cols"><div><label className="field-label" htmlFor="aspect">Frame</label><select id="aspect" value={aspect} onChange={e=>setAspect(e.target.value)}><option value="landscape">Landscape · 16:9</option><option value="portrait">Portrait · 9:16</option><option value="square">Square · 1:1</option></select></div><div><label className="field-label" htmlFor="quality">Size</label><select id="quality" value={quality} onChange={e=>setQuality(e.target.value)}><option value="draft">Draft · smaller</option><option value="balanced">Balanced</option><option value="high">High · larger</option></select></div></div>}<div className="size-note">{dims[0]} × {dims[1]} px · {isQwen?'25 steps':isImage?'8 steps':'24 fps'} <span>{isImage?'One image per prompt.':'Duration rounds to the model’s frame blocks.'}</span></div>

 <button className="advanced-toggle" onClick={()=>setAdvanced(!advanced)} aria-expanded={advanced}><Settings2 size={15}/>Advanced settings<ChevronRight size={15} className={advanced?'rotated':''}/></button>{advanced&&<div className="advanced"><label className="field-label" htmlFor="seed">Seed <span>Empty = random each time</span></label><div className="seed-row"><input id="seed" inputMode="numeric" value={seed} onChange={e=>setSeed(e.target.value.replace(/[^0-9]/g,''))} placeholder="Random"/><button className="icon-button" aria-label="Randomize seed" onClick={()=>setSeed(String(newSeed()))}><RotateCcw size={17}/></button></div>{isQwen&&<label className="field-label qwen-guidance" htmlFor="qwen-guidance">Qwen guidance (CFG)<input id="qwen-guidance" type="number" min={1} max={10} step={0.1} value={guidance} onChange={e=>setGuidance(Number(e.target.value))}/><span>Use a value above 1 with a negative prompt.</span></label>}{!isImage&&<label className="check-row"><input type="checkbox" checked={turbo} onChange={e=>setTurbo(e.target.checked)} disabled={!turboReady}/><span><strong>Turbo · {isR2V?'4':'8'}-step LoRA</strong><small>{turboReady?'Fewer sampling steps. Results may differ.':'Connect to check if the Turbo LoRA is installed.'}</small></span><Zap size={17}/></label>}</div>}
 </details>{message&&<div className="error" role="alert"><AlertCircle size={17}/><span>{message}</span></div>}<button hidden={isBulk} className="generate" onClick={generate} disabled={busy||refBusy||checking||bulkCancelBusy||cancellationPending||!!active||!vault.loaded||bulkState.adding}>{busy?<LoaderCircle className="spin" size={19}/>:<Sparkles size={19}/>} {busy?(file?'Uploading & submitting…':'Submitting…'):active?'Generation in progress':isImage?'Generate image':'Generate video'}<ArrowUpRight size={19}/></button><p className="cost-note">{vault.legacyLocked?'Gallery is locked. Unlock it before creating. ' : ''}Uses your RunPod GPU. No generation starts until you tap.</p></section>
 <details className="workspace-settings"><summary>Generation timing</summary> <Timing jobs={jobs} current={job} elapsed={elapsed} candidate={{id:'timing-current',guidance:isQwen?guidance:undefined,mode:isImage?'image':'video',workflowId,base,prompt,created:Date.now(),state:'draft',duration,seed:0,quality,aspect,device:device||base,turbo:!isImage&&turbo,referenceUsed:isR2V?activeCharacterIds.length>0:!!file,referenceProfile:refProfile,durationMapped:true}}/></details>
 </>;
 return <DeviceLibraryProvider value={localMedia}><div className={'shell'+(!isLocal?' studio-runpod-shell':'')+(isCreation?' studio-workspace-shell':'')}><header className="topbar"><a href={isLocal?"/local":"/"} className="brand"><span className="brand-icon"><Clapperboard size={21}/></span><span>pocket<span className="brand-light"> studio</span><small>VERSION 10.3.2 · STUDIO</small></span></a><button disabled={galleryBusy||lockedForSubmit} className={'status '+(connected?'online':'')} onClick={()=>setTab('settings')}><span className="dot"/>{checking?'Checking…':connected?(isLocal?'Laptop connected':'RunPod connected'):(isLocal?'Connect laptop':'Connect RunPod')}<ChevronRight size={14}/></button></header>
 <nav className="navigation" aria-label="Studio">{nav.map(n=><button key={n.id} disabled={lockedForSubmit||galleryBusy} className={(tab===n.id||n.id==='create'&&isCreation)?'selected':''} onClick={()=>{setPrivateOpen(false);if(n.id==='library')setMediaProject('');setTab(n.id);setMessage('');}}><n.icon size={18}/>{n.label}</button>)}</nav>
 <main ref={pageRef}>{isCreation&&<ProjectWorkspace
   jobs={jobs}
   folders={vault.folders}
   folder={saveFolder}
   bulk={isBulk}
   busy={lockedForSubmit}
   onFolder={setSaveFolder}
   onMode={bulk=>setTab(bulk?'bulk':'create')}
   onProjects={()=>{setMediaProject('');setTab('library');}}
   onManage={()=>{setMediaProject(saveFolder||'unfiled');setTab('library');}}
   onReuse={reuse}
   onCancel={cancel}
   onCancelBulk={cancelBulk}
   bulkCancelBusy={bulkCancelBusy}
   bulkCancelMessage={bulkCancelStatus}
   cancelling={cancelling}
   onReference={useAsReference}
   onRecover={recoverBulk}
   recovering={recovering}
   connectionNote={jobMessage.startsWith('Connection interrupted')||jobMessage.startsWith('Could not')?jobMessage:undefined}
   composer={composer}/> }
 {standalone&&<section className="standalone-create" aria-label="Create">
  <header className="standalone-create-header">
   <h1>Create</h1>
   <label className="workspace-project-select">
    <span>Project</span>
    <select aria-label="Save to project" value={saveFolder} disabled={lockedForSubmit} onChange={e=>setSaveFolder(e.target.value)}>
     <option value="">Unfiled</option>
     {vault.folders.map(folder=><option key={folder.id} value={folder.id}>{folder.name}</option>)}
    </select>
   </label>
   <div className="composer-modes">
    <button aria-pressed={!standaloneBulk} disabled={lockedForSubmit} onClick={()=>setStandaloneBulk(false)}>Single</button>
    <button aria-pressed={standaloneBulk} disabled={lockedForSubmit} onClick={()=>setStandaloneBulk(true)}>Bulk</button>
   </div>
  </header>
  <div className="standalone-create-columns">
   <div>{composer}</div>
   <section className="panel standalone-result" aria-label="Latest result">
    <h2>Latest result</h2>
    {recentJob?.files?.length?<>
     <LocalMedia job={recentJob} preview alt={creationLabel(recentJob)}/>
     <div className="workspace-preview-actions"><DeviceBadge job={recentJob}/><DownloadButton job={recentJob} label="Save file"/></div>
    </>:<p role="status">{recentJob?creationLabel(recentJob)+' · '+recentJob.state:'Your new creation will appear here.'}</p>}
    {recentJob?.error&&<p className="error">{recentJob.error}</p>}
    {recentJob&&['queued','running'].includes(recentJob.state)&&<button className="button secondary" disabled={cancelling.includes(recentJob.id)} onClick={()=>void cancel(recentJob)}>Stop generation</button>}
    <button className="text-button" disabled={lockedForSubmit} onClick={()=>openProject(saveFolder)}>Open project workspace<ArrowUpRight size={15}/></button>
   </section>
  </div>
 </section>}
 {tab==='settings'&&<section className="settings-page">
  <h1>Settings</h1>
  <section className="panel settings-connection" aria-label="RunPod connection">
   <h2><Link2 size={20}/> {isLocal?'Local ComfyUI connection':'RunPod connection'}</h2>
   {isLocal&&<p>Run ComfyUI on this laptop with the Pocket Studio website allowed by CORS. This page connects only to this laptop.</p>}<label className="field-label" htmlFor="base">ComfyUI URL</label>
   <input id="base" type="url" value={draftBase} autoCapitalize="none" autoCorrect="off" spellCheck={false}
    onChange={e=>{setDraftBase(e.target.value);setConnected(false);}} placeholder={isLocal?"http://127.0.0.1:8188":"https://your-pod-8188.proxy.runpod.net"}/>
   {message&&<p className="error" role="alert">{message}</p>}
   <button className="button primary" onClick={connect} disabled={checking||!draftBase.trim()}>
    <Link2 size={16}/>{checking?'Checking pod & models…':'Save & test connection'}
   </button>
   {connected&&<p className="settings-connected" role="status"><Check size={16}/> Connected · {device}</p>}
  </section>
  <ThemeSettings service={theme}/>
  <section className="panel settings-connection project-grid-settings" aria-label="Projects grid">
   <h2>Projects grid</h2>
   <div className="two-cols">
    <label className="field-label">Phone columns
     <select value={projectColumns.phone} onChange={e=>changeProjectColumns('phone',Number(e.target.value))}>
      <option value={1}>1 column</option><option value={2}>2 columns</option><option value={3}>3 columns</option>
     </select>
    </label>
    <label className="field-label">Laptop columns
     <select value={projectColumns.laptop} onChange={e=>changeProjectColumns('laptop',Number(e.target.value))}>
      <option value={0}>Automatic</option><option value={2}>2 columns</option><option value={3}>3 columns</option><option value={4}>4 columns</option>
     </select>
    </label>
   </div>
  </section>
  <h2 className="settings-section-title">Storage</h2>
  <DeviceStorage vault={vault}/>
  <FolderExportSettings service={folderExport}/>
  {!isLocal&&<DeviceSync service={deviceSync}/>}
 </section>}
 {(tab==='library'||tab==='private'&&privateOpen)&&<Gallery projectColumns={projectColumns} onBusy={setGalleryBusy} currentBase={base} key={tab+'-'+mediaProject} initialFolder={mediaProject||undefined} privateView={tab==='private'&&privateOpen} onClosePrivate={()=>{setPrivateOpen(false);setTab('library');void vault.lock().catch(e=>setMessage(e.message));}} vault={vault} busy={busy||!!active} onReuse={reuse} onReference={useAsReference} onCreate={openCreate} onOpenProject={mediaProject?undefined:openProject}/>}

 <CompletionAlerts showPreferences={tab==='settings'} jobs={jobs} loaded={vault.loaded} locked={vault.legacyLocked} onOpen={()=>{setPrivateOpen(false);setTab('library');}}/><footer className="footer"><button className="footer-brand" disabled={refBusy||galleryBusy} onClick={()=>setPrivatePrompt(true)}>POCKET STUDIO · VERSION 10.3.2</button></footer></main>{privatePrompt&&<PrivateAccess vault={vault} onClose={()=>setPrivatePrompt(false)} onOpen={()=>{setPrivatePrompt(false);setPrivateOpen(true);setTab('private');}}/>}</div></DeviceLibraryProvider>;
}
