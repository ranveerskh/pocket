import {localStorage,isLocal} from './local-mode';
import {useEffect,useState} from 'react';
import type {Job} from './vault';
import {mergeTimingSamples,readTimingSamples,saveTimingSamples,TIMING_STORAGE_KEY} from './timing';
const CHANGED='pocket-timing-cache-changed';
export function useTimingHistory(jobs:Job[]){
 const [samples,setSamples]=useState(()=>readTimingSamples(localStorage));
 useEffect(()=>{
  // Panels may mount at different times. Merge the shared cache before writing.
  const stored=readTimingSamples(localStorage),next=mergeTimingSamples([...samples,...stored],jobs);
  if(JSON.stringify(next)!==JSON.stringify(stored)){try{saveTimingSamples(localStorage,next);window.dispatchEvent(new Event(CHANGED));}catch{}}
  setSamples(previous=>JSON.stringify(next)===JSON.stringify(previous)?previous:next);
 },[jobs]);
 useEffect(()=>{const refresh=()=>setSamples(previous=>{const next=readTimingSamples(localStorage);return JSON.stringify(next)===JSON.stringify(previous)?previous:next;});const storage=(e:StorageEvent)=>{if(e.key===(isLocal?'local:':'')+TIMING_STORAGE_KEY)refresh();};window.addEventListener(CHANGED,refresh);window.addEventListener('storage',storage);return()=>{window.removeEventListener(CHANGED,refresh);window.removeEventListener('storage',storage);};},[]);
 return samples;
}
