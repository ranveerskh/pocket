import template from './workflow.ts';
import imageTemplate from './image-workflow.ts';
export function runpodURL(value: string) {
  let u: URL;
  try { u = new URL(value.trim()); } catch { throw new Error('Paste the full HTTPS ComfyUI link from RunPod → Connect.'); }
  if (u.protocol !== 'https:' || !/^[a-z0-9-]+\.proxy\.runpod\.net$/.test(u.hostname) || u.port || u.username || u.password) throw new Error('Use your RunPod HTTPS proxy link, such as https://your-pod-8188.proxy.runpod.net');
  return u.origin;
}
export async function upstream(base: string, path: string, init: RequestInit = {}) {
  const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(),25000);
  try { return await fetch(runpodURL(base) + path, {...init, redirect: 'error', signal:controller.signal}); } finally { clearTimeout(timer); }
}
export async function jsonUp(base: string, path: string, init: RequestInit = {}) {
  const r = await upstream(base, path, init); const raw = await r.text(); let data: any;
  try { data = JSON.parse(raw); } catch { throw new Error('ComfyUI did not return an API response. Check the link and make sure the pod and ComfyUI are running.'); }
  if (!r.ok || data.error) {
    const errors = Object.values(data.node_errors || {}).flatMap((n: any) => (n.errors || []).map((e: any) => [e.message, e.details].filter(Boolean).join(': ')));
    throw new Error(errors.join('\n') || data.error?.message || (typeof data.error === 'string' ? data.error : 'RunPod returned HTTP ' + r.status));
  }
  return data;
}
export function dimensions(quality: string, aspect: string) {
  const sizes: Record<string, number[]> = {draft:[832,480],balanced:[1152,640],high:[1344,768]};
  const s = sizes[quality]; if (!s || !['landscape','portrait','square'].includes(aspect)) throw new Error('Choose a valid size.');
  if (aspect === 'square') { const side = quality === 'draft' ? 640 : quality === 'balanced' ? 864 : 1024; return [side,side]; }
  return aspect === 'portrait' ? [...s].reverse() : s;
}
export function makeWorkflow(p: any) {
  if (typeof p.prompt !== 'string' || !p.prompt.trim() || p.prompt.length > 20000) throw new Error('Write a prompt between 1 and 20,000 characters.');
  if (p.custom) {
    const graph = validateCustomGraph(p.custom.graph);
    const map = p.custom.map || {};
    const put = (target:any,value:any) => { if(!target) return; if(typeof target.node!=='string'||typeof target.input!=='string'||!graph[target.node]||!Object.hasOwn(graph[target.node].inputs,target.input)) throw new Error('Invalid workflow field mapping.'); graph[target.node].inputs[target.input]=value; };
    if(!map.prompt) throw new Error('Map a prompt field before using this workflow.');
    put(map.prompt,p.prompt.trim());
    if(map.seed) { if(!Number.isSafeInteger(p.seed)||p.seed<0) throw new Error('Invalid seed.'); put(map.seed,p.seed); }
    const [width,height]=dimensions(p.quality,p.aspect); put(map.width,width); put(map.height,height);
    if(map.duration) { if(![4,5,6,8,10].includes(Number(p.duration))) throw new Error('Choose a supported duration.'); put(map.duration,Number(p.duration)); }
    if(p.image) { if(!map.image) throw new Error('This workflow has no reference image mapping.'); if(typeof p.image!=='string'||p.image.includes('..')||p.image.startsWith('/')) throw new Error('Invalid reference image.'); put(map.image,p.image); }
    return graph;
  }
  if (p.mode === 'image') {
    if (!Number.isSafeInteger(p.seed) || p.seed < 0) throw new Error('Seed must be a positive whole number.');
    const graph: any = structuredClone(imageTemplate); const [width,height] = dimensions(p.quality,p.aspect);
    graph['57:27'].inputs.text = p.prompt.trim(); graph['57:13'].inputs.width = width; graph['57:13'].inputs.height = height;
    graph['57:3'].inputs.seed = p.seed; graph['9'].inputs.filename_prefix = 'image/PocketStudio';
    return graph;
  }
  if (![4,5,6,8,10].includes(Number(p.duration))) throw new Error('Choose a supported duration.');
  if (!Number.isSafeInteger(p.seed) || p.seed < 0) throw new Error('Seed must be a positive whole number.');
  const graph: any = structuredClone(template); const [width,height] = dimensions(p.quality,p.aspect);
  graph['140:131'].inputs.prompt = p.prompt.trim(); graph['140:131'].inputs.width = width; graph['140:131'].inputs.height = height;
  graph['140:133'].inputs.value = Number(p.duration); graph['140:129'].inputs.noise_seed = p.seed; graph['140:139'].inputs.value = p.turbo === true;
  graph['92'].inputs.filename_prefix = 'video/PocketStudio';
  if (p.image) {
    if (typeof p.image !== 'string' || p.image.length > 300 || p.image.includes('..') || p.image.startsWith('/')) throw new Error('Invalid reference image.');
    graph['pocket:image'] = {class_type:'LoadImage',inputs:{image:p.image}}; graph['140:131'].inputs.first_frame = ['pocket:image',0];
  }
  // Resolve the uploaded workflow's switches and remove unused branches.
  graph['140:126'].inputs.model = [p.turbo === true ? '140:134' : '140:127',0];
  graph['140:124'].inputs.model = [p.turbo === true ? '140:134' : '140:127',0];
  graph['140:124'].inputs.steps = p.turbo === true ? 8 : 20;
  const keep = new Set<string>();
  function visit(id: string) { if(keep.has(id)) return; keep.add(id); for(const v of Object.values(graph[id].inputs)) if(Array.isArray(v) && typeof v[0] === 'string' && graph[v[0]]) visit(v[0]); }
  visit('92'); for(const id of Object.keys(graph)) if(!keep.has(id)) delete graph[id];
  return graph;
}
export function videoFiles(item: any) {
  const results: any[] = [];
  for (const out of Object.values(item?.outputs || {}) as any[]) for (const list of Object.values(out)) if (Array.isArray(list)) for (const f of list) {
    if (f && typeof f.filename === 'string' && /\.(mp4|webm|mov|mkv|png|jpg|jpeg|webp)$/i.test(f.filename)) results.push({filename:f.filename,subfolder:f.subfolder || '',type:f.type || 'output'});
  }
  return results.filter((f,i,a)=>a.findIndex(x=>x.filename===f.filename && x.subfolder===f.subfolder)===i);
}

export function validateCustomGraph(value:any):Record<string,any> {
 if(!value||typeof value!=='object'||Array.isArray(value)||value.nodes) throw new Error('Import ComfyUI Export (API) JSON.');
 const entries=Object.entries(value);if(!entries.length||entries.length>400||JSON.stringify(value).length>2*1024*1024) throw new Error('Workflow must contain 1–400 nodes and be under 2 MB.');
 for(const [id,node] of entries as [string,any][]) { if(!id||!node||typeof node.class_type!=='string'||!node.inputs||typeof node.inputs!=='object'||Array.isArray(node.inputs)) throw new Error('Invalid API workflow node.'); }
 const graph=structuredClone(value);
 for(const node of Object.values(graph) as any[]) for(const input of Object.values(node.inputs)) if(Array.isArray(input)&&input.length===2&&typeof input[0]==='string'&&typeof input[1]==='number'&&!Object.hasOwn(graph,input[0])) throw new Error('Workflow references missing node '+input[0]);
 return graph;
}
