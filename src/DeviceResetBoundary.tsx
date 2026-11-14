import {useEffect,useState} from 'react';
import Studio from './Studio';
import {closeMediaDatabase} from './media-db';
import {closeFolderExportDatabase} from './FolderExportSettings';
import {isLocal} from './local-mode';
import {beginDeviceReset} from './reset-state';
import {eraseDeviceStorage} from './device-storage-reset';
function ResetScreen({paused}:{paused:boolean}){
 const[error,setError]=useState(''),[done,setDone]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{if(paused)return;let active=true;async function erase(){try{
  await closeMediaDatabase();
  await closeFolderExportDatabase();
  await eraseDeviceStorage(isLocal,window.localStorage,name=>new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error||new Error('Could not erase device media.'));request.onblocked=()=>reject(new Error('Close other Pocket Studio tabs/windows, then retry.'));}));
  if(active)setDone(true);
 }catch(e){if(active)setError((e as Error).message);}}
 void erase();return()=>{active=false;};},[paused,attempt]);
 return <main className="panel" style={{maxWidth:600,margin:'40px auto',padding:24}}><h1>{paused?'App paused in this tab':done?'Device app data erased':error?'Erase needs attention':'Erasing device app data…'}</h1><p>{paused?'Another tab started erasing this app’s device data. Close this tab while it finishes.':done?'This browser’s app data is cleared and sync is disconnected. PC/Pod originals, other devices and exported files were kept.':error||'Keep this page open until cleanup finishes.'}</p>{error&&<button className="button danger" onClick={()=>{setError('');setAttempt(n=>n+1);}}>Retry erase</button>}{(done||paused)&&<button className="button primary" onClick={()=>location.reload()}>Open studio</button>}</main>;
}
export default function DeviceResetBoundary(){const[reset,setReset]=useState<false|'erase'|'pause'>(false);useEffect(()=>{const channel=typeof BroadcastChannel==='function'?new BroadcastChannel(isLocal?'pocket-local-reset':'pocket-runpod-reset'):null;const stop=()=>{beginDeviceReset();setReset('pause');};if(channel)channel.onmessage=stop;const erase=()=>{beginDeviceReset();channel?.postMessage('reset');setReset('erase');};window.addEventListener('pocket-erase-device',erase);return()=>{channel?.close();window.removeEventListener('pocket-erase-device',erase);};},[]);return reset?<ResetScreen paused={reset==='pause'}/>:<Studio/>;}
