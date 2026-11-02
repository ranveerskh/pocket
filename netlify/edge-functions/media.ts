import {upstream} from '../../server/comfy.ts';
export default async function media(req: Request) {
  try {
    const q = new URL(req.url).searchParams; const name = q.get('filename') || ''; const folder = q.get('subfolder') || '';
    if(!name || /[\\/]/.test(name) || name.includes('..') || folder.includes('..') || folder.startsWith('/') || folder.includes('\\')) throw new Error('Invalid file.');
    const params = new URLSearchParams({filename:name,subfolder:folder,type:['input','temp'].includes(q.get('type')||'')?q.get('type')!:'output'});
    const headers: Record<string,string> = {}; const range = req.headers.get('range'); if(q.get('check')==='1')headers.Range='bytes=0-0';else if(range) headers.Range=range;
    const r = await upstream(q.get('base') || '', '/view?'+params,{headers});
    if(!r.ok){await r.body?.cancel();throw new Error(r.status===404?'File not found on this pod. Check its ComfyUI output folder.':'Pod did not return the media (HTTP '+r.status+'). Check that ComfyUI is running.');}
    if(q.get('check')==='1'){const type=r.headers.get('content-type')||'';await r.body?.cancel();if(!/^(video|image|audio)\//i.test(type)&&!type.includes('octet-stream'))throw new Error('Pod returned a page instead of media. Check its address and connection.');return Response.json({available:true},{headers:{'Cache-Control':'no-store'}});}
    const h = new Headers({'Cache-Control':'private, no-store','Content-Type':r.headers.get('content-type') || 'video/mp4'});
    for(const key of ['content-length','content-range','accept-ranges']) {const v=r.headers.get(key); if(v) h.set(key,v);}
    if(q.get('download')==='1') h.set('Content-Disposition',`attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g,'_')}"`);
    return new Response(r.body,{status:r.status,headers:h});
  }catch(e){return Response.json({error:e instanceof Error?e.message:'Video unavailable.'},{status:400});}
}

export const config = {path:'/api/media'};
