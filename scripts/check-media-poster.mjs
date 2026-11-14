import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import assert from 'node:assert/strict';
function setup({local=true,saved=false,read=async()=>null}={}){
 let cursor=0,dirty=false,tree;const slots=[],effects=[];let revoked=0,reads=0;
 const media={saved:new Set(saved?['key']:[]),changes:{},read:async(...args)=>{reads++;return read(...args);}};
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>{if(next!==slots[i]){slots[i]=next;dirty=true;}}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:{}});},useEffect(fn,deps){const i=cursor++;if(!slots[i]||deps.some((v,n)=>!Object.is(slots[i].deps[n],v))){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});}}};
 const jsx=(type,props)=>({type,props:props||{}});
 const scope={exports:{},require:name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='./LocalMedia'?{useDeviceMedia:()=>media}:name==='./media-db'?{mediaKey:()=> 'key',remoteMediaURL:(base,file)=>base+'/view?filename='+file.filename}:name==='./local-mode'?{isLocal:local}:{},URL:{createObjectURL:()=> 'blob:saved',revokeObjectURL:()=>revoked++}};
 vm.runInNewContext(ts.transpile(fs.readFileSync('src/MediaPoster.tsx','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}),scope);
 function render(job){for(let n=0;n<20;n++){dirty=false;cursor=0;tree=scope.exports.default({job});effects.splice(0).forEach(fn=>fn());if(!dirty)return tree;}throw Error('Loop');}
 return{render,media,get reads(){return reads;},get revoked(){return revoked;}};
}
const job={id:'one',base:'https://pc.tail123.ts.net',mode:'image',files:[{filename:'photo.png',type:'output'}]};
let h=setup();let tree=h.render(job);assert.equal(tree.props.children.type,'img');assert.equal(tree.props.children.props.src,job.base+'/view?filename=photo.png');assert.equal(h.reads,0,'Remote fallback must not download full files to build thumbnails');
h=setup();tree=h.render({...job,mode:'video',files:[{filename:'clip.mp4'}]});assert.equal(tree.props.children.type,'video');assert.equal(tree.props.children.props.preload,'metadata');assert.equal(tree.props.children.props.playsInline,true);assert.equal(tree.props.children.props.autoPlay,undefined);
h=setup();tree=h.render({...job,files:[{filename:'photo.png',podDeleted:true}]});assert.notEqual(tree.props.children.type,'img');
h=setup({local:false});tree=h.render(job);assert.notEqual(tree.props.children.type,'img','RunPod posters retain their published behavior');
h=setup({saved:true,read:async()=>new Blob(['image'],{type:'image/png'})});h.render(job);await new Promise(resolve=>setImmediate(resolve));tree=h.render(job);assert.equal(tree.props.children.props.src,'blob:saved');
console.log('Poster checks passed: visible PC image fallback without full-file copying, inline metadata-only video, deleted-file exclusion, RunPod poster recovery and saved-image preference.');
