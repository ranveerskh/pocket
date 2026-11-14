import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
function compile(file,imports={}){const scope={exports:{},require:name=>imports[name]||{},Date,Map,Set,Number,Math};vm.runInNewContext(ts.transpile(fs.readFileSync(file,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}),scope);return scope.exports;}
const gallery=compile('src/gallery-model.ts');
function harness(local=true){
 const storage=new Map(),slots=[],effects=[],frames=new Map(),elements=new Map(),scrolls=[];let cursor=0,dirty=false,tree,frameId=0;
 const depsChanged=(a,b)=>!a||b.some((x,i)=>!Object.is(x,a[i]));
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useMemo(fn,deps){const i=cursor++;if(depsChanged(slots[i]?.deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},useEffect(fn,deps){const i=cursor++;if(depsChanged(slots[i]?.deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});}}};
 const jsx=(type,props)=>({type,props:props||{}});
 const imports={'react':react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-dom':{createPortal:x=>x},'./local-mode':{isLocal:local,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}},'./gallery-model':gallery,'./timing':{mergeTimingSamples:()=>[],timingBucket:()=>''},'./useTimingHistory':{useTimingHistory:()=>[]},'./bulk-cancel':{canCancelBulk:()=>false}};
 const scope={exports:{},require:name=>imports[name]||{},Date,Map,Set,Number,Math,setInterval:()=>1,clearInterval:()=>{},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),document:{body:{style:{}},activeElement:null,querySelector:()=>null,getElementById:id=>elements.get(id)},window:{addEventListener:()=>{},removeEventListener:()=>{},matchMedia:()=>({matches:true})}};
 vm.runInNewContext(ts.transpile(fs.readFileSync('src/ProjectWorkspace.tsx','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}),scope);
 function all(node){if(arguments.length===0)node=tree;if(!node)return[];if(Array.isArray(node))return node.flatMap(x=>all(x));if(typeof node!=='object')return[];return[node,...all(node.props?.children)];}
 function render(props){for(let n=0;n<40;n++){dirty=false;cursor=0;tree=scope.exports.default(props);elements.clear();for(const node of all())if(node.props?.id)elements.set(node.props.id,{scrollIntoView:()=>scrolls.push(node.props.id)});effects.splice(0).forEach(fn=>fn());if(dirty)continue;const next=[...frames.values()];frames.clear();next.forEach(fn=>fn());if(!dirty)return;}throw Error('Render loop');}
 return{render,all,storage,scrolls};
}
const noop=()=>{};let consumed=0;
const props={jobs:Array.from({length:30},(_,i)=>({id:'old-'+i,prompt:'Old image '+i,created:i+1,state:'complete',mode:'image',files:[]})),folders:[],folder:'',bulk:false,busy:false,composer:null,onFolder:noop,onMode:noop,onProjects:noop,onManage:noop,onReuse:noop,onCancel:async()=>{},cancelling:[],onCancelBulk:async()=>{},bulkCancelBusy:false,bulkCancelMessage:'',onReference:noop,onRecover:noop,recovering:false,onFocusConsumed:()=>consumed++};
const h=harness();h.render(props);
const by=(predicate)=>h.all().find(predicate);
const compose=()=>by(n=>n.props?.className==='button primary local-mobile-compose').props.onClick();
compose();h.render(props);assert.ok(by(n=>n.props?.className==='workspace-composer composer-mobile-open'));
h.render({...props,busy:true});h.render(props);assert.ok(by(n=>n.props?.className==='workspace-composer composer-mobile-open'),'A failed submission leaves composer open');
by(n=>n.props?.['aria-label']==='Sort scenes').props.onChange({target:{value:'oldest'}});h.render(props);assert.equal(h.storage.get('pocket-workspace-sort'),'oldest');
by(n=>n.props?.['aria-label']==='Find a scene').props.onChange({target:{value:'no match'}});h.render(props);
const job={id:'new-image',prompt:'New image',created:100,state:'queued',mode:'image',files:[]};
const next={...props,jobs:[job,...props.jobs],focusJobKey:'new-image'};h.render(next);
assert.ok(!by(n=>n.props?.className==='workspace-composer composer-mobile-open'));
assert.ok(by(n=>n.props?.id==='shot-new-image'),'New submission beyond the first page is revealed');
assert.equal(h.scrolls.at(-1),'shot-new-image');assert.equal(consumed,1);
h.render({...next,focusJobKey:undefined});assert.equal(consumed,1);
by(n=>n.props?.['aria-label']==='Sort scenes').props.onChange({target:{value:'newest'}});h.render({...next,focusJobKey:undefined});
const articles=h.all().filter(n=>n.type==='article');assert.equal(articles[0].props.id,'shot-new-image');
assert.equal(h.storage.get('pocket-workspace-sort'),'newest');
compose();h.render({...next,focusJobKey:undefined});const batch={...job,id:'pending-batch-0',batchId:'batch',batchIndex:0,state:'staging',created:200};h.render({...props,jobs:[batch,...next.jobs],bulk:true,busy:true});assert.ok(by(n=>n.props?.className==='workspace-composer composer-mobile-open'),'Bulk placeholders alone do not close the composer');const accepted={...batch,id:'accepted-batch-0',state:'queued'};h.render({...props,jobs:[accepted,...next.jobs],bulk:true,focusJobKey:'batch:0'});assert.equal(h.scrolls.at(-1),'shot-batch:0');assert.ok(!by(n=>n.props?.className==='workspace-composer composer-mobile-open'));
console.log('Workspace focus verified: failed submission stays open, successful submission closes and reveals its paginated card through search, one-time scroll, and persisted chronological sorting.');

for(const local of [true]){
 const view=harness(local);
 const clips=Array.from({length:30},(_,i)=>({id:'scene-'+i,prompt:'SCENE '+String(i+1).padStart(2,'0'),created:i+1,state:'complete',files:[{filename:i+'.mp4',subfolder:'video',type:'output'}]}));
 const project={...props,jobs:clips};view.render(project);
 const find=(fn)=>view.all().find(fn);
 assert.ok(find(n=>n.props?.['aria-label']==='Scene layout'));assert.ok(find(n=>n.props?.['aria-label']==='Sort scenes'));
 find(n=>n.props?.['aria-label']==='Play Scene 01'||n.props?.['aria-label']==='Preview Scene 01')?.props.onClick();
 // Use the first thumbnail regardless of the scene label formatting.
 if(!find(n=>n.props?.role==='dialog')){find(n=>n.props?.className==='shot-preview-button').props.onClick();view.render(project);}else view.render(project);
 assert.ok(find(n=>n.props?.role==='dialog'));
 assert.equal(find(n=>n.props?.['aria-label']==='Previous scene').props.disabled,true);
 for(let i=0;i<26;i++){find(n=>n.props?.['aria-label']==='Next scene').props.onClick();view.render(project);}
 assert.equal(find(n=>n.props?.preview===true).props.job.id,'scene-26','Next traverses all scenes, including unloaded cards');
 find(n=>n.props?.['aria-label']==='Close preview').props.onClick();view.render(project);
 assert.ok(find(n=>n.props?.id==='shot-scene-26'));assert.equal(view.scrolls.at(-1),'shot-scene-26','Close returns to current scene instead of the top');
 console.log((local?'Local':'RunPod')+' player navigation, shared sort/layout and return to paginated scene verified.');
}

const runpod=harness(false);runpod.render(props);assert.ok(!runpod.all().some(n=>n.props?.['aria-label']==='Sort scenes'));assert.ok(runpod.all().some(n=>n.props?.className==='button primary workspace-mobile-compose'));console.log('RunPod workspace stays on its published implementation.');
