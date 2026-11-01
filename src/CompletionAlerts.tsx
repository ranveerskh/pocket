import {useEffect,useRef,useState} from 'react';
import {Bell,Check,Volume2,VolumeX,X} from 'lucide-react';
import type {Job} from './vault';
import {completedSince,completionSnapshot} from './completion-model';
function chime(context:AudioContext){
 if(context.state!=='running')return;
 for(const [i,hz] of [660,880].entries()){
  const oscillator=context.createOscillator(),gain=context.createGain(),start=context.currentTime+i*.18;
  oscillator.type='sine';oscillator.frequency.value=hz;
  gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.12,start+.015);gain.gain.exponentialRampToValueAtTime(.001,start+.22);
  oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start);oscillator.stop(start+.24);
 }
}
export default function CompletionAlerts({jobs,loaded,locked,onOpen}:{jobs:Job[];loaded:boolean;locked:boolean;onOpen:()=>void}){
 const previous=useRef<Map<string,string>|null>(null),audio=useRef<AudioContext|null>(null),sound=useRef(false);
 const [soundOn,setSoundOn]=useState(false),[count,setCount]=useState(0),[error,setError]=useState('');
 useEffect(()=>{
  if(!loaded||locked){previous.current=null;setCount(0);return;}
  const completed=previous.current?completedSince(previous.current,jobs):[];
  previous.current=completionSnapshot(jobs);
  if(!completed.length)return;
  setCount(n=>n+completed.length);
  if(sound.current&&!document.hidden&&audio.current)chime(audio.current);
 },[jobs,loaded,locked]);
 useEffect(()=>()=>{void audio.current?.close().catch(()=>{});},[]);
 async function toggleSound(){
  if(sound.current){sound.current=false;setSoundOn(false);return;}
  try{
   const Audio=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
   if(!Audio)throw new Error('Sound is unavailable in this browser. Completion banners still work.');
   audio.current??=new Audio();await audio.current.resume();
   if(audio.current.state!=='running')throw new Error('Sound could not start. Tap again with the app open.');
   sound.current=true;setSoundOn(true);setError('');chime(audio.current);
  }catch(e){setError((e as Error).message);}
 }
 return <>
  <section className="completion-preferences" aria-label="Completion alerts">
   <div><strong><Bell size={15}/>Completion alerts</strong><p>Banners are on while this app is open. Sound needs enabling each time you reopen. Keep the app in front for sound; iPhone silent mode and volume may affect it.</p></div>
   <button className="button secondary" aria-pressed={soundOn} onClick={toggleSound}>{soundOn?<Volume2 size={16}/>:<VolumeX size={16}/>}Sound {soundOn?'on':'off'}</button>
   {error&&<p className="error" role="alert">{error}</p>}
  </section>
  {count>0&&!locked&&<aside className="completion-toast" role="status" aria-live="polite" aria-atomic="true"><span className="completion-check"><Check size={20}/></span><div><strong>{count===1?'Generation complete':count+' generations complete'}</strong><p>Your creations are ready in the gallery.</p><button className="text-button" onClick={()=>{setCount(0);onOpen();}}>Open gallery</button></div><button className="icon-button" aria-label="Dismiss completion alert" onClick={()=>setCount(0)}><X size={19}/></button></aside>}
 </>;
}
