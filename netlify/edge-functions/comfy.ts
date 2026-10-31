import {jsonUp,runpodURL,makeWorkflow,videoFiles,upstream} from '../../server/comfy.ts';
export default async function comfy(req: Request) {
  try {
    if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) return Response.json({error:'Cross-site request rejected.'},{status:403});
    if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
      const form = await req.formData(); const base = runpodURL(String(form.get('base') || '')); const file = form.get('image');
      if (!(file instanceof File) || file.size > 15*1024*1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WebP image under 15 MB.');
      const upload = new FormData(); upload.set('image',file,'pocket-'+crypto.randomUUID()+'.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type])); upload.set('type','input');
      return Response.json(await jsonUp(base,'/upload/image',{method:'POST',body:upload}));
    }
    const p: any = await req.json(); const base = runpodURL(String(p.base || ''));
    if (p.action === 'connect') {
      const stats = await jsonUp(base,'/system_stats');
      const types = [...new Set(Object.values(makeWorkflow({prompt:'Connection check',duration:5,seed:1,quality:'draft',aspect:'landscape',mode:p.mode})).map((n: any)=>n.class_type))];
      const checked = await Promise.all(types.map(async type => { const info = await jsonUp(base,'/object_info/'+encodeURIComponent(type)); return {type,info:info[type]}; }));
      const missing = checked.filter(x=>!x.info).map(x=>x.type);
      if (missing.length) throw new Error('This pod is missing workflow nodes: '+missing.join(', ')+'. Open the selected workflow in ComfyUI and install its requirements.');
      const graph = makeWorkflow({prompt:'Connection check',duration:5,seed:1,quality:'draft',aspect:'landscape',mode:p.mode});
      const needed = Object.values(graph).flatMap((node:any) => ['UNETLoader','CLIPLoader','VAELoader'].includes(node.class_type) ? Object.entries(node.inputs).filter(([key])=>['unet_name','clip_name','vae_name'].includes(key)).map(([key,name])=>[node.class_type,key,name]) : []);
      const missingModels = needed.filter(([type,key,name]) => { const info = checked.find(x=>x.type===type)?.info; const options = info?.input?.required?.[key]?.[0]; return Array.isArray(options) && !options.includes(name); }).map(x=>x[2]);
      if(missingModels.length) throw new Error('Missing model files: '+missingModels.join(', '));
      const loraInfo = p.mode === 'image' ? {} : await jsonUp(base,'/object_info/LoraLoaderModelOnly');
      const lora = loraInfo.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || [];
      return Response.json({connected:true,device:stats.devices?.[0]?.name || 'RunPod GPU',turboReady:lora.includes('minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors')});
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
