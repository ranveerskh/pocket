import {useEffect,useState} from 'react';
import {Play} from 'lucide-react';
import {WATCHED_EVENT,isWatched,watchedKey} from './watched-media';
import MediaPoster from './MediaPoster';
import type {Job} from './vault';
export default function WatchedPreview({job}:{job:Job}){
 const key=watchedKey(job),[watched,setWatched]=useState(()=>isWatched(job));
 useEffect(()=>{setWatched(isWatched(job));const changed=(event:Event)=>{if(event instanceof CustomEvent&&event.detail===key)setWatched(true);else setWatched(isWatched(job));};window.addEventListener(WATCHED_EVENT,changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener(WATCHED_EVENT,changed);window.removeEventListener('storage',changed);};},[key]);
 return <><MediaPoster job={job}/>{!watched&&<span className="shot-preview-label"><Play size={16}/> Preview</span>}</>;
}
