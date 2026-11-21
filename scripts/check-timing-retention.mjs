import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import * as timing from '../src/timing.ts';
const base={id:'clip',base:'https://pod.proxy.runpod.net',device:'NVIDIA RTX 5090',mode:'video',workflowId:'builtin-r2v',state:'complete',prompt:'Scene',created:1,seed:1,duration:6,quality:'high',aspect:'landscape',referenceUsed:true,referenceProfile:'i1-a0',timingSource:'server',elapsedSeconds:100,completedAt:100};
const jobs=Array.from({length:45},(_,i)=>({...base,id:'bucket-'+i,duration:i+1,completedAt:i+1}));
const cache=timing.mergeTimingSamples([],jobs);assert.equal(cache.length,45,'More than 32 setting combinations survive');assert.equal(timing.timingStats([],jobs[0],cache).average,100);
assert.equal(timing.pruneTimingHistory(jobs)[0].elapsedSeconds,100,'Gallery pruning must not strip an older setting just because 32 newer settings exist');
let stats=timing.timingStats([base],{...base,state:'running',referenceProfile:'i3-a0'});assert.equal(stats.average,100);assert.equal(stats.similar,true);
assert.equal(timing.timingStats([base],{...base,duration:8,referenceProfile:'i3-a0'}),null,'Different duration cannot silently become the same average');
assert.equal(timing.timingStats([base],{...base,quality:'balanced',referenceProfile:'i3-a0'}),null);
assert.equal(timing.timingStats([base],{...base,device:'RTX 4050',referenceProfile:'i3-a0'}),null);
assert.equal(timing.timingStats([base],{...base,turbo:true,referenceProfile:'i3-a0'}),null);
stats=timing.timingStats([base,{...base,id:'exact',referenceProfile:'i3-a0',elapsedSeconds:160}],{...base,referenceProfile:'i3-a0'});assert.equal(stats.average,160);assert.equal(stats.similar,false,'Exact matches take precedence over fallback');
const many=Array.from({length:12},(_,i)=>({...base,id:'sample-'+i,completedAt:100+i,elapsedSeconds:i}));assert.equal(timing.timingStats(many,base).count,5);
// Two timing panels with stale state must merge rather than overwrite the cache.
const map=new Map(),storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)},window=new EventTarget();
function panel(){let values=[],deps=[],cleanups=[],cursor=0,effects=[];const react={useState:init=>{const i=cursor++;if(!(i in values))values[i]=typeof init==='function'?init():init;return[values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];},useEffect:(effect,d)=>{const i=cursor++;if(!deps[i]||d.some((v,j)=>v!==deps[i][j])){deps[i]=d;effects.push(()=>{cleanups[i]?.();cleanups[i]=effect();});}}};const scope={exports:{},require:name=>name==='react'?react:name==='./local-mode'?{localStorage:storage,isLocal:false}:timing,window,Event,JSON};vm.runInNewContext(ts.transpile(fs.readFileSync('src/useTimingHistory.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),scope);return{render:jobs=>{cursor=0;const result=scope.exports.useTimingHistory(jobs);for(const run of effects.splice(0))run();return result;},current:()=>values[0]};}
const first=panel(),second=panel();first.render([]);second.render([]);first.render([base]);second.render([{...base,id:'eight-sec',duration:8}]);assert.equal(timing.readTimingSamples(storage).length,2,'A stale mounted panel preserves another panel’s new history');assert.equal(first.current().length,2,'Mounted panels receive cache updates');
const restored=panel();assert.equal(restored.render([]).length,2,'History survives reopening without gallery timing fields');
console.log('Timing retention verified: 45 settings, latest five per setting, labelled reference-count fallback, strict duration/quality/GPU matching, multiple panels and reload.');
