import {useEffect,useRef,useState} from 'react';
import {localStorage} from './local-mode';
import './ai-assistant.css';
const TOKEN='pocket-ai-token',USAGE='pocket-ai-usage';
function savedToken(){return localStorage.getItem(TOKEN)||'';}
function newToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');}
async function request(token:string,method:string,body?:unknown){const r=await fetch('/.netlify/functions/prompt-assistant',{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw new Error(d.error||'AI service unavailable.');return d;}
export function usePromptAssistant(){
 const [configured,setConfigured]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
 const [usage,setUsage]=useState<any[]>(()=>{try{return JSON.parse(localStorage.getItem(USAGE)||'[]');}catch{return [];}});
 const [storageError,setStorageError]=useState('');
 useEffect(()=>{const token=savedToken();if(token)void request(token,'GET').then(d=>setConfigured(!!d.configured)).catch(()=>{});},[]);
 async function save(key:string){setPending(true);setError('');try{const token=savedToken()||newToken();localStorage.setItem(TOKEN,token);await request(token,'PUT',{key});setConfigured(true);}catch(e){setError((e as Error).message);}finally{setPending(false);}}
 async function remove(){setPending(true);setError('');try{await request(savedToken(),'DELETE');localStorage.removeItem(TOKEN);setConfigured(false);}catch(e){setError((e as Error).message);}finally{setPending(false);}}
 async function improve(prompt:string,context:string){const d=await request(savedToken(),'POST',{prompt,context});if(d.usage){setUsage(previous=>{const next=[...previous.filter(x=>x.at>Date.now()-370*86400000),{...d.usage,id:d.id,at:Date.now()}];try{localStorage.setItem(USAGE,JSON.stringify(next));}catch{setStorageError('Usage could not be saved on this browser.');}return next;});}if(d.error)throw new Error(d.error);return d.text as string;}
 const now=new Date(),month=usage.filter(x=>{const d=new Date(x.at);return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth();});
 return{configured,pending,error,save,remove,improve,cost:month.reduce((sum,x)=>sum+(Number(x.cost)||0),0),count:month.length,storageError};
}
type Service=ReturnType<typeof usePromptAssistant>;
export function AISettings({service:s}:{service:Service}){const[key,setKey]=useState('');return <section className="panel settings-connection ai-settings"><h2>AI prompt assistant</h2><p>Optional · GPT-6 Luna. Improve one prompt at a time.</p><p>{s.configured?'API key connected on this browser.':'Add your OpenAI API key to show Improve prompt.'}</p><label className="field-label" htmlFor="ai-key">OpenAI API key</label><input id="ai-key" type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} placeholder="sk-…"/><div className="ai-actions"><button className="button primary" disabled={s.pending||!key.trim()} onClick={()=>void s.save(key).then(()=>setKey(''))}>{s.pending?'Saving…':'Save & check key'}</button>{s.configured&&<button className="button" disabled={s.pending} onClick={()=>void s.remove()}>Remove key</button>}</div><p>Key encrypted on the server; this browser keeps a private access token. Key is excluded from project sync and exports. Add it separately on each device.</p><p>This month on this browser: {s.count} requests · estimated US ${s.cost.toFixed(4)}. OpenAI billing is final; other devices and apps are excluded. Estimate uses US $0.10 input / $0.50 output per million tokens.</p>{s.error&&<p className="error" role="alert">{s.error}</p>}{s.storageError&&<p role="status">{s.storageError}</p>}</section>;}
export function ImprovePrompt({service:s,prompt,context,onUse}:{service:Service;prompt:string;context:string;onUse:(text:string)=>void}){
 const[busy,setBusy]=useState(false),[result,setResult]=useState(''),[error,setError]=useState('');const[source,setSource]=useState('');const live=useRef(prompt);live.current=prompt;
 if(!s.configured)return null;
 async function run(){const original=live.current;setSource(original);setBusy(true);setError('');setResult('');try{setResult(await s.improve(original,context));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="ai-improve"><button className="button" disabled={busy||!prompt.trim()} onClick={()=>void run()}>{busy?'Improving…':'Improve prompt'}</button>{error&&<p className="error" role="alert">{error}</p>}{result&&<div className="ai-result"><label className="field-label">Improved prompt<textarea readOnly value={result}/></label>{source!==prompt&&<p>Your original prompt changed. Review before replacing it.</p>}<div className="ai-actions"><button className="button primary" disabled={source!==prompt} onClick={()=>{onUse(result);setResult('');}}>Use prompt</button><button className="button" onClick={()=>setResult('')}>Dismiss</button></div></div>}</section>;
}
