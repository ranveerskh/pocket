import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
const records=new Map(),calls=[];let pod={id:'abc123',name:'My film GPU',status:'EXITED',actions:['start','terminate'],gpu:{id:'NVIDIA GeForce RTX 5090'},ports:['8188/http'],env:{SECRET:'do-not-return'},registry:{password:'private'}};
let queue={queue_running:[],queue_pending:[]},history={},queueOffline=false,invalidKey=false,loseStopResponse=false,lateQueue=false,queueReads=0;
const watches=new Map();let version=0;
const watchStore={get:async id=>watches.get(id)?.data||null,getWithMetadata:async id=>watches.has(id)?{...watches.get(id)}:null,setJSON:async(id,data,options={})=>{const old=watches.get(id);if(options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return{modified:false};watches.set(id,{data:structuredClone(data),etag:String(++version)});return{modified:true};},async *list({prefix=''}={}){yield{blobs:[...watches.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))};}};
const store={get:async id=>records.get(id)||null,setJSON:async(id,data)=>records.set(id,structuredClone(data)),delete:async id=>records.delete(id)};
const apiKey='rpa_'+ 'test_key'.repeat(6),access='a'.repeat(64);
const fetch=async(url,options={})=>{calls.push({url,method:options.method||'GET',body:options.body});if(url.startsWith('https://abc123-8188.proxy.runpod.net')){if(queueOffline)throw Error('Offline');if(url.includes('/history'))return Response.json(history);queueReads++;if(lateQueue&&queueReads>=2)return Response.json({queue_running:[],queue_pending:[[2,'late-job']]});return Response.json(queue);}if(url==='https://api.runpod.io/graphql'){assert.equal(options.headers.Authorization,'Bearer '+apiKey);return Response.json({data:{myself:{clientBalance:18.4,currentSpendPerHr:2.2,email:'private'}}});}assert.ok(url.startsWith('https://api.runpod.io/v2/pods'));assert.equal(options.headers.Authorization,'Bearer '+apiKey);if(invalidKey)return Response.json({detail:'invalid'},{status:401});if(url.includes('/action')){const action=JSON.parse(options.body).action;assert.ok(['start','stop'].includes(action));pod={...pod,status:action==='start'?'STARTING':'EXITED',actions:action==='start'?['stop','terminate']:['start','terminate']};if(action==='stop'&&loseStopResponse)throw Error('Lost stop reply');return Response.json(pod);}if(url.includes('/pods?'))return Response.json({pods:[pod],pagination:{hasNextPage:false,nextCursor:null}});return Response.json(pod);};
const getStore=({name})=>name==='pocket-pod-watch-v1'?watchStore:store;
const watcherScope={exports:{},require:()=>({getStore}),crypto:webcrypto,fetch,Response,Request,URL,TextEncoder,TextDecoder,Uint8Array,Date,AbortSignal};vm.runInNewContext(ts.transpile(fs.readFileSync('server/pod-watch.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),watcherScope);
const scope={exports:{},require:name=>name.includes('pod-watch')?watcherScope.exports:{getStore},crypto:webcrypto,fetch,Response,Request,URL,TextEncoder,TextDecoder,Uint8Array,Date,AbortSignal};vm.runInNewContext(ts.transpile(fs.readFileSync('netlify/functions/pod-control.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),scope);
const call=(method,body,token=access,origin='https://studio.test',query='')=>scope.exports.default(new Request('https://studio.test/.netlify/functions/pod-control'+query,{method,headers:{authorization:'Bearer '+token,origin,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}));
assert.equal((await call('GET',null,'invalid')).status,401);assert.equal((await(await call('GET')).json()).configured,false);assert.equal(calls.length,0);
assert.equal((await call('POST',{id:'abc123',action:'start'})).status,401);
let response=await call('PUT',{key:apiKey});assert.equal(response.status,200);let data=await response.json();assert.equal(data.configured,true);assert.equal(data.pods[0].id,'abc123');assert.ok(!JSON.stringify(data).includes('do-not-return'));assert.ok(!JSON.stringify([...records]).includes(apiKey));assert.ok(calls.every(c=>c.method==='GET'),'Saving/checking a key never changes pod power');
const before=calls.length;response=await call('POST',{id:'abc123',action:'terminate'});assert.equal(response.status,400);assert.equal(calls.length,before,'Termination is not exposed');
response=await call('POST',{id:'abc123/evil',action:'start'});assert.equal(response.status,400);assert.equal(calls.length,before);
response=await call('POST',{id:'abc123',action:'start'});assert.equal(response.status,200);assert.equal((await response.json()).pod.status,'STARTING');assert.equal(calls.filter(c=>c.method==='POST').length,1);
queue={queue_running:[['one']],queue_pending:[['two']]};response=await call('POST',{id:'abc123',action:'stop'});assert.equal(response.status,409);assert.equal((await response.json()).code,'QUEUE_ACTIVE');assert.equal(calls.filter(c=>c.method==='POST').length,1);
response=await call('POST',{id:'abc123',action:'stop',allowUnavailable:true});assert.equal(response.status,409,'Unavailable override cannot bypass a known active queue');
queueOffline=true;response=await call('POST',{id:'abc123',action:'stop'});assert.equal(response.status,409);assert.equal((await response.json()).code,'QUEUE_UNAVAILABLE');assert.equal(calls.filter(c=>c.method==='POST').length,1);
response=await call('POST',{id:'abc123',action:'stop',allowUnavailable:true});assert.equal(response.status,200);assert.equal((await response.json()).pod.status,'EXITED');
response=await call('POST',{id:'abc123',action:'stop'});assert.equal(response.status,409,'Current RunPod action permissions are rechecked');
assert.equal((await call('PUT',{key:apiKey},access,'https://evil.test')).status,403);
invalidKey=true;assert.equal((await call('PUT',{key:apiKey})).status,502);assert.equal(records.size,1,'Rejected replacement leaves previous saved key intact');invalidKey=false;
response=await call('GET',null,access,'https://studio.test','?pod=abc123');assert.equal((await response.json()).pod.status,'EXITED');
const actions=calls.filter(c=>c.method==='POST').length;await call('DELETE');assert.equal(records.size,0);assert.equal((await(await call('GET')).json()).configured,false);assert.equal(calls.filter(c=>c.method==='POST').length,actions,'Removing a key never stops or starts a pod');
console.log('Pod controls verified with mocks: encrypted key, private-field redaction, read-only setup, start/stop allowlist, live permissions, active queue protection, explicit unavailable override and key removal. No live pods changed.');
// Mounting/refreshing controls only reads state; a user Start performs one
// power request, then readiness checks connect without submitting generation.
await call('PUT',{key:apiKey});pod={...pod,status:'EXITED',actions:['start','terminate']};queueOffline=false;queue={queue_running:[],queue_pending:[]};
const browserStorage=new Map([['pocket-pod-token',access]]),readyCalls=[];let hookCalls=[],cursor=0,values=[],dependencies=[],effects=[],cleanups=[];
const react={useRef:value=>{const i=cursor++;return values[i]??(values[i]={current:value});},useState:init=>{const i=cursor++;if(!(i in values))values[i]=typeof init==='function'?init():init;return[values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];},useEffect:(effect,deps)=>{const i=cursor++;if(!dependencies[i]||deps.some((v,j)=>v!==dependencies[i][j])){dependencies[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=effect();});}}};
const window=new EventTarget(),document=new EventTarget();document.hidden=false;
const clientFetch=async(url,init={})=>{hookCalls.push({url,method:init.method,body:init.body});if(url==='/api/comfy'){assert.equal(JSON.parse(init.body).action,'ready');return Response.json({ready:true});}return scope.exports.default(new Request('https://studio.test'+url,{...init,headers:{...init.headers,origin:'https://studio.test'}}));};
const clientScope={exports:{},require:name=>name==='react'?react:name==='./local-mode'?{isLocal:false,localStorage:{getItem:k=>browserStorage.get(k)||null,setItem:(k,v)=>browserStorage.set(k,v)}}:name==='./sync-preferences'?{sharePreference:()=>{}}:{},window,document,fetch:clientFetch,crypto:webcrypto,AbortSignal,setInterval:()=>1,clearInterval:()=>{},Event,Date};
vm.runInNewContext(ts.transpile(fs.readFileSync('src/PodControls.tsx','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}),clientScope);
function render(){cursor=0;const result=clientScope.exports.usePodControls({base:'',visible:true,onReady:base=>readyCalls.push(base),onStopped:()=>{}});for(const run of effects.splice(0))run();return result;}
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setTimeout(resolve,5));};
let controls=render();await settle();controls=render();assert.equal(controls.selected,'abc123');assert.ok(hookCalls.every(c=>c.method==='GET'),'Mount never changes power');await controls.action('start');controls=render();await settle();controls=render();assert.equal(readyCalls[0],'https://abc123-8188.proxy.runpod.net');assert.equal(hookCalls.filter(c=>c.method==='POST'&&c.url.includes('pod-control')).length,1);assert.ok(hookCalls.every(c=>!c.body||!['generate','bulk','resume'].includes(JSON.parse(c.body).action)),'Auto-connect never resumes or generates shots');
console.log('Client power flow verified: read-only mount, explicit Start, readiness auto-connect and no automatic generation.');

// Background worker tests use only the server; no mounted app, timers or browser.
const worker=watcherScope.exports;
let responseWallet=await call('GET',null,access,'https://studio.test','?account=1');
assert.deepEqual(Object.keys(await responseWallet.clone().json()).sort(),['balance','currency','rate','updatedAt']);assert.equal((await responseWallet.json()).balance,18.4);
const owner=await worker.credentialId(access),wk=worker.watchKey(owner,'abc123');
const done={status:{completed:true,status_str:'success'},outputs:{save:{gifs:[{filename:'film.mp4',type:'output'}]}}};
const failed={status:{completed:false,status_str:'error',messages:[['execution_error',{}]]},outputs:{}};
const stopCount=()=>calls.filter(c=>c.url.endsWith('/action')&&JSON.parse(c.body||'{}').action==='stop').length;
async function arm(){pod={...pod,status:'RUNNING',actions:['stop']};queueOffline=false;lateQueue=false;queueReads=0;queue={queue_running:[[0,'clip-a']],queue_pending:[[1,'clip-b']]};history={};const r=await call('POST',{id:'abc123',action:'watch_arm',port:8188});assert.equal(r.status,200);const d=await r.json();assert.equal(d.watch.state,'armed');assert.ok(!JSON.stringify(d).includes(access));return watches.get(wk).data.armedAt;}
let start=await arm(),beforeStop=stopCount();await worker.checkWatch(wk,start+1000);assert.equal(stopCount(),beforeStop);
queue={queue_running:[],queue_pending:[]};history={'clip-a':done,'clip-b':failed};
await worker.checkWatch(wk,start+2000);assert.equal(watches.get(wk).data.state,'idle');
await worker.checkWatch(wk,start+61000);assert.equal(stopCount(),beforeStop,'Wait for a second empty check at least 60 seconds later');
await Promise.all([worker.checkWatch(wk,start+63000),worker.checkWatch(wk,start+63000)]);assert.equal(stopCount(),beforeStop+1,'Concurrent workers stop exactly once');assert.equal(watches.get(wk).data.state,'stopped');assert.equal(watches.get(wk).data.access,'');
start=await arm();beforeStop=stopCount();queue={queue_running:[],queue_pending:[]};history={'clip-a':done};await worker.checkWatch(wk,start+1000);assert.equal(watches.get(wk).data.state,'attention');assert.equal(stopCount(),beforeStop,'Missing or paused queue entries never trigger auto-stop');
start=await arm();queue={queue_running:[],queue_pending:[]};history={'clip-a':done,'clip-b':{status:{status_str:'error',messages:[['execution_interrupted',{}]]}}};await worker.checkWatch(wk,start+1000);assert.equal(watches.get(wk).data.state,'attention');assert.equal(stopCount(),beforeStop,'Interrupted pause is different from a failed render');
start=await arm();queueOffline=true;await worker.checkWatch(wk,start+1000);assert.equal(watches.get(wk).data.state,'armed');assert.equal(stopCount(),beforeStop);queueOffline=false;
await call('POST',{id:'abc123',action:'watch_off'});queue={queue_running:[],queue_pending:[]};history={'clip-a':done,'clip-b':done};await worker.checkWatch(wk,start+120000);assert.equal(stopCount(),beforeStop,'Disarmed watcher cannot stop a pod');
start=await arm();queue={queue_running:[],queue_pending:[]};history={'clip-a':done,'clip-b':failed};await worker.checkWatch(wk,start+1000);queueReads=0;lateQueue=true;await worker.checkWatch(wk,start+62000);assert.equal(stopCount(),beforeStop,'Final queue recheck catches newly submitted work');assert.equal(watches.get(wk).data.state,'armed');lateQueue=false;
start=await arm();queue={queue_running:[],queue_pending:[]};history={'clip-a':done,'clip-b':failed};await worker.checkWatch(wk,start+1000);loseStopResponse=true;await worker.checkWatch(wk,start+62000);loseStopResponse=false;assert.equal(watches.get(wk).data.state,'stopping');assert.equal(stopCount(),beforeStop+1);await worker.checkWatch(wk,start+183000);assert.equal(watches.get(wk).data.state,'stopped');assert.equal(stopCount(),beforeStop+1,'Lost stop reply recovers with a read rather than another stop');
start=await arm();const summary=await(await call('GET',null,access,'https://studio.test','?pod=abc123')).json();assert.equal(summary.watch.state,'armed');assert.ok(!JSON.stringify(summary).includes(access));await call('DELETE');assert.equal(watches.get(wk).data.state,'off');assert.equal(watches.get(wk).data.access,'');
assert.equal((await call('POST',{id:'abc123',action:'watch_arm'})).status,401);
console.log('Server auto-stop verified without a browser: success + failed shots, live queue, two idle checks, concurrent leases, pause/missing protection, offline retry, disarm, final recheck, lost-reply recovery, credential removal and private DTOs.');
const jsx=(type,props)=>({type,props:props||{}});
const panelScope={exports:{},require:name=>name==='react'?{useEffect:()=>{},useRef:()=>({current:null})}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:{},Date,Number,Math};
vm.runInNewContext(ts.transpile(fs.readFileSync('src/RunPodStatus.tsx','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}),panelScope);
function nodes(node){return !node?[]:Array.isArray(node)?node.flatMap(nodes):typeof node==='object'?[node,...nodes(node.props?.children)]:[node];}
const mockService={wallet:{balance:18.4,rate:2.2,updatedAt:1},autoStop:{state:'armed',pod:'abc123',message:'Waiting'},selected:'abc123',selectedPod:{name:'Film GPU'},configured:true,busy:false};
const panel=panelScope.exports.default({service:mockService,connected:true,checking:false,open:true,onOpen:()=>{},onToggle:()=>{},onSettings:()=>{},disabled:false,queueBusy:false});
assert.ok(nodes(panel).includes('RunPod · 8h 21m left'));assert.equal(nodes(panel).find(n=>n.props?.['aria-label']==='Auto-stop pod after queue finishes').props.checked,true);
assert.equal(panelScope.exports.walletHours(5,0),'');assert.equal(panelScope.exports.walletHours(-1,2),'0h 0m left');
console.log('Quick panel verified: compact balance hours, armed switch, zero-rate and exhausted-balance display.');

for(const [balance,rate,warn] of [[9.99,2,true],[10,2,false],[0,2,true],[10,0,false]]){
 const result=panelScope.exports.default({service:{...mockService,wallet:{balance,rate,updatedAt:1}},connected:true,checking:false,open:false,onOpen:()=>{}});
 const button=nodes(result).find(n=>n.type==='button');assert.equal(button.props.className.includes('wallet-low'),warn,'Low-time signal threshold');
}
console.log('Wallet alert verified: below five hours red, exactly five hours normal, zero spend excluded, no approximate prefix.');

let quickStarts=[];
const quickProps={service:{...mockService,port:'8188',selectedPod:{id:'last-selected',name:'Last selected GPU',status:'EXITED',actions:['start']},action:async value=>quickStarts.push(value)},connected:false,checking:false,open:true,onOpen:()=>{},onToggle:()=>{},onSettings:()=>{},disabled:false,queueBusy:false};
const quickPanel=panelScope.exports.default(quickProps),quickButton=nodes(quickPanel).find(n=>n.props?.className==='button primary');
assert.equal(quickButton.props.disabled,false);quickButton.props.onClick();assert.deepEqual(quickStarts,['start']);assert.ok(!nodes(quickPanel).some(n=>n.type==='select'),'Quick panel does not expose pod selection/settings');
const runningPanel=panelScope.exports.default({...quickProps,service:{...quickProps.service,selectedPod:{...quickProps.service.selectedPod,status:'RUNNING',actions:['stop']}}});assert.equal(nodes(runningPanel).find(n=>n.props?.className==='button primary').props.disabled,true);
console.log('Quick Start verified: explicit Start action, no pod picker, and disabled for an already-running pod.');
