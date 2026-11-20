import {localStorage} from './local-mode.ts';
export type SharedPreferences=Partial<Record<'connection'|'ai', {value:string;at:number}>>;
const KEY='pocket-shared-preferences-v1';
export function cleanPreferences(raw:any):SharedPreferences{
 const result:SharedPreferences={};
 for(const name of ['connection','ai'] as const){const entry=raw?.[name];if(!entry||!Number.isFinite(entry.at)||entry.at<=0||entry.at>Date.now()+300000)continue;
 const valid=name==='ai'?/^[a-f0-9]{64}$/.test(entry.value):/^https:\/\/[a-z0-9-]+\.proxy\.runpod\.net$/.test(entry.value);
 if(valid)result[name]={value:entry.value,at:entry.at};}return result;
}
export function readPreferences():SharedPreferences{try{return cleanPreferences(JSON.parse(localStorage.getItem(KEY)||'{}'));}catch{return {};}}
export function mergePreferences(a:SharedPreferences,b:SharedPreferences):SharedPreferences{const result={...a};for(const name of ['connection','ai'] as const){if(b[name]&&(!result[name]||b[name]!.at>result[name]!.at))result[name]=b[name];}return result;}
export function applyPreferences(value:SharedPreferences){const next=mergePreferences(readPreferences(),cleanPreferences(value));localStorage.setItem(KEY,JSON.stringify(next));if(next.ai)localStorage.setItem('pocket-ai-token',next.ai.value);window.dispatchEvent(new Event('pocket-preferences-applied'));return next;}
export function sharePreference(name:'connection'|'ai',value:string){const previous=readPreferences();if(previous[name]?.value===value)return;applyPreferences({[name]:{value,at:Date.now()}});window.dispatchEvent(new Event('pocket-preferences-changed'));}
