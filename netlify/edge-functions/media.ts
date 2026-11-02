import {upstream} from '../../server/comfy.ts';
export default async function media(req: Request) {
  try {
    const q = new URL(req.url).searchParams; const name = q.get('filename') || ''; const folder = q.get('subfolder') || '';
    if(!name || /[\\/]/.test(name) || name.includes('..') || folder.includes('..') || folder.startsWith('/') || folder.includes('\\')) throw new Error('Invalid file.');
    const params = new URLSearchParams({filename:name,subfolder:folder,type:q.get('type')==='input'?'input':'output'});
    const headers: Record<string,string> = {}; const range = req.headers.get('range'); if(range) headers.Range=range;
    const r = await upstream(q.get('base') || '', '/view?'+params,{headers});
    if(!r.ok) throw new Error('Video unavailable. Keep this pod running to preview or download.');
    const h = new Headers({'Cache-Control':'private, no-store','Content-Type':r.headers.get('content-type') || 'video/mp4'});
    for(const key of ['content-length','content-range','accept-ranges']) {const v=r.headers.get(key); if(v) h.set(key,v);}
    if(q.get('download')==='1') h.set('Content-Disposition',`attachment; filename="${name.replace(/[^a-zA-Z0-9._-]/g,'_')}"`);
    return new Response(r.body,{status:r.status,headers:h});
  }catch(e){return Response.json({error:e instanceof Error?e.message:'Video unavailable.'},{status:400});}
}

export const config = {path:'/api/media'};
