import {useEffect,useRef} from 'react';
import {ChevronRight,RefreshCw,X,Power,Link2,Check,Minus} from 'lucide-react';
import type {usePodControls} from './PodControls';
type Props={service:ReturnType<typeof usePodControls>;connected:boolean;checking:boolean;open:boolean;onOpen:(open:boolean)=>void;enabled:boolean;onToggle:()=>void;disabled:boolean;onSettings:()=>void;queueBusy:boolean};
export function walletHours(balance:number,rate:number){if(rate<=0||!Number.isFinite(rate)||!Number.isFinite(balance))return '';const minutes=Math.max(0,Math.floor(balance/rate*60));return Math.floor(minutes/60)+'h '+minutes%60+'m left';}
export default function RunPodStatus(p:Props){
 const root=useRef<HTMLDivElement>(null),s=p.service;
 useEffect(()=>{if(!p.open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))p.onOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')p.onOpen(false);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};},[p.open]);
 const hours=s.wallet&&!s.walletError?walletHours(s.wallet.balance,s.wallet.rate):'';
 const lowTime=!!hours&&!!s.wallet&&s.wallet.rate>0&&s.wallet.balance/s.wallet.rate<5;
 const connected=p.connected||p.checking;
 const validPort=Number.isInteger(Number(s.port))&&Number(s.port)>0&&Number(s.port)<65536;
 const powerOn=!!s.watch||!!s.selectedPod?.actions?.includes('stop')||['RUNNING','STARTING','RESTARTING'].includes(s.selectedPod?.status||'');
 const armed=s.autoStop?.pod===s.selected&&s.autoStop&&['armed','idle','stopping'].includes(s.autoStop.state);
 return <div className="runpod-status" ref={root}><button className={'status '+(p.connected?'online':'')+(p.connected&&lowTime?' wallet-low':'')} title={p.connected&&lowTime?'Less than 5 hours of RunPod balance remaining at the current rate':undefined} aria-expanded={p.open} aria-controls="runpod-quick-panel" onClick={()=>{p.onOpen(!p.open);if(!p.open){void s.refresh();void s.refreshWallet();}}}><span className="dot"/>{p.checking?'Checking…':p.connected?(hours?'RunPod · '+hours:'RunPod connected'):'Connect RunPod'}<ChevronRight size={14}/></button>
 {p.open&&<section className="runpod-quick-panel panel" id="runpod-quick-panel" aria-label="RunPod quick controls"><div className="runpod-panel-heading"><strong>RunPod</strong><button className="icon-button" onClick={()=>p.onOpen(false)} aria-label="Close RunPod controls"><X size={18}/></button></div>
 <div className="runpod-wallet"><div><span>Balance · USD</span><strong>{s.wallet?'$'+s.wallet.balance.toFixed(2):'—'}</strong></div><div><span>Current spend</span><strong>{s.wallet?'$'+s.wallet.rate.toFixed(2)+'/hr':'—'}</strong></div></div>
 {s.wallet&&<small className="runpod-wallet-note">Account total: all pods and storage. Updated {new Date(s.wallet.updatedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}.</small>}
 {s.walletError&&<small role="status">{s.walletError}</small>}
 <label className="runpod-toggle"><span><Power size={16}/>Pod power<small>{s.selectedPod?s.selectedPod.name:'Select your pod once in Settings'} · {s.watch?'Starting…':powerOn?'Running':'Stopped'}</small></span><span className="runpod-switch-control" data-on={powerOn}><strong aria-hidden="true">{s.busy?'Updating…':powerOn?'ON':'OFF'}</strong><input type="checkbox" role="switch" aria-label="Pod power" checked={powerOn} disabled={!s.configured||!validPort||!s.selectedPod?.actions?.includes(powerOn?'stop':'start')||s.busy||p.disabled} onChange={e=>void s.action(e.target.checked?'start':'stop')}/><span className="runpod-switch-track" aria-hidden="true"><span>{powerOn?<Check size={12}/>:<Minus size={12}/>}</span></span></span></label>
 {s.watch&&<p className="runpod-watch-note" role="status">Waiting for ComfyUI. The app will connect when ready.</p>}
 <label className="runpod-toggle"><span><Link2 size={16}/>Quick connect<small>{p.checking?'Connecting…':p.connected?'Connected':'Disconnected'} · app connection only</small></span><span className="runpod-switch-control" data-on={connected}><strong aria-hidden="true">{p.checking?'Connecting…':connected?'ON':'OFF'}</strong><input type="checkbox" role="switch" aria-label="Quick connect RunPod" checked={connected} disabled={p.disabled||p.checking} onChange={p.onToggle}/><span className="runpod-switch-track" aria-hidden="true"><span>{connected?<Check size={12}/>:<Minus size={12}/>}</span></span></span></label>
 <label className="runpod-toggle"><span><Power size={16}/>Auto-stop after queue<small>{armed?'Armed · ':s.autoStop?.state==='stopped'?'Pod stopped · ':'Off · '}{s.selectedPod?s.selectedPod.name:'Choose a pod in Settings'}</small></span><span className="runpod-switch-control" data-on={!!armed}><strong aria-hidden="true">{s.busy?'Updating…':armed?'ON':'OFF'}</strong><input type="checkbox" role="switch" aria-label="Auto-stop pod after queue finishes" checked={!!armed} disabled={!s.configured||!s.selectedPod||s.busy||(p.queueBusy&&!armed)||s.autoStop?.state==='stopping'} onChange={e=>void s.autoStopAction(e.target.checked)}/><span className="runpod-switch-track" aria-hidden="true"><span>{armed?<Check size={12}/>:<Minus size={12}/>}</span></span></span></label>
 <small className="runpod-wallet-note">Server checks every minute, even with your phone locked. Failed shots count as finished. Successful files stay on the pod; device download needs an open app. Persistent storage charges continue.</small>
 {s.autoStop&&s.autoStop.state!=='off'&&<p className="runpod-watch-note" role="status">{s.autoStop.state==='stopping'?'Stopping pod · ':armed?'Auto-stop armed · ':''}{s.autoStop.message}</p>}
 {armed&&<small className="runpod-wallet-note">{s.autoStop?.checkedAt?'Last server check: '+new Date(s.autoStop.checkedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'Waiting for first server check…'}</small>}
 {p.queueBusy&&<small>Finish submitting or changing your queue before arming auto-stop.</small>}
 {s.error&&<p className="error" role="alert">{s.error}</p>}
 <div className="pod-power-actions"><button className="text-button" disabled={s.busy} onClick={()=>{void s.refresh();void s.refreshWallet();}}><RefreshCw size={14}/>Refresh</button><button className="text-button" onClick={()=>{p.onOpen(false);p.onSettings();}}>Settings & pod power<ChevronRight size={14}/></button></div>
 {!s.configured&&<small>Add your RunPod API key in Settings to enable balance and auto-stop.</small>}
 </section>}
 </div>;
}
