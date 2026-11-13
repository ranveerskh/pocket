import {localStorage,isLocal} from './local-mode';
import {useEffect, useLayoutEffect, useState} from 'react';
import {Monitor, Moon, Sun} from 'lucide-react';

export const localThemes = [
 {value:'ocean',label:'Ocean',light:false,swatch:'#55d6c2',background:'#0c191d'},
 {value:'midnight',label:'Midnight',light:false,swatch:'#78adff',background:'#0d1527'},
 {value:'forest',label:'Forest',light:false,swatch:'#a3ce80',background:'#121b16'},
 {value:'cloud',label:'Cloud',light:true,swatch:'#2369ad',background:'#f1f6fb'},
 {value:'sand',label:'Sand',light:true,swatch:'#9a4c22',background:'#faf4e9'},
 {value:'mint',label:'Mint',light:true,swatch:'#12735e',background:'#edf8f1'},
] as const;
type Theme = 'dark' | 'light' | 'system' | typeof localThemes[number]['value'];
const KEY = 'pocket-theme';
function savedTheme(): Theme {
 try {
  const value=localStorage.getItem(KEY);
  if(isLocal){if(localThemes.some(t=>t.value===value))return value as Theme;return value==='light'?'cloud':'ocean';}
  if(value==='light'||value==='system')return value;
 }catch{}
 return isLocal?'ocean':'dark';
}
export function useTheme() {
 const [theme,setTheme]=useState<Theme>(savedTheme),[error,setError]=useState('');
 useLayoutEffect(()=>{
  const system=window.matchMedia('(prefers-color-scheme: light)');
  function apply(){const preset=isLocal?localThemes.find(t=>t.value===theme)||localThemes[0]:undefined;
   const light=preset?preset.light:theme==='light'||theme==='system'&&system.matches;
   document.documentElement.dataset.theme=light?'light':'dark';
   if(preset)document.documentElement.dataset.localTheme=preset.value;else delete document.documentElement.dataset.localTheme;
   document.querySelector('meta[name="theme-color"]')?.setAttribute('content',preset?.background||(light?'#f4f3f8':'#111214'));
  }
  apply();system.addEventListener('change',apply);return()=>system.removeEventListener('change',apply);
 },[theme]);
 useEffect(()=>{function changed(event:StorageEvent){if(event.key===(isLocal?'local:':'')+KEY)setTheme(savedTheme());}window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[]);
 function choose(next:Theme){setTheme(next);try{localStorage.setItem(KEY,next);setError('');}catch{setError('Theme applied for this visit. This browser could not save the preference.');}}
 return{theme,choose,error};
}
export default function ThemeSettings({service}:{service:ReturnType<typeof useTheme>}) {
 return <section className="panel settings-connection theme-settings" aria-label="Appearance"><h2>Appearance</h2>
 {isLocal?<div className="local-theme-groups">{[false,true].map(light=><div key={String(light)}><h3>{light?'Light themes':'Dark themes'}</h3><div className="theme-choices" role="group" aria-label={light?'Light themes':'Dark themes'}>{localThemes.filter(t=>t.light===light).map(t=><button key={t.value} className="button local-theme-choice" aria-pressed={service.theme===t.value} onClick={()=>service.choose(t.value)}><span className="theme-swatch" style={{background:t.background,borderColor:t.swatch}}><span style={{background:t.swatch}}/></span>{t.label}</button>)}</div></div>)}</div>:<div className="theme-choices" role="group" aria-label="Color theme">{([{value:'dark',label:'Dark',Icon:Moon},{value:'light',label:'Light',Icon:Sun},{value:'system',label:'System',Icon:Monitor}] as const).map(({value,label,Icon})=><button key={value} className="button" aria-pressed={service.theme===value} onClick={()=>service.choose(value)}><Icon size={18}/>{label}</button>)}</div>}
 <p>{isLocal?'Your theme is remembered on this device.':'System follows your device’s appearance. Your choice is remembered on this browser.'}</p>{service.error&&<p role="status">{service.error}</p>}</section>;
}
