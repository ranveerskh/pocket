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
