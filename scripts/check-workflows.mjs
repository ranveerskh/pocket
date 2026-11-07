import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
function compile(path,imports={}){let source=fs.readFileSync(path,'utf8');for(const [file,val]of Object.entries(imports))if((file.endsWith('.json')||file.endsWith('.ts')))source=source.replace(new RegExp("import (\\w+) from ['\"]"+file.replace(/[.]/g,'\\.')+"['\"];"),(_,name)=>'const '+name+' = '+JSON.stringify(val)+';');const js=ts.transpile(source,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},path);const sandbox={exports:{},Error,TypeError,DOMException,structuredClone,URL,URLSearchParams,AbortSignal,AbortController,setTimeout,clearTimeout,fetch:mockFetch,Response,Request,Headers,FormData,File,btoa,atob,TextEncoder,TextDecoder,crypto:webcrypto,require:name=>name.includes('pod-storage')?imports.storage:imports.comfy};vm.runInNewContext(js,sandbox);return sandbox.exports;}
const video=JSON.parse(fs.readFileSync('server/workflow.ts','utf8').replace(/^export default /,'').replace(/;\s*$/,''));const image=JSON.parse(fs.readFileSync('server/image-workflow.ts','utf8').replace(/^export default /,'').replace(/;\s*$/,''));const r2v=JSON.parse(fs.readFileSync('server/r2v-workflow.ts','utf8').replace(/^export default /,'').replace(/;\s*$/,''));const qwen=JSON.parse(fs.readFileSync('server/qwen-workflow.ts','utf8').replace(/^export default /,'').replace(/;\s*$/,''));let lastGraph;let statusHistory={};let scenario='complete';let calls=[];let storageScenario='ok';let mediaScenario='ok';let batchQueue=[];let submitCount=0;let failAt=-1;
async function mockFetch(url,init={}){const u=new URL(url);calls.push([u.pathname,init,u.searchParams.toString()]);if(u.pathname.startsWith('/pocket-studio/storage/')){if(storageScenario==='missing')return new Response('Not found',{status:404});if(init.headers.Authorization!=='Bearer '+'x'.repeat(43))return Response.json({error:'Storage key is missing or incorrect.'},{status:401});if(u.pathname.endsWith('/status'))return Response.json({protocol:1,output_delete:true});if(u.pathname.endsWith('/plan'))return Response.json({file:{...JSON.parse(init.body).file,receipt:'signed-receipt',size:12}});if(u.pathname.endsWith('/delete'))return Response.json({file:{filename:'test.mp4',subfolder:'video',type:'output',status:'deleted'}});}if(u.pathname==='/system_stats')return Response.json({devices:[{name:'Test GPU'}]});if(u.pathname.startsWith('/object_info/')){const type=decodeURIComponent(u.pathname.split('/').pop());let required={};for(const node of [...Object.values(video),...Object.values(image),...Object.values(r2v),...Object.values(qwen)])if(node.class_type===type)for(const [k,v]of Object.entries(node.inputs))if(['clip_name','unet_name','vae_name','lora_name'].includes(k))required[k]=[[...(required[k]?.[0]||[]),v]];return Response.json({[type]:{input:{required}}});}if(u.pathname==='/prompt'){const body=JSON.parse(init.body);lastGraph=body.prompt;if(body.extra_data?.pocket_batch_id){if(submitCount===failAt)throw new Error('Simulated submission failure');submitCount++;const id='bulk-id-'+submitCount;batchQueue.push([submitCount,id,body.prompt,body.extra_data,[]]);return Response.json({prompt_id:id,number:submitCount});}return Response.json({prompt_id:'test-id',number:1});}if(u.pathname==='/history')return Response.json(statusHistory);if(u.pathname==='/history/test-id'&&statusHistory['test-id'])return Response.json({'test-id':statusHistory['test-id']});if(u.pathname==='/history/test-id')return Response.json(scenario==='complete'?{'test-id':{status:{completed:true,status_str:'success'},outputs:{9:{images:[{filename:'test.png',subfolder:'image',type:'output'}]}}}}:scenario==='error'?{'test-id':{status:{status_str:'error',messages:[['execution_error',{exception_message:'Test GPU error'}]]}}}:{});if(u.pathname==='/queue')return init.method==='POST'?new Response(null,{status:200}):Response.json({queue_running:[],queue_pending:batchQueue.length?batchQueue:scenario==='queued'?[[1,'test-id']]:[]});if(u.pathname==='/upload/image'){const f=init.body.get('image');return Response.json({name:f.name,subfolder:'',type:'input'});}if(u.pathname==='/view'&&mediaScenario==='missing')return new Response('Missing',{status:404});if(u.pathname==='/view'&&mediaScenario==='html')return new Response('<html>Proxy page</html>',{headers:{'Content-Type':'text/html'}});if(u.pathname==='/view')return new Response('media',{status:206,headers:{'Content-Type':'image/png','Content-Range':'bytes 0-4/5','Accept-Ranges':'bytes'}});throw new Error('Unexpected URL '+url);}
const c=compile('server/comfy.ts',{'./workflow.ts':video,'./image-workflow.ts':image,'./qwen-workflow.ts':qwen,'./r2v-workflow.ts':r2v});let count=0;
for(const mode of ['image','video'])for(const duration of [4,5,6,8,10])for(const quality of ['draft','balanced','high'])for(const aspect of ['landscape','portrait','square'])for(const turbo of [false,true]){const g=c.makeWorkflow({mode,prompt:'Test scene',duration,quality,aspect,turbo,seed:123,image:mode==='video'?'test.png':undefined});for(const n of Object.values(g))for(const v of Object.values(n.inputs))if(Array.isArray(v)&&typeof v[0]==='string')assert.ok(g[v[0]],'Missing source '+v[0]);if(mode==='image'){assert.equal(g['57:3'].inputs.steps,8);assert.equal(g['57:27'].inputs.text,'Test scene');assert.equal(g['57:3'].inputs.seed,123);assert.equal(g['57:13'].inputs.width%32,0);}else{assert.equal(g['140:131'].inputs.prompt,'Test scene');assert.equal(g['140:133'].inputs.value,duration);assert.equal(g['140:124'].inputs.steps,turbo?8:20);assert.equal(!!g['140:134'],turbo);assert.equal(g['140:131'].inputs.first_frame[0],'pocket:image');}count++;}
assert.throws(()=>c.runpodURL('http://localhost'));assert.throws(()=>c.runpodURL('https://example.com'));assert.equal(c.runpodURL('https://abc-8188.proxy.runpod.net/'),'https://abc-8188.proxy.runpod.net');
const storage=compile('server/pod-storage.ts',{comfy:c});const route=compile('netlify/edge-functions/comfy.ts',{comfy:c,storage});const base='https://abc-8188.proxy.runpod.net';async function post(params){return route.default(new Request('https://studio.test/api/comfy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base,...params})}));}
for(const mode of ['image','video']){const r=await post({action:'connect',mode});assert.equal(r.status,200);assert.equal((await r.json()).connected,true);const gen=await post({action:'generate',mode,prompt:'Scene',seed:123,duration:5,quality:'draft',aspect:'landscape'});assert.equal(gen.status,200);assert.ok(lastGraph[mode==='image'?'9':'92']);}
let r=await post({action:'status',id:'test-id'});assert.equal((await r.json()).files[0].filename,'test.png');scenario='error';r=await post({action:'status',id:'test-id'});assert.equal((await r.json()).error,'Test GPU error');scenario='queued';r=await post({action:'status',id:'test-id'});assert.equal((await r.json()).position,1);r=await post({action:'cancel',id:'test-id'});assert.equal((await r.json()).cancelled,true);r=await post({action:'generate',mode:'image',prompt:'',seed:123,quality:'high',aspect:'square'});assert.equal(r.status,400);
const media=compile('netlify/edge-functions/media.ts',{comfy:c});r=await media.default(new Request('https://studio.test/api/media?'+new URLSearchParams({base,filename:'test.png',subfolder:'image',download:'1'}),{headers:{Range:'bytes=0-4'}}));assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),'bytes 0-4/5');assert.match(r.headers.get('Content-Disposition'),/attachment/);assert.equal(calls.at(-1)[1].headers.Range,'bytes=0-4');
console.log('Passed '+count+' workflow variants; mocked model checks, submissions, status, cancellation, media range and download routes. No live GPU jobs submitted.');

const imported={graph:image,map:{prompt:{node:'57:27',input:'text'},seed:{node:'57:3',input:'seed'},width:{node:'57:13',input:'width'},height:{node:'57:13',input:'height'}}};
const customGraph=c.makeWorkflow({custom:imported,prompt:'Custom prompt',seed:42,quality:'high',aspect:'square'});assert.equal(customGraph['57:27'].inputs.text,'Custom prompt');assert.equal(customGraph['57:3'].inputs.seed,42);assert.equal(customGraph['57:13'].inputs.width,1024);assert.notEqual(image['57:27'].inputs.text,'Custom prompt');
assert.throws(()=>c.makeWorkflow({custom:{...imported,map:{prompt:{node:'missing',input:'text'}}},prompt:'Test',quality:'high',aspect:'square'}));assert.throws(()=>c.validateCustomGraph({nodes:[]}));
const wf=compile('src/workflows.ts');assert.equal(wf.autoMap(image).prompt.node,'57:27');assert.equal(Object.keys(wf.parseWorkflow(JSON.stringify(image))).length,10);assert.throws(()=>wf.parseWorkflow(JSON.stringify({nodes:[]})));
const vault=compile('src/vault.ts');const salt=webcrypto.getRandomValues(new Uint8Array(16));const key=await vault.deriveKey('123456',salt);const records={jobs:[{id:'one',prompt:'Private prompt'}],folders:[{id:'folder',name:'Private folder'}]};const envelope=await vault.sealLibrary(records,key,btoa(String.fromCharCode(...salt)));assert.ok(!JSON.stringify(envelope).includes('Private'));const opened=await vault.openLibrary(envelope,key);assert.equal(opened.jobs[0].prompt,'Private prompt');const wrong=await vault.deriveKey('654321',salt);await assert.rejects(()=>vault.openLibrary(envelope,wrong));
const templates=compile('src/Templates.tsx');assert.equal(templates.applyTemplates('My scene',[],'video'),'My scene');assert.ok(templates.applyTemplates('My scene',['continuity'],'video').includes('Preserve the same face'));assert.equal(templates.applyTemplates('My scene',['continuity'],'image'),'My scene');
console.log('Passed imported-workflow mapping/validation, template toggles, encrypted gallery roundtrip and incorrect-PIN rejection.');

const gm=compile('src/gallery-model.ts');const sample=[{id:'a',created:1,prompt:'Normal',state:'complete',mode:'image',folder:'project'},{id:'b',created:2,prompt:'Hidden',state:'complete',mode:'image',folder:'project',hidden:true},{id:'c',created:3,prompt:'Unfiled',state:'complete',mode:'video'}];assert.equal(gm.galleryItems(sample,'all').length,2);assert.equal(gm.galleryItems(sample,'project').length,1);assert.equal(gm.galleryItems(sample,'hidden').length,1);assert.equal(gm.galleryItems(sample,'all','all','Hidden').length,0);assert.equal(gm.galleryItems(sample,'hidden','all','Hidden')[0].id,'b');assert.notEqual(gm.localId(),gm.localId());
const timing=compile('src/timing.ts');const baseTiming={mode:'video',duration:4,quality:'draft',aspect:'landscape',base:'https://test-8188.proxy.runpod.net',device:'Test GPU',state:'complete',timingSource:'server'};const history=[{...baseTiming,id:'t1',created:1,completedAt:2,elapsedSeconds:100},{...baseTiming,id:'t2',created:3,completedAt:4,elapsedSeconds:200},{...baseTiming,id:'t3',created:5,completedAt:6,duration:6,elapsedSeconds:900}];const stats=timing.timingStats(history,{...baseTiming,id:'next'});assert.equal(stats.count,2);assert.equal(stats.last,200);assert.equal(stats.average,150);assert.equal(stats.max,200);assert.equal(timing.timingStats(history,{...baseTiming,id:'six',duration:6}).average,900);assert.equal(timing.timingStats(history,{...baseTiming,id:'eight',duration:8}),null);assert.equal(timing.timingStats(history,{...baseTiming,id:'quality',quality:'high'}),null);assert.equal(timing.estimatedPercent(300,200),95);assert.equal(timing.estimatedPercent(300,200,true),100);
console.log('Passed projects/hidden filtering, local identifiers, per-duration timing histories, averages/max and estimate progress caps.');

const bm=compile('src/bulk-model.ts');assert.equal(bm.parseBulk('one\ntwo').length,2);assert.equal(bm.parseBulk('one\nline two\n\nsecond','blocks').length,2);assert.throws(()=>bm.parseBulk(Array(51).fill('prompt').join('\n')));assert.equal(bm.chunks(Array.from({length:50},(_,i)=>i),5).length,10);
scenario='none';for(let start=0;start<50;start+=5){const result=await post({action:'bulk',batch_id:'batch-one',mode:'image',quality:'draft',aspect:'square',items:Array.from({length:5},(_,i)=>({index:start+i,prompt:'Batch '+(start+i),seed:start+i}))});const data=await result.json();assert.equal(result.status,200);assert.equal(data.items.length,5);assert.equal(data.partial_error,'');}assert.equal(submitCount,50);let result=await post({action:'bulk',batch_id:'batch-one',mode:'image',quality:'draft',aspect:'square',items:[{index:0,prompt:'Batch 0',seed:0}]});assert.equal((await result.json()).items.length,1);assert.equal(submitCount,50);result=await post({action:'recover_batch',batch_id:'batch-one'});assert.equal((await result.json()).items.length,50);result=await post({action:'statuses',ids:['bulk-id-1','bulk-id-50']});assert.equal((await result.json()).statuses['bulk-id-50'].position,50);
failAt=submitCount+1;result=await post({action:'bulk',batch_id:'partial-batch',mode:'image',quality:'draft',aspect:'square',items:[{index:0,prompt:'first',seed:1},{index:1,prompt:'fail',seed:2},{index:2,prompt:'not submitted',seed:3}]});const partial=await result.json();assert.equal(partial.items.length,1);assert.ok(partial.partial_error.includes('Simulated'));
const downloads=compile('src/DownloadButton.tsx');assert.equal(downloads.fileType('clip.mp4'),'video/mp4');assert.equal(downloads.fileType('image.png'),'image/png');
console.log('Passed 50-item queue chunks, duplicate prevention, partial failure/recovery, batch status, prompt parsing and media MIME handling.');

// Long prompts retain line breaks and empty lines; marker errors cannot silently submit partial input.
for (const n of [4,5,50]) {
 const prompts=Array.from({length:n},(_,i)=>`Scene ${i+1}\nCamera detail\n\nDialogue: hello.`);
 assert.deepEqual([...bm.parseBulk(prompts.map(p=>`*${p}*`).join('\n\n'))],prompts);
}
assert.deepEqual([...bm.parseBulk('*one**two*')],['one','two']);
assert.throws(()=>bm.parseBulk('*one*\n*unfinished'));
assert.throws(()=>bm.parseBulk('*one* stray text'));
assert.throws(()=>bm.parseBulk('**'));
assert.throws(()=>bm.parseBulk(Array(51).fill('*prompt*').join('\n')));
assert.throws(()=>bm.parseBulk('*'+ 'x'.repeat(20001)+'*'));
assert.deepEqual([...bm.parseBulk('*literal*\nsecond','lines')],['*literal*','second']);
console.log('Star-delimited multiline batches: 4, 5 and 50 prompts, limits and malformed input passed.');

const alerts=compile('src/completion-model.ts');
const alertJobs=[{id:'one',base:'pod-a',state:'running'},{id:'two',base:'pod-a',state:'queued'},{id:'hidden',base:'pod-a',state:'running',hidden:true},{id:'old',base:'pod-a',state:'complete'},{id:'failed',base:'pod-a',state:'running'}];
const completedJobs=alertJobs.map(j=>({...j,state:j.id==='failed'?'error':'complete'}));
assert.equal(alerts.completedSince(alerts.completionSnapshot(alertJobs),completedJobs).map(j=>j.id).join(','),'one,two');
assert.equal(alerts.completedSince(alerts.completionSnapshot(completedJobs),completedJobs).length,0);
assert.equal(alerts.completedSince(alerts.completionSnapshot(alertJobs),[{id:'one',base:'pod-b',state:'complete'}]).length,0);
assert.equal(alerts.completedSince(alerts.completionSnapshot([]),completedJobs).length,0);
console.log('Completion alerts: single/bulk transitions, repeat suppression, private items, failures and restored history passed.');

// R2V: no example media or prompts survive; dotted autogrow keys match ComfyUI's API.
const refs={images:[{name:'Adam',path:'adam.png'},{name:'Leah',path:'leah.png'}],audios:[{name:'Adam',path:'adam.wav',seconds:4},{name:'Leah',path:'leah.m4a',seconds:5}]};
for(const duration of [4,5,6,8,10])for(const quality of ['draft','balanced','high'])for(const aspect of ['landscape','portrait','square'])for(const turbo of [false,true]){
 const g=c.makeWorkflow({mode:'r2v',prompt:'New scene',seed:321,duration,quality,aspect,turbo,references:refs});
 // R2V baseline from the supplied ComfyUI API export: both encode/decode use FP16,
 // audio keeps its own FP32 VAE, and the simple schedule must survive runtime mapping.
 assert.equal(g['119'].inputs.vae_name,'minimax_h3_video_vae_fp16.safetensors');
 assert.equal(g['124'].inputs.scheduler,'simple');
 assert.equal(g['123'].inputs.sampler_name,'res_multistep');
 assert.equal(g['120'].inputs.vae_name,'minimax_h3_audio_vae_fp32.safetensors');
 assert.deepEqual([...g['136'].inputs.vae],['119',0]);
 assert.deepEqual([...g['122'].inputs.vae],['119',0]);
 assert.deepEqual([...g['121'].inputs.vae],['120',0]);
 assert.deepEqual([...g['130'].inputs.audio],['121',0]);
 assert.equal(g['130'].inputs.fps,24);
 assert.equal(g['136'].inputs.prompt,'New scene');assert.equal(g['136'].inputs.width%32,0);assert.equal(g['136'].inputs.length%17,5);assert.ok(g['136'].inputs.length/24>=duration);assert.equal(g['124'].inputs.steps,turbo?4:20);assert.equal(g['124'].inputs.model[0],turbo?'145':'127');assert.equal(!!g['145'],turbo);assert.equal(g['136'].inputs['ref_audios.ref_audio_0'][0],'pocket-ref-audio-0');assert.equal(g['pocket-ref-audio-1'].inputs.audio,'leah.m4a');assert.equal(g['pocket-ref-image-1'].inputs.image,'leah.png');assert.ok(!g['137']&&!g['138']&&!g['139']&&!g['141']);assert.equal(g['129'].inputs.noise_seed,321);
 for(const node of Object.values(g))for(const value of Object.values(node.inputs))if(Array.isArray(value)&&typeof value[0]==='string')assert.ok(g[value[0]],value[0]);
}
const r2p={mode:'r2v',prompt:'Scene',seed:123,duration:5,quality:'draft',aspect:'landscape'};
assert.throws(()=>c.makeWorkflow(r2p),/at least one/);
assert.throws(()=>c.makeWorkflow({...r2p,references:{images:[{path:'../secret'}]}}),/path/);
assert.throws(()=>c.makeWorkflow({...r2p,references:{audios:[{path:'voice.wav',seconds:16}]}}),/15 seconds/);
assert.throws(()=>c.makeWorkflow({...r2p,references:{audios:[{path:'a.wav',seconds:10},{path:'b.wav',seconds:10}]}}),/15 seconds/);
const voiceOnly=c.makeWorkflow({...r2p,references:{audios:refs.audios}});assert.ok(!Object.keys(voiceOnly['136'].inputs).some(k=>k.startsWith('ref_images.')));
const photoOnly=c.makeWorkflow({...r2p,references:{images:refs.images}});assert.ok(!Object.keys(photoOnly['136'].inputs).some(k=>k.startsWith('ref_audios.')));
r=await post({action:'connect',mode:'r2v'});assert.equal(r.status,200);assert.equal((await r.json()).turboReady,true);
r=await post({...r2p,action:'generate',references:refs});assert.equal(r.status,200);assert.equal(lastGraph['pocket-ref-audio-0'].class_type,'LoadAudio');assert.equal(lastGraph['119'].inputs.vae_name,'minimax_h3_video_vae_fp16.safetensors');assert.equal(lastGraph['124'].inputs.scheduler,'simple');
failAt=-1;r=await post({...r2p,action:'bulk',batch_id:'r2v-batch',references:refs,items:[{index:0,prompt:'Scene one',seed:1},{index:1,prompt:'Scene two',seed:2}]});assert.equal((await r.json()).items.length,2);assert.equal(lastGraph['136'].inputs.prompt,'Scene two');assert.equal(lastGraph['pocket-ref-audio-0'].inputs.audio,'adam.wav');assert.equal(lastGraph['119'].inputs.vae_name,'minimax_h3_video_vae_fp16.safetensors');assert.equal(lastGraph['124'].inputs.scheduler,'simple');
for(const kind of ['image','audio']){const form=new FormData();form.set('base',base);form.set('kind',kind);form.set(kind,new File(['sample'],kind==='image'?'photo.png':'voice.m4a',{type:kind==='image'?'image/png':'audio/mp4'}));r=await route.default(new Request('https://studio.test/api/comfy',{method:'POST',body:form}));assert.equal(r.status,200);assert.match((await r.json()).name,kind==='image'?/\.png$/:/\.m4a$/);}
const invalidUpload=new FormData();invalidUpload.set('base',base);invalidUpload.set('kind','audio');invalidUpload.set('audio',new File(['x'],'bad.exe',{type:'application/octet-stream'}));r=await route.default(new Request('https://studio.test/api/comfy',{method:'POST',body:invalidUpload}));assert.equal(r.status,400);
const rm=compile('src/reference-model.ts');const characters=[{id:'adam',base,name:'Adam',image:'adam.png'},{id:'leah',base,name:'Leah',image:'leah.png',audio:'leah.wav',audioSeconds:4}];const selected=rm.characterReferences(characters,['adam','leah'],base);assert.equal(selected.images.length,2);assert.equal(selected.audios.length,1);const tagged=rm.referencePrompt('Leah speaks.',selected);assert.ok(tagged.includes('"Leah": follow the voice timbre of <Audio 1>'));assert.throws(()=>rm.characterReferences(characters,['adam'],'other-pod'),/connection/);assert.equal(rm.characterReferences(characters,[],base).images.length,0);
const protectedRefs=await vault.sealLibrary({jobs:[],folders:[],characters,characterIds:['adam','leah']},key,btoa(String.fromCharCode(...salt)));assert.ok(!JSON.stringify(protectedRefs).includes('adam.png'));const restoredRefs=await vault.openLibrary(protectedRefs,key);assert.equal(restoredRefs.characters[1].audio,'leah.wav');assert.equal(restoredRefs.characterIds.join(','),'adam,leah');
const many=Array.from({length:25},(_,i)=>({...baseTiming,id:'history-'+i,created:i,completedAt:i+1,elapsedSeconds:100+i,prompt:'Keep me',files:[{filename:i+'.mp4'}]}));const bounded=timing.pruneTimingHistory(many);assert.equal(bounded.length,25);assert.equal(bounded.filter(j=>typeof j.elapsedSeconds==='number').length,5);assert.equal(bounded[0].elapsedSeconds,undefined);assert.equal(bounded[24].elapsedSeconds,124);assert.equal(bounded[0].prompt,'Keep me');assert.equal(bounded[0].files[0].filename,'0.mp4');assert.equal(timing.timingStats(bounded,{...baseTiming,id:'next'}).count,5);assert.equal(alerts.alertsEnabled('off'),false);assert.equal(alerts.alertsEnabled(null),true);assert.equal(alerts.alertsEnabled('on'),true);
console.log('Passed 90 R2V variants; reference order, audio uploads, optional voice/photo, limits, single/bulk graphs, encrypted saved characters, 5 timing samples and alert preference.');

for(const type of ['output','input','temp']){const probe=await media.default(new Request('https://studio.test/api/media?'+new URLSearchParams({base,filename:'test.png',subfolder:'image',type,check:'1'})));assert.equal(probe.status,200);assert.equal((await probe.json()).available,true);assert.equal(calls.at(-1)[1].headers.Range,'bytes=0-0');assert.equal(new URLSearchParams(calls.at(-1)[2]).get('type'),type);}
mediaScenario='missing';let probe=await media.default(new Request('https://studio.test/api/media?'+new URLSearchParams({base,filename:'old.mp4',check:'1'})));assert.match((await probe.json()).error,/File not found/);mediaScenario='html';probe=await media.default(new Request('https://studio.test/api/media?'+new URLSearchParams({base,filename:'old.mp4',check:'1'})));assert.match((await probe.json()).error,/page instead of media/);mediaScenario='ok';assert.equal(new URLSearchParams(downloads.mediaURL(base,{filename:'old.mp4',subfolder:'',type:'temp'}).split('?')[1]).get('type'),'temp');
console.log('Passed saved-media availability probes, missing-file/HTML diagnostics, range preservation, and legacy temporary-file downloads.');

assert.equal(bm.jobsInBatch([{id:'single'},{id:'bulk',batchId:'b'}],undefined).length,0);assert.equal(bm.jobsInBatch([{id:'single'},{id:'bulk',batchId:'b'}],'b')[0].id,'bulk');

const storageKey='x'.repeat(43);r=await post({action:'storage_status',storageKey});assert.equal(r.status,200);r=await post({action:'storage_plan',storageKey,file:{filename:'test.mp4',subfolder:'video',type:'output'}});assert.equal((await r.json()).file.receipt,'signed-receipt');assert.equal(calls.at(-1)[0],'/pocket-studio/storage/plan');r=await post({action:'storage_delete',storageKey,confirmed:true,receipt:'signed-receipt'});assert.equal((await r.json()).file.status,'deleted');r=await post({action:'storage_delete',storageKey,confirmed:false,receipt:'signed-receipt'});assert.equal(r.status,400);r=await post({action:'storage_status',storageKey:'y'.repeat(43)});assert.equal(r.status,400);assert.match((await r.json()).error,/incorrect/);storageScenario='missing';r=await post({action:'storage_status',storageKey});assert.match((await r.json()).error,/Install/);storageScenario='ok';r=await route.default(new Request('https://studio.test/api/comfy',{method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/json'},body:JSON.stringify({base,action:'storage_delete',storageKey,confirmed:true,receipt:'signed-receipt'})}));assert.equal(r.status,403);
console.log('Passed protected storage routes, missing-helper feedback, credential rejection, confirmation enforcement and cross-site rejection.');

// Regression: three selected characters from yesterday's pod cannot block today's choices.
const oldPod='https://old-8188.proxy.runpod.net';
const migrated=[...['old1','old2','old3'].map(id=>({id,name:id,base:oldPod,image:id+'.png'})),...['mother','daughter','manager'].map(id=>({id,name:id,base,image:id+'.png'}))];
let scoped=['old1','old2','old3','deleted-id'];
assert.equal(rm.currentCharacterIds(migrated,scoped,base).length,0);
for(const id of ['mother','daughter','manager']){const active=rm.currentCharacterIds(migrated,scoped,base);scoped=rm.selectCharactersForConnection(migrated,scoped,base,[...active,id]);}
assert.equal(rm.currentCharacterIds(migrated,scoped,base).join(','),'mother,daughter,manager');
assert.equal(rm.currentCharacterIds(migrated,scoped,oldPod).join(','),'old1,old2,old3');
const currentRefs=rm.characterReferences(migrated,rm.currentCharacterIds(migrated,scoped,base),base);
assert.equal(currentRefs.images.map(x=>x.name).join(','),'mother,daughter,manager');
assert.ok(!rm.referencePrompt('scene',currentRefs).includes('old1'));
scoped=rm.selectCharactersForConnection(migrated,scoped,base,['mother','manager']);
assert.equal(rm.currentCharacterIds(migrated,scoped,base).join(','),'mother,manager');
assert.equal(rm.currentCharacterIds(migrated,scoped,oldPod).length,3);
assert.throws(()=>rm.selectCharactersForConnection(migrated,scoped,base,['old1']),/connection/);
assert.throws(()=>rm.selectCharactersForConnection([...migrated,{id:'fourth',name:'fourth',base,image:'fourth.png'}],scoped,base,['mother','daughter','manager','fourth']),/3 characters/);
assert.equal(rm.currentCharacterIds(migrated,['mother','mother','missing'],base).join(','),'mother');
assert.equal(migrated.length,6);
console.log('Passed connection-scoped character selection after pod migration, stable Picture order, per-pod limits and retained old selections.');

// The server's timestamps separate generation from time spent waiting for earlier clips.
const start=1800000000000;
const timed=c.historyTiming({status:{messages:[['execution_start',{timestamp:start}],['execution_success',{timestamp:start+300000}]]}});
assert.equal(timed.elapsedSeconds,300);assert.equal(timed.startedAt,start);assert.equal(timed.completedAt,start+300000);
assert.equal(c.historyTiming({status:{messages:[['execution_start',{timestamp:start/1000}],['execution_success',{timestamp:(start+300000)/1000}]]}}).elapsedSeconds,300);
assert.equal(c.historyTiming({status:{messages:[]}}).startedAt,undefined);
assert.equal(c.historyTiming({status:{messages:[['execution_start',{timestamp:'bad'}]]}}).startedAt,undefined);
const qjob={...baseTiming,id:'queue-clock',created:start-1200000,state:'queued'};
const running=timing.mergeJobStatus(qjob,{state:'running'},start);
assert.equal(running.queueSeconds,1200);assert.equal(running.startedAt,start);
assert.equal(timing.jobTiming(running,start+60000).generation,60);
assert.equal(timing.jobTiming(running,start+60000).queue,1200);
const done=timing.mergeJobStatus(running,{state:'complete',...timed},start+999999);
assert.equal(done.elapsedSeconds,300);assert.equal(done.totalSeconds,1500);assert.equal(done.queueSeconds,1200);assert.equal(done.completedAt,start+300000);
assert.equal(timing.timingStats([done],done).last,300); // Includes the currently completed run.
assert.equal(timing.timingStats([{...done,timingSource:undefined}],done),null); // Legacy queue-inclusive totals cannot pollute estimates.
const resumed=timing.mergeJobStatus(qjob,{state:'complete',...timed},start+86400000);
assert.equal(resumed.elapsedSeconds,300);assert.equal(resumed.completedAt,start+300000);
const unobserved=timing.mergeJobStatus(qjob,{state:'complete'},start+300000);
assert.equal(unobserved.elapsedSeconds,undefined);assert.equal(timing.jobTiming(unobserved).generation,null);
assert.equal(timing.jobTiming(qjob,start).generation,null);
const ordered=[10,2,1].map((n,i)=>({...sample[0],id:'scene-'+n,prompt:'SCENE '+String(n).padStart(2,'0')+' — Title '+n,created:100+i}));
assert.equal(gm.galleryItems(ordered,'all').map(j=>j.id).join(','),'scene-1,scene-2,scene-10');
assert.equal(gm.creationLabel(ordered[0]),'Scene 10');assert.equal(gm.creationTitle(ordered[0]),'Title 10');
assert.equal(gm.sceneDetails({...ordered[0],prompt:'Reference assignments\n\nSCENE:\nTHE LAST STOP — SCENE 31\nTitle'}).number,31);
assert.equal(gm.sceneDetails({...ordered[0],basePrompt:'SCENE 04 — The entrance',prompt:'wrong title'}).number,4);
assert.equal(gm.creationDownloadName(ordered[0],'original.mp4'),'Scene_10_original.mp4');
assert.equal(gm.galleryItems(ordered,'all','all','','newest')[0].id,'scene-1');
const batchRows=[2,0,1].map(n=>({...sample[0],id:'row-'+n,prompt:'Long unnumbered prompt',batchId:'batch',batchIndex:n,created:1000}));
assert.equal(gm.galleryItems(batchRows,'all').map(j=>gm.creationLabel(j)).join(','),'Prompt 01,Prompt 02,Prompt 03');
assert.equal(gm.galleryItems(ordered,'all','all','Title 2')[0].id,'scene-2');
assert.equal(gm.galleryItems([...ordered,{...ordered[0],id:'hidden-scene',hidden:true}],'all').length,3);
console.log('Passed queue/generation separation, server completion after backgrounding, legacy timing exclusion, completed-current statistics, numeric scene ordering and batch prompt numbering.');

statusHistory={'test-id':{status:{completed:true,status_str:'success',messages:[['execution_start',{timestamp:start}],['execution_success',{timestamp:start+300000}]]},outputs:{}}};
const oneStatus=await(await post({action:'status',id:'test-id'})).json();assert.equal(oneStatus.elapsedSeconds,300);
const allStatus=await(await post({action:'statuses',ids:['test-id']})).json();assert.equal(allStatus.statuses['test-id'].startedAt,start);assert.equal(allStatus.statuses['test-id'].completedAt,start+300000);
console.log('Single and bulk status routes return authoritative execution timestamps.');

for(const quality of ['draft','balanced','high'])for(const aspect of ['landscape','portrait','square'])for(const negativePrompt of ['', 'blur, watermark']){
 const graph=c.makeWorkflow({mode:'qwen',prompt:'A ceramic mug in window light',negativePrompt,seed:42,quality,aspect});
 assert.equal(graph['459:452'].inputs.prompt,'A ceramic mug in window light');assert.equal(graph['459:452'].inputs.negative_prompt,negativePrompt);assert.equal(graph['459:458'].inputs.seed,42);assert.equal(graph['459:458'].inputs.steps,25);assert.equal(graph['459:458'].inputs.cfg,negativePrompt?3:1);
 assert.equal(graph['459:458'].inputs.negative[0],'459:452');assert.equal(graph['459:458'].inputs.negative[1],1);
 assert.equal(graph['459:456'].inputs.width%32,0);assert.equal(graph['459:456'].inputs.height%32,0);
 assert.equal(graph['459:451'].inputs.unet_name,'qwen_image_2.1_int8_convrot.safetensors');
 assert.ok(!graph['459:471']);assert.ok(!graph['459:473']);assert.ok(!graph['459:475']);assert.ok(!graph['13']);
 for(const node of Object.values(graph))for(const value of Object.values(node.inputs))if(Array.isArray(value)&&typeof value[0]==='string')assert.ok(graph[value[0]]);
}
assert.equal(qwen['459:452'].inputs.negative_prompt,'');
assert.throws(()=>c.makeWorkflow({mode:'qwen',prompt:'Test',seed:1,quality:'high',aspect:'square',negativePrompt:'avoid blur',guidance:1}),/guidance above 1/);
assert.throws(()=>c.makeWorkflow({mode:'qwen',prompt:'Test',seed:1,quality:'high',aspect:'square',negativePrompt:'x'.repeat(10001)}),/Negative prompt/);
assert.throws(()=>c.makeWorkflow({mode:'qwen',prompt:'Test',seed:1,quality:'high',aspect:'square',guidance:Infinity}),/guidance/);
const beforeQwenConnect=calls.length;const connectedQwen=await post({action:'connect',mode:'qwen'});assert.equal(connectedQwen.status,200);assert.equal((await connectedQwen.json()).connected,true);assert.ok(!calls.slice(beforeQwenConnect).some(([path])=>path==='/object_info/LoraLoaderModelOnly'));
const oneQwen=await post({action:'generate',mode:'qwen',prompt:'Single ceramic mug',negativePrompt:'watermark',guidance:3,seed:93,quality:'high',aspect:'square'});assert.equal(oneQwen.status,200);assert.equal(lastGraph['459:452'].inputs.negative_prompt,'watermark');
failAt=-1;const bulkQwen=await post({action:'bulk',batch_id:'qwen-batch',mode:'qwen',negativePrompt:'distortion',guidance:2,quality:'high',aspect:'square',items:[{index:0,prompt:'First mug',seed:1},{index:1,prompt:'Second mug',seed:2}]});assert.equal(bulkQwen.status,200);assert.equal((await bulkQwen.json()).items.length,2);assert.equal(lastGraph['459:452'].inputs.prompt,'Second mug');assert.equal(lastGraph['459:452'].inputs.negative_prompt,'distortion');assert.equal(lastGraph['459:458'].inputs.cfg,2);
const cacheStore=new Map();const browserStorage={getItem:key=>cacheStore.get(key)??null,setItem:(key,value)=>cacheStore.set(key,value)};
const cached=timing.mergeTimingSamples([],many);assert.equal(cached.length,5);assert.equal(timing.timingStats(many,{...baseTiming,id:'next'}).average,122);assert.equal(timing.timingStats(many,{...baseTiming,id:'next'}).max,124);
timing.saveTimingSamples(browserStorage,cached);const afterReload=timing.readTimingSamples(browserStorage);assert.equal(afterReload.length,5);assert.equal(timing.timingStats([],{...baseTiming,id:'next'},afterReload).average,122);
const otherDuration={...many[0],id:'other-duration',duration:6,elapsedSeconds:99};const perDuration=timing.mergeTimingSamples(afterReload,[otherDuration]);assert.equal(perDuration.length,6);assert.equal(timing.timingStats([],otherDuration,perDuration).count,1);
const hiddenTime={...many[24],hidden:true};assert.equal(timing.mergeTimingSamples(afterReload,[hiddenTime]).length,4);
cacheStore.set(timing.TIMING_STORAGE_KEY,'invalid JSON');assert.equal(timing.readTimingSamples(browserStorage).length,0);
const qwenTiming={...baseTiming,workflowId:'builtin-qwen-image21',mode:'image',guidance:3};assert.notEqual(timing.timingBucket(qwenTiming),timing.timingBucket({...qwenTiming,guidance:1}));
console.log('Passed 18 Qwen variants, required model files, negative conditioning/CFG, single and bulk API submissions, and latest-five per-setting timing persistence/reload without gallery records.');
