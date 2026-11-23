import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import assert from 'node:assert/strict';
import * as model from '../src/reference-import.ts';
const file=name=>new File(['photo'],name,{type:'image/png'});
assert.equal(model.photoName('Martha_Present.png'),'Martha Present');
assert.equal(model.photoErrors([{id:'x',name:' Martha ',file:file('a.png'),state:'ready'}],['martha']).size,1);
assert.equal(model.photoErrors([{id:'x',name:'A',file:file('a.png'),state:'ready'},{id:'y',name:'a',file:file('b.png'),state:'ready'}],[]).size,2);
assert.equal(model.photoErrors([{id:'x',name:'Martha',file:file('a.png'),state:'saved'}],['Martha']).size,0);
assert.equal(model.photoErrors([{id:'x',name:'A',file:new File(['x'],'bad.heic',{type:'image/heic'}),state:'ready'}],[]).size,1);
let next=0,cursor=0,slots=[],deps=[],effects=[],tree,props;const cleanups=[];
const jsx=(type,props)=>({type,props:props||{}}),react={useRef:init=>{const i=cursor++;return slots[i]??(slots[i]={current:init});},useState:init=>{const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},useEffect:(fn,d)=>{const i=cursor++;if(!deps[i]||d.some((v,j)=>v!==deps[i][j])){deps[i]=d;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}}};
const scope={exports:{},require:name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='./reference-import'?model:name==='./gallery-model'?{localId:()=>String(++next)}:{},AbortController,navigator:{clipboard:{readText:async()=> 'Pasted character'}},File,URL};
vm.runInNewContext(ts.transpile(fs.readFileSync('src/MultiReferenceUpload.tsx','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}),scope);
function render(){cursor=0;tree=scope.exports.default(props);effects.splice(0).forEach(fn=>fn());return tree;}
function nodes(node){if(arguments.length===0)node=tree;return !node?[]:Array.isArray(node)?node.flatMap(x=>nodes(x)):typeof node==='object'?[node,...nodes(node.props?.children)]:[node];}
const input=()=>nodes().find(n=>n.type==='input'&&n.props.type==='file');
const save=()=>nodes().find(n=>n.type==='button'&&n.props.className==='button primary');
const records=[],busy=[];props={base:'https://pod-a-8188.proxy.runpod.net',connected:true,locked:false,disabled:false,characters:[],onSave:c=>{records.push(c);props={...props,characters:[...props.characters,c]};render();},onBusy:v=>busy.push(v),onClose:()=>{}};
render();render();assert.equal(input().props.multiple,true);
input().props.onChange({target:{files:Array.from({length:11},(_,i)=>file('Character_'+(i+1)+'.png')),value:'photos'}});render();assert.equal(save().props.disabled,false);
let active=0,maxActive=0,requests=[],fail=true;const previousFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{active++;maxActive=Math.max(maxActive,active);const photo=init.body.get('image');requests.push({name:photo.name,base:init.body.get('base')});await Promise.resolve();active--;if(photo.name==='Character_5.png'&&fail)return Response.json({error:'Upload failed'},{status:502});return Response.json({name:photo.name,subfolder:'refs'});};
try{
 await save().props.onClick();render();assert.equal(records.length,10);assert.equal(maxActive,1);assert.equal(requests.length,11);assert.equal(busy.at(-1),false);
 fail=false;await save().props.onClick();render();assert.equal(records.length,11);assert.equal(requests.length,12,'Retry uploads only the failed photo');assert.equal(new Set(records.map(c=>c.id)).size,11);assert.equal(records[0].name,'Character 1');assert.ok(records.every(c=>c.base===props.base));
 // A connection change while upload is waiting must not save to the new connection.
 props={...props,base:'https://pod-b-8188.proxy.runpod.net'};render();render();
 input().props.onChange({target:{files:[file('New.png')],value:''}});render();
 let release;globalThis.fetch=async()=>new Promise(resolve=>release=()=>resolve(Response.json({name:'New.png'})));
 const pending=save().props.onClick();props={...props,base:'https://pod-c-8188.proxy.runpod.net'};render();release();await pending;render();assert.equal(records.length,11,'Connection change aborts before creating a reference record');
}finally{globalThis.fetch=previousFetch;cleanups.forEach(fn=>fn?.());}
console.log('Reference import verified: 11-photo batch, sequential uploads, filename names, duplicate validation, failed-only retry, stable records and connection-change abort. No live uploads.');
