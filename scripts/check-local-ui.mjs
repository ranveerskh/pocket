import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import assert from 'node:assert/strict';
const data=new Map();
globalThis.location={pathname:'/local'};
globalThis.window={localStorage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)}};
const vite=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {default:ThemeSettings,useTheme}=await vite.ssrLoadModule('/src/ThemeSettings.tsx');
 function Appearance(){const service=useTheme();return React.createElement(ThemeSettings,{service});}
 let html=renderToStaticMarkup(React.createElement(Appearance));
 for(const label of ['Ocean','Midnight','Forest','Cloud','Sand','Mint'])assert.ok(html.includes(label));
 assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
 data.set('local:pocket-theme','sand');
 html=renderToStaticMarkup(React.createElement(Appearance));
 assert.match(html,/aria-pressed="true"[^>]*>[\s\S]*?Sand/);
 const {default:Workspace}=await vite.ssrLoadModule('/src/ProjectWorkspace.tsx');
 const noop=()=>{};
 const props={jobs:[],folders:[],folder:'',bulk:false,busy:false,composer:React.createElement('div',null,'Editor'),onFolder:noop,onMode:noop,onProjects:noop,onManage:noop,onReuse:noop,onCancel:async()=>{},cancelling:[],onCancelBulk:async()=>{},bulkCancelBusy:false,bulkCancelMessage:'',onReference:noop,onRecover:noop,recovering:false};
 html=renderToStaticMarkup(React.createElement(Workspace,props));
 assert.ok(html.includes('local-mobile-compose'));assert.ok(html.includes('aria-label="Scene layout"'));assert.ok(html.includes('2 columns'));assert.ok(html.includes('3 columns'));
 data.set('local:pocket-scene-columns','2');
 html=renderToStaticMarkup(React.createElement(Workspace,props));
 assert.ok(html.includes('data-columns="2"'));
 console.log('Local UI checks passed: six theme choices, saved preference, mobile composer and persisted scene columns.');
}finally{await vite.close();}
