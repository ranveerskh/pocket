import assert from 'node:assert/strict';
import {mergeSync, newPairCode, openSnapshot, pairKeys, sealSnapshot} from '../src/device-sync-model.ts';

const empty = {folders: [], jobs: [], characters: []};
const initial = {version: 1, records: [], hidden: []};
const base = 'https://test-8188.proxy.runpod.net';
const folder = {id:'demo', name:'Night Shift'};
const clip = {
  id:'shot-1', base, folder:'demo', prompt:'SCENE 05A — The reveal', state:'complete',
  duration:5, seed:42, aspect:'landscape', quality:'draft', created:1,
  files:[{filename:'test.mp4',subfolder:'video',type:'output'}],
  autoCopyPending:true,
};
const original = {folders:[folder],jobs:[clip,{...clip,id:'private',hidden:true,prompt:'PRIVATE'}],characters:[]};
const uploaded = await mergeSync(original, initial, {});
assert.equal(uploaded.snapshot.records.length,2);
assert.deepEqual(uploaded.snapshot.hidden,[]);
assert.equal(uploaded.snapshot.records[1].item.autoCopyPending,undefined);
const pairing = newPairCode();
const {key,token} = await pairKeys(pairing);
assert.match(token,/^[0-9a-f]{64}$/);
const sealed = await sealSnapshot(uploaded.snapshot,key);
assert.ok(!sealed.includes('Night Shift') && !sealed.includes(base));
await assert.rejects(openSnapshot(sealed,(await pairKeys(newPairCode())).key));
const decoded = await openSnapshot(sealed,key);
const laptop = await mergeSync(empty,decoded,{});
assert.equal(laptop.incoming.jobs[0].base,base);
assert.equal(laptop.incoming.jobs[0].files[0].filename,'test.mp4');
assert.equal(laptop.changed,false);
const rename = await mergeSync({...laptop.incoming,folders:[{...folder,name:'Night Shift 2'}]},decoded,laptop.seen);
assert.equal(rename.changed,true);
const phone = await mergeSync(original,rename.snapshot,uploaded.seen);
assert.equal(phone.incoming.folders[0].name,'Night Shift 2');
const removed = await mergeSync({...laptop.incoming,jobs:[]},decoded,laptop.seen);
assert.equal(removed.incoming.jobs.length,0);
assert.equal(removed.snapshot.records.length,2);
const hide = await mergeSync({...original,jobs:[{...clip,hidden:true}]},decoded,uploaded.seen);
assert.deepEqual(hide.snapshot.hidden,['shot-1']);
assert.equal(hide.snapshot.records.some(record=>record.kind==='jobs'),false);
console.log('Device sync verified: encryption, two-device merge, RunPod output links, local removal and Hidden exclusion.');

// A submitted job reaches the second device before any output files exist.
const running={...clip,id:'active-1',state:'running',files:undefined,startedAt:1000,timingSource:'server',queueSeconds:2,referenceUsed:true,referenceProfile:'i2-a0',durationMapped:true};
const queued={...running,id:'active-2',state:'queued',startedAt:undefined,queuePosition:1};
const staged={...queued,id:'pending-batch-0',state:'staging'};
const a=await mergeSync({folders:[folder],jobs:[running,queued,staged],characters:[]},initial,{});
assert.equal(a.snapshot.records.filter(r=>r.kind==='jobs').length,2);
const b=await mergeSync(empty,await openSnapshot(await sealSnapshot(a.snapshot,key),key),{});
assert.equal(b.incoming.jobs.find(j=>j.id===running.id).state,'running');
assert.equal(b.incoming.jobs.find(j=>j.id===queued.id).queuePosition,1);
assert.equal(b.incoming.jobs.find(j=>j.id===running.id).startedAt,1000);
const finished={...running,state:'complete',files:clip.files,elapsedSeconds:75,completedAt:76000};
const done=await mergeSync({folders:[folder],jobs:[finished,queued],characters:[]},a.snapshot,a.seen);
const stalePhone=await mergeSync(b.incoming,done.snapshot,b.seen);
assert.equal(stalePhone.snapshot.records.find(r=>r.kind==='jobs'&&r.item.id===running.id).item.state,'complete');
assert.equal(stalePhone.incoming.jobs.find(j=>j.id===running.id).elapsedSeconds,75);
assert.equal(stalePhone.incoming.jobs.find(j=>j.id===running.id).autoCopyPending,undefined);
assert.equal(stalePhone.incoming.jobs.find(j=>j.id===running.id).referenceProfile,'i2-a0');
const staleQueued=await mergeSync({folders:[],characters:[],jobs:[{...running,state:'queued'}]},a.snapshot,{});
assert.equal(staleQueued.snapshot.records.find(r=>r.kind==='jobs'&&r.item.id===running.id).item.state,'running');
console.log('RunPod live queue sync verified: submitted IDs only, running/queued status, timing, completion and stale peer protection.');
