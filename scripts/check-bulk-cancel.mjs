import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function compile(path, modules) {
  const compiled = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022},
  }).outputText;
  const scope = {exports:{}, require:name => {
    if (!modules[name]) throw Error('Unexpected import ' + name);
    return modules[name];
  }, Request, Response, URL, FormData, File, Set, Map, console};
  vm.runInNewContext(compiled, scope);
  return scope.exports;
}
const base = 'https://test-8188.proxy.runpod.net';
let pending = [], running = [], history = {}, mutations = [], offline = false, failInterrupt = false, delayed = false;
const entry = (id, batch, index) => [index, id, {}, {pocket_batch_id:batch, pocket_item_index:index}, []];
const comfy = {
  runpodURL:value => value,
  jsonUp:async (_, path) => {
    if (offline) throw Error('Pod offline');
    if (path === '/queue') return structuredClone({queue_running:running, queue_pending:pending});
    if (path === '/history?max_items=500') return structuredClone(history);
    throw Error('Unexpected read ' + path);
  },
  upstream:async (_, path, options) => {
    const body = JSON.parse(options.body);
    mutations.push({path, body});
    if (path === '/queue') {
      assert.ok(!body.clear, 'Bulk cancellation must target batch IDs');
      pending = pending.filter(item => !body.delete.includes(item[1]));
      return new Response(null, {status:200});
    }
    if (path === '/interrupt') {
      if (failInterrupt) return new Response(null, {status:500});
      assert.ok(body.prompt_id, 'Interrupt must name the running target');
      if (!delayed) running = running.filter(item => item[1] !== body.prompt_id);
      return new Response(null, {status:200});
    }
    throw Error('Unexpected mutation ' + path);
  },
  videoFiles:entry => entry.files || [],
  historyTiming:() => ({}),
};
const route = compile('netlify/edge-functions/comfy.ts', {
  '../../server/comfy.ts':comfy, '../../server/pod-storage.ts':{},
}).default;
async function cancel(batch_ids) {
  return route(new Request('https://studio.test/api/comfy', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({base, action:'cancel_batches', batch_ids}),
  }));
}
const mergeJobStatus = (job, status) => ({...job, ...status});
const model = compile('src/bulk-cancel.ts', {'./timing':{mergeJobStatus}});
const jobs = Array.from({length:50}, (_, index) => ({
  id:'shot-' + index, base, batchId:'film', batchIndex:index,
  state:index < 4 ? 'complete' : index === 4 ? 'running' : 'queued',
  files:index < 4 ? [{filename:'saved-' + index + '.mp4',subfolder:'video',type:'output'}] : undefined,
  cancelRequested:index >= 4,
}));
for (const job of jobs.slice(0, 4)) history[job.id] = {prompt:entry(job.id,'film',job.batchIndex),status:{completed:true,status_str:'success'},files:job.files};
running = [entry('shot-4','film',4)];
pending = [...jobs.slice(5).map(job => entry(job.id,'film',job.batchIndex)),entry('unrelated','other-batch',0)];
let response = await cancel(['film']);
assert.equal(response.status,200);
let result = await response.json();
assert.equal(running.length,0);
assert.deepEqual(pending.map(item => item[1]),['unrelated']);
assert.equal(mutations.filter(item => item.path === '/interrupt').length,1);
const updated = jobs.map(job => model.applyBatchCancellation(job,base,result));
assert.equal(updated.filter(job => job.state === 'cancelled').length,46);
assert.equal(updated.filter(job => job.state === 'complete').length,4);
for (let index = 0; index < 4; index++) assert.equal(updated[index],jobs[index]);
assert.ok(updated.every(job => !job.cancelRequested));
response = await cancel(['film']);
assert.equal(response.status,200);
assert.equal(mutations.filter(item => item.path === '/interrupt').length,1);
assert.equal(model.applyBatchCancellation(jobs[4],'https://another-pod',result),jobs[4]);
assert.equal(model.applyBatchCancellation({...jobs[4],batchId:'other-batch'},base,result).cancelRequested,true);

running = [entry('slow-stop','slow-batch',0)];
delayed = true;
result = await (await cancel(['slow-batch'])).json();
const slow = model.applyBatchCancellation({id:'slow-stop',base,batchId:'slow-batch',batchIndex:0,state:'running',cancelRequested:true},base,result);
assert.equal(slow.state,'running');
assert.equal(slow.cancelRequested,true);
delayed = false;
result = await (await cancel(['slow-batch'])).json();
assert.equal(model.applyBatchCancellation(slow,base,result).state,'cancelled');

running = [entry('retry-running','retry-batch',0)];
pending = [entry('retry-pending','retry-batch',1)];
failInterrupt = true;
assert.equal((await cancel(['retry-batch'])).status,400);
assert.equal(pending.length,0);
assert.equal(running.length,1);
failInterrupt = false;
assert.equal((await cancel(['retry-batch'])).status,200);
assert.equal(running.length,0);

offline = true;
const before = mutations.length;
assert.equal((await cancel(['offline-batch'])).status,400);
assert.equal(mutations.length,before);
offline = false;
assert.equal((await cancel(['bad batch id'])).status,400);
assert.equal((await cancel([])).status,400);

running = [entry('other-running','other-batch',0)];
pending = [entry('target-pending','target-batch',0)];
const interruptsBefore = mutations.filter(item => item.path === '/interrupt').length;
assert.equal((await cancel(['target-batch'])).status,200);
assert.equal(running[0][1],'other-running');
assert.equal(mutations.filter(item => item.path === '/interrupt').length,interruptsBefore);

const recovered = {id:'pending-recovery',base,batchId:'race',batchIndex:2,state:'submission_unknown',cancelRequested:true};
result = {batch_ids:['race'],items:[{id:'real-id',batchId:'race',index:2,state:'complete',files:[{filename:'finished.mp4'}]}]};
const completed = model.applyBatchCancellation(recovered,base,result);
assert.equal(completed.id,'real-id');
assert.equal(completed.state,'complete');
assert.equal(completed.files[0].filename,'finished.mp4');
assert.equal(completed.cancelRequested,undefined);
console.log('Passed bulk cancellation of 46 shots, retained completed media, batch/pod isolation, targeted interruption, delayed stopping, partial failure/retry, offline failure and completion races.');
