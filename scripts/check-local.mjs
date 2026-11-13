import {createServer} from 'vite';
import assert from 'node:assert/strict';
const vite=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {default:api}=await vite.ssrLoadModule('/src/local-api.ts');
 const graph=(await vite.ssrLoadModule('/src/local-image-workflow.json')).default;
 let submitted;
 globalThis.fetch=async (url,init={})=>{const p=new URL(url).pathname;if(p==='/system_stats')return Response.json({devices:[{name:'Laptop'}]});if(p.startsWith('/object_info/')){const type=decodeURIComponent(p.split('/').pop());const required={};for(const node of Object.values(graph))if(node.class_type===type)for(const [key,v] of Object.entries(node.inputs))if(['unet_name','clip_name','vae_name'].includes(key))required[key]=[[v]];return Response.json({[type]:{input:{required}}});}if(p==='/prompt'){submitted=JSON.parse(init.body).prompt;return Response.json({prompt_id:'abc-123'});}if(p==='/history/abc-123')return Response.json({'abc-123':{status:{completed:true},outputs:{9:{images:[{filename:'test.png',type:'output'}]}}}});throw Error('Unexpected '+url);};
 const post=(p)=>api(new Request('https://pocketcomfy.netlify.app/api/comfy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base:'http://127.0.0.1:8188',mode:'image',quality:'draft',aspect:'square',duration:5,seed:42,prompt:'Test',...p})}));
 let r=await post({action:'connect'});assert.equal(r.status,200,await r.clone().text());
 r=await post({action:'generate'});assert.equal(r.status,200,await r.clone().text());assert.equal(submitted['57:30'].inputs.clip_name,'qwen_3_4b_fp8_mixed.safetensors');assert.equal(submitted['57:28'].inputs.unet_name,'z_image_turbo_int8_convrot.safetensors');
 r=await post({action:'generate',mode:'r2v',references:{images:[{path:'portrait.png',name:'Actor'}]}});assert.equal(r.status,200,await r.clone().text());assert.equal(submitted['119'].inputs.vae_name,'minimax_h3_video_vae_int8_convrot.safetensors');assert.equal(submitted['136'].inputs['ref_images.ref_image_0'][0],'pocket-ref-image-0');assert.equal(submitted['130'].inputs.color_space,'sRGB');
 r=await post({action:'status',id:'abc-123'});assert.equal((await r.json()).state,'complete');
 r=await post({action:'connect',base:'http://192.168.1.1:8188'});assert.equal(r.status,400);
 r=await post({action:'connect',base:'https://laptop.tail123.ts.net'});assert.equal(r.status,200,await r.clone().text());
 r=await post({action:'connect',base:'https://not-ts.net'});assert.equal(r.status,400);
 console.log('Local laptop mock: connect, image submission, status, and non-loopback rejection passed.');
} finally {await vite.close();}
