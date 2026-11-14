import {createServer} from 'vite';
import assert from 'node:assert/strict';
const vite=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {default:api}=await vite.ssrLoadModule('/src/local-api.ts');
 const template=(await vite.ssrLoadModule('/src/local-qwen-turbo-workflow.json')).default;
 const {makeWorkflow}=await vite.ssrLoadModule('/server/comfy.ts');
 let submitted=[],missingNode='',missingModel=false;
 globalThis.fetch=async(url,init={})=>{
  const path=new URL(url).pathname;
  if(path==='/system_stats')return Response.json({devices:[{name:'RTX 4050'}]});
  if(path.startsWith('/object_info/')){
   const type=decodeURIComponent(path.split('/').pop());if(type===missingNode)return Response.json({});
   const required={};for(const node of Object.values(template))if(node.class_type===type)for(const [key,value] of Object.entries(node.inputs))if(['unet_name','clip_name','vae_name'].includes(key))required[key]=[[missingModel&&key==='unet_name'?'other.safetensors':value]];
   return Response.json({[type]:{input:{required}}});
  }
  if(path==='/history')return Response.json({});if(path==='/queue')return Response.json({queue_pending:[],queue_running:[]});
  if(path==='/prompt'){const body=JSON.parse(init.body);submitted.push(body.prompt);return Response.json({prompt_id:'shot-'+submitted.length});}
  throw Error('Unexpected path '+path);
 };
 const post=(params)=>api(new Request('https://pocketcomfy.netlify.app/api/comfy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base:'http://127.0.0.1:8188',mode:'qwen',qwenTurbo:true,prompt:'A portrait',seed:123,duration:5,quality:'draft',aspect:'square',...params})}));
 let response=await post({action:'connect'});assert.equal(response.status,200,await response.clone().text());
 missingNode='ManualSigmas';response=await post({action:'connect'});assert.equal(response.status,400);assert.match((await response.json()).error,/ManualSigmas/);missingNode='';
 missingModel=true;response=await post({action:'connect'});assert.equal(response.status,400);assert.match((await response.json()).error,/qwen_image_2.1_turbo_int8_convrot/);missingModel=false;
 for(const quality of ['draft','balanced','high'])for(const aspect of ['square','landscape','portrait']){
  response=await post({action:'generate',quality,aspect});assert.equal(response.status,200,await response.clone().text());const graph=submitted.at(-1);
  assert.equal(graph['459:451'].inputs.unet_name,'qwen_image_2.1_turbo_int8_convrot.safetensors');
  assert.equal(graph['459:488'].inputs.noise_seed,123);assert.equal(graph['459:489'].inputs.cfg,1);assert.equal(graph['459:487'].inputs.sampler_name,'euler');
  assert.equal(graph['459:484'].inputs.sigmas,'1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0');
  assert.equal(graph['459:452'].inputs.prompt,'A portrait');assert.equal(graph['459:452'].inputs.negative_prompt,'');
  const reference=makeWorkflow({mode:'qwen',prompt:'A portrait',seed:123,quality,aspect});assert.equal(graph['459:456'].inputs.width,reference['459:456'].inputs.width);assert.equal(graph['459:456'].inputs.height,reference['459:456'].inputs.height);
  assert.ok(!Object.values(graph).some(n=>n.class_type==='TextGenerate'||n.inputs.clip_name?.includes('9b')),'Disabled enhancer is absent from model checks and generation');
  for(const node of Object.values(graph))for(const input of Object.values(node.inputs))if(Array.isArray(input)&&typeof input[0]==='string')assert.ok(graph[input[0]],'Every linked node exists');
 }
 for(const params of [{negativePrompt:'blurry'},{guidance:3},{seed:-1},{prompt:''}]){response=await post({action:'generate',...params});assert.equal(response.status,400);}
 const before=submitted.length;response=await post({action:'bulk',batch_id:'turbo-batch',items:[{index:0,prompt:'First',seed:42},{index:1,prompt:'Second',seed:43}]});assert.equal(response.status,200,await response.clone().text());assert.equal(submitted.length,before+2);assert.equal(submitted.at(-2)['459:452'].inputs.prompt,'First');assert.equal(submitted.at(-1)['459:488'].inputs.noise_seed,43);
 response=await post({action:'generate',qwenTurbo:false,negativePrompt:'blurry',guidance:3});assert.equal(response.status,200);assert.equal(submitted.at(-1)['459:458'].inputs.steps,25);assert.equal(submitted.at(-1)['459:458'].inputs.cfg,3);
 console.log('Qwen Turbo verified: exact 8-step sigma schedule, Euler/CFG1, 9 frame/size combinations, single/bulk seeds/prompts, missing nodes/models, disabled enhancer pruning, invalid inputs and unchanged standard Qwen. No GPU generation submitted.');
}finally{await vite.close();}
