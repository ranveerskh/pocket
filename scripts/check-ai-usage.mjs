import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
const stores=new Map();let rev=0,sequence=0,failLedger=false;
const getStore=({name})=>{if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);return {
 get:async key=>structuredClone(map.get(key)?.data||null),getWithMetadata:async key=>structuredClone(map.get(key)||null),delete:async key=>map.delete(key),
 setJSON:async(key,data,options={})=>{if(failLedger&&name.includes('usage'))throw Error('Simulated storage failure');const old=map.get(key);if(options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return{modified:false};map.set(key,{data:structuredClone(data),etag:String(++rev)});return{modified:true};}
};};
const mockFetch=async(url)=>{if(url.includes('/models/'))return Response.json({id:'gpt-6-luna'});assert.ok(url.endsWith('/responses'));return Response.json({id:'response-'+ ++sequence,output:[{content:[{type:'output_text',text:'Improved scene'}]}],usage:{input_tokens:1000,input_tokens_details:{cached_tokens:200},output_tokens:100}});};
const scope={exports:{},require:()=>({getStore}),crypto:webcrypto,Response,Request,URL,TextEncoder,TextDecoder,Uint8Array,Date,AbortSignal,fetch:mockFetch};
vm.runInNewContext(ts.transpile(fs.readFileSync('netlify/functions/prompt-assistant.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),scope);
const token='a'.repeat(64),key='sk-'+ 'testonly'.repeat(6);
const call=(method,body,auth=token)=>scope.exports.default(new Request('https://studio.test/.netlify/functions/prompt-assistant',{method,headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}));
assert.equal((await call('GET',null,'bad')).status,401);
assert.equal((await (await call('GET')).json()).configured,false);
assert.equal((await call('PUT',{key})).status,200);
assert.ok(!JSON.stringify([...stores.get('pocket-ai-credentials-v1')]).includes(key),'Stored key is encrypted');
const results=await Promise.all(Array.from({length:4},()=>call('POST',{prompt:'A woman walking',context:'video'})));
for(const result of results){const data=await result.json();assert.equal(data.text,'Improved scene');assert.equal(data.usageSaved,true);assert.ok(Math.abs(data.usage.cost-.000132)<1e-10);}
let status=await(await call('GET')).json();assert.equal(status.summary.count,4);assert.equal(status.summary.input,4000);assert.equal(status.summary.cached,800);assert.equal(status.summary.output,400);assert.ok(Math.abs(status.summary.cost-.000528)<1e-10);
failLedger=true;const unsaved=await(await call('POST',{prompt:'Scene'})).json();assert.equal(unsaved.text,'Improved scene');assert.equal(unsaved.usageSaved,false);failLedger=false;
await call('DELETE');status=await(await call('GET')).json();assert.equal(status.configured,false);assert.equal(status.summary.count,4,'Removing a key keeps cost history');assert.equal((await call('POST',{prompt:'Scene'})).status,401);
console.log('AI usage verified with mocks: encrypted key, concurrent shared totals, actual cached-token cost, removal across devices and usage-storage failure retains result. No live API requests.');
