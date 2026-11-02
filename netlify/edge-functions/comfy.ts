import {jsonUp,runpodURL,makeWorkflow,videoFiles,upstream} from '../../server/comfy.ts';
export default async function comfy(req: Request) {
  try {
    if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) return Response.json({error:'Cross-site request rejected.'},{status:403});
    if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
      const form=await req.formData(),base=runpodURL(String(form.get('base')||''));
      const voice=form.get('kind')==='audio',file=form.get(voice?'audio':'image');
      const imageExt:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
      const audioExt:Record<string,string>={'audio/wav':'wav','audio/x-wav':'wav','audio/wave':'wav','audio/mpeg':'mp3','audio/mp3':'mp3','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/aac':'aac','audio/flac':'flac','audio/x-flac':'flac','audio/ogg':'ogg','audio/webm':'webm'};
      if(!(file instanceof File)||!file.size||file.size>15*1024*1024)throw new Error('Choose a non-empty reference file under 15 MB.');
      const ext=(voice?audioExt:imageExt)[file.type];if(!ext)throw new Error(voice?'Use WAV, MP3, M4A, AAC, FLAC, OGG or WebM audio.':'Use JPG, PNG or WebP images.');
      // ComfyUI stores images AND audio through its generic /upload/image endpoint.
      const upload=new FormData();upload.set('image',file,'pocket-'+crypto.randomUUID()+'.'+ext);upload.set('type','input');
      return Response.json(await jsonUp(base,'/upload/image',{method:'POST',body:upload}));
    }
    const p: any = await req.json(); const base = runpodURL(String(p.base || ''));
    if (p.action === 'connect') {
      const stats = await jsonUp(base,'/system_stats');
      const types = [...new Set(Object.values(makeWorkflow({prompt:'Connection check',duration:5,seed:1,quality:'draft',aspect:'landscape',mode:p.mode,custom:p.custom,preflight:true})).map((n: any)=>n.class_type))];
      if(p.mode==='r2v')for(const type of ['LoadImage','LoadAudio'])if(!types.includes(type))types.push(type);
      if(types.length>100) throw new Error('This connection check supports up to 100 different node types.');
      const checked = await Promise.all(types.map(async type => { const info = await jsonUp(base,'/object_info/'+encodeURIComponent(type)); return {type,info:info[type]}; }));
      const missing = checked.filter(x=>!x.info).map(x=>x.type);
      if (missing.length) throw new Error('This pod is missing workflow nodes: '+missing.join(', ')+'. Open the selected workflow in ComfyUI and install its requirements.');
      const graph = makeWorkflow({prompt:'Connection check',duration:5,seed:1,quality:'draft',aspect:'landscape',mode:p.mode,custom:p.custom,preflight:true});
      const needed = Object.values(graph).flatMap((node:any) => ['UNETLoader','CLIPLoader','VAELoader'].includes(node.class_type) ? Object.entries(node.inputs).filter(([key])=>['unet_name','clip_name','vae_name'].includes(key)).map(([key,name])=>[node.class_type,key,name]) : []);
      const missingModels = needed.filter(([type,key,name]) => { const info = checked.find(x=>x.type===type)?.info; const options = info?.input?.required?.[key]?.[0]; return Array.isArray(options) && !options.includes(name); }).map(x=>x[2]);
      if(missingModels.length) throw new Error('Missing model files: '+missingModels.join(', '));
      const loraInfo = p.custom || p.mode === 'image' ? {} : await jsonUp(base,'/object_info/LoraLoaderModelOnly');
      const lora = loraInfo.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || [];
      return Response.json({connected:true,device:stats.devices?.[0]?.name || 'RunPod GPU',turboReady:lora.includes(p.mode==='r2v'?'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors':'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors')});
    }
    if (p.action === 'bulk' || p.action === 'recover_batch' || p.action === 'statuses') {
      const [history,queue]=await Promise.all([jsonUp(base,'/history?max_items=500'),jsonUp(base,'/queue')]);
      const queued=[...(queue.queue_running||[]),...(queue.queue_pending||[])];
      if(p.action==='statuses') {
        if(!Array.isArray(p.ids)||p.ids.length>100||p.ids.some((id:any)=>typeof id!=='string'||!/^[a-zA-Z0-9-]+$/.test(id))) throw new Error('Invalid job IDs.');
        const statuses:Record<string,any>={};
        for(const id of p.ids){const item=history[id];if(item){const failed=item.status?.status_str==='error';const error=item.status?.messages?.find((m:any)=>m[0]==='execution_error')?.[1];statuses[id]={state:failed?'error':item.status?.completed?'complete':'running',files:videoFiles(item),error:error?.exception_message||null};}else{const running=queue.queue_running?.some((q:any)=>q[1]===id);const idx=queue.queue_pending?.findIndex((q:any)=>q[1]===id)??-1;statuses[id]={state:running?'running':idx>=0?'queued':'unknown',position:idx+1};}}
        return Response.json({statuses});
      }
      if(typeof p.batch_id!=='string'||!/^[a-zA-Z0-9-]+$/.test(p.batch_id))throw new Error('Invalid batch ID.');
      const found=new Map<number,string>();
      for(const q of queued)if(q[3]?.pocket_batch_id===p.batch_id)found.set(Number(q[3].pocket_item_index),q[1]);
      for(const [id,item] of Object.entries(history) as [string,any][])if(item.prompt?.[3]?.pocket_batch_id===p.batch_id)found.set(Number(item.prompt[3].pocket_item_index),id);
      if(p.action==='recover_batch')return Response.json({items:[...found].map(([index,id])=>({index,id}))});
      if(!Array.isArray(p.items)||!p.items.length||p.items.length>5)throw new Error('Submit 1–5 prompts per request.');
      if(p.items.some((x:any)=>!Number.isInteger(x.index)||x.index<0||x.index>=50))throw new Error('Invalid batch item index.');
      const prepared=p.items.map((x:any)=>({index:x.index,graph:makeWorkflow({...p,prompt:x.prompt,seed:x.seed})}));const submitted=[];let partial_error='';
      for(const item of prepared){if(found.has(item.index)){submitted.push({index:item.index,id:found.get(item.index)});continue;}try{const result=await jsonUp(base,'/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:item.graph,client_id:p.batch_id,extra_data:{pocket_batch_id:p.batch_id,pocket_item_index:item.index}})});submitted.push({index:item.index,id:result.prompt_id});}catch(e){partial_error=(e as Error).message;break;}}
      return Response.json({items:submitted,partial_error});
    }
    if (p.action === 'generate') return Response.json(await jsonUp(base,'/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:makeWorkflow(p),client_id:crypto.randomUUID()})}));
    if (p.action === 'status') {
      if (typeof p.id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(p.id)) throw new Error('Invalid job ID.');
      const history = await jsonUp(base,'/history/'+p.id); const item = history[p.id];
      if (item) { const error = item.status?.messages?.find((m:any)=>m[0]==='execution_error')?.[1]; return Response.json({state:item.status?.status_str==='error' ? 'error' : item.status?.completed ? 'complete' : 'running',files:videoFiles(item),error:error?.exception_message || (item.status?.status_str==='error' ? 'Generation failed. Open ComfyUI to inspect this job.' : null)}); }
      const q = await jsonUp(base,'/queue'); const running = q.queue_running?.some((x:any)=>x[1]===p.id); const index = q.queue_pending?.findIndex((x:any)=>x[1]===p.id) ?? -1;
      return Response.json({state:running?'running':index>=0?'queued':'unknown',position:index+1});
    }
    if (p.action === 'cancel') {
      if (typeof p.id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(p.id)) throw new Error('Invalid job ID.');
      const deleted = await upstream(base,'/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delete:[p.id]})});
      if (!deleted.ok) throw new Error('Could not remove this job from the queue.');
      const q = await jsonUp(base,'/queue');
      if(q.queue_running?.some((x:any)=>x[1]===p.id)) { const r = await upstream(base,'/interrupt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt_id:p.id})}); if(!r.ok) throw new Error('Could not stop this job.'); }
      return Response.json({cancelled:true});
    }
    throw new Error('Unknown action.');
  } catch(e) { return Response.json({error:e instanceof Error ? e.message : 'Could not reach RunPod.'},{status:400}); }
}

export const config = {path:'/api/comfy'};
