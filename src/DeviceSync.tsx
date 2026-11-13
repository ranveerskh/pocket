import {localStorage,isLocal} from './local-mode';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Copy, Link2, RefreshCw} from 'lucide-react';
import {applyLocalSync,canonicalLocalData,sharedPCBase,mergeSync, newPairCode, openSnapshot, pairKeys, sealSnapshot, type SeenRecords, type SyncSnapshot} from './device-sync-model';
import type {useGalleryStore} from './vault';

type Pairing = {code: string; seen: SeenRecords;base?:string};
type Invite={pin:string;expiresAt:number};
type Pending={request:string;device:string;approved:boolean};
const PAIR_API='/.netlify/functions/device-pairing';
async function pairRequest(action:string,params:Record<string,unknown>,secret?:string){const headers:Record<string,string>={'Content-Type':'application/json'};if(secret)headers.Authorization='Bearer '+(await pairKeys(secret)).token;const response=await fetch(PAIR_API,{method:'POST',headers,body:JSON.stringify({action,...params}),signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Pairing failed.');return data;}
const STORAGE_KEY = 'pocket-device-pairing-v1';
const API = '/.netlify/functions/device-sync';
const EMPTY: SyncSnapshot = {version: 1, records: [], hidden: []};

function readPairing(): Pairing | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Pairing | null;
    if (isLocal&&saved)sharedPCBase(saved.base);
    if (saved && /^PS1-[a-zA-Z0-9_-]{43}$/.test(saved.code) && saved.seen) return saved;
  } catch {}
}

function mergeItems<T extends {id: string}>(items: T[], incoming: T[]) {
  if (!incoming.length) return items;
  const result = new Map(items.map(item => [item.id, item]));
  for (const item of incoming) result.set(item.id, {...result.get(item.id), ...item});
  return [...result.values()];
}

export function useDeviceSync(vault: ReturnType<typeof useGalleryStore>,localOptions?:{base:string;onConnection:(base:string)=>void;onVisibility:(job:import('./vault').Job,hidden:boolean)=>Promise<void>}) {
  const [invite,setInvite]=useState<Invite>();
  const [pending,setPending]=useState<Pending|null>(null);
  const [joining,setJoining]=useState<{pin:string;ticket:string;expiresAt:number}>();
  const options=useRef(localOptions);options.current=localOptions;
  const [pairing, setPairing] = useState(readPairing);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [last, setLast] = useState<number>();
  const live = useRef(vault);
  const current = useRef(pairing);
  const inFlight = useRef(false);
  const cache = useRef<{code: string; etag: string; snapshot: SyncSnapshot} | undefined>(undefined);
  live.current = vault;
  current.current = pairing;

  const sync = useCallback(async (request: Pairing, mode: 'create' | 'join' | 'refresh') => {
    if (inFlight.current || !live.current.loaded || live.current.legacyLocked) return false;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const base=isLocal?sharedPCBase(request.base):'';
      const {key, token} = await pairKeys(request.code);
      const authorization = 'Bearer ' + token;
      for (let attempt = 0; attempt < 3; attempt++) {
        const prior = cache.current?.code === request.code ? cache.current : undefined;
        const headers: Record<string, string> = {Authorization: authorization};
        if (prior) headers['X-Pocket-Sync-Known'] = prior.etag;
        const response = await fetch(API, {headers, signal: AbortSignal.timeout(20_000)});
        let snapshot:SyncSnapshot = isLocal?{...EMPTY,scope:'local',connection:base}:EMPTY;
        let etag: string | null = null;
        if (response.status === 304 && prior) {
          snapshot = prior.snapshot;
          etag = prior.etag;
        } else if (response.ok) {
          etag = response.headers.get('X-Pocket-Sync-Revision');
          if (!etag) throw new Error('The sync server did not return a revision.');
          snapshot = await openSnapshot(await response.text(), key,isLocal?'local':'runpod');
        } else if (response.status === 404) {
          if (mode !== 'create') throw new Error('Pairing space not found. Copy the code again from the first device.');
        } else {
          throw new Error('Could not reach device sync. Try again shortly.');
        }

        const original=live.current;
        if(original.legacyLocked)return false;
        const local=isLocal?{...original,...canonicalLocalData(original,base)}:original;
        const rebased=isLocal&&(local.jobs.some((j,i)=>j.base!==original.jobs[i].base)||local.characters.some((c,i)=>c.base!==original.characters[i].base));
        const merged = await mergeSync(local, snapshot, request.seen,isLocal?'local':'runpod',base);
        if (merged.changed || !etag) {
          const body = await sealSnapshot(merged.snapshot, key);
          if (body.length > 2_000_000) throw new Error('This library is too large for device sync.');
          const writeHeaders: Record<string, string> = {Authorization: authorization, 'Content-Type': 'text/plain'};
          if (etag) writeHeaders['X-Pocket-Sync-Match'] = etag;
          else writeHeaders['X-Pocket-Sync-Create'] = '*';
          const written = await fetch(API, {method: 'PUT', headers: writeHeaders, body, signal: AbortSignal.timeout(20_000)});
          if (written.status === 412) {
            cache.current = undefined;
            continue;
          }
          if (!written.ok) throw new Error('Could not save project changes to device sync.');
          etag = written.headers.get('X-Pocket-Sync-Revision');
          snapshot = merged.snapshot;
        }

        if (etag) cache.current = {code: request.code, etag, snapshot};
        const latest = live.current;
        const hasLocalUpdates = latest.jobs !== original.jobs || latest.folders !== original.folders || latest.characters !== original.characters || latest.locked !== original.locked || latest.protectedGallery !== original.protectedGallery;
        const next = {...request, seen: hasLocalUpdates ? request.seen : merged.seen};
        if (!hasLocalUpdates) {
          const data=isLocal?applyLocalSync(local,merged,local.protectedGallery&&!local.locked):{
            folders:mergeItems(local.folders,merged.incoming.folders),characters:mergeItems(local.characters,merged.incoming.characters),jobs:mergeItems(local.jobs,merged.incoming.jobs),
          };
          if(isLocal&&local.protectedGallery&&!local.locked){
            for(const job of data.jobs){const previous=local.jobs.find(item=>item.id===job.id);if(previous?.hidden!==job.hidden)await options.current?.onVisibility(job,!!job.hidden);}
          }
          // An edit made during media encryption wins; retry against it on the next pass.
          const fresh=live.current;
          if(fresh.jobs!==original.jobs||fresh.folders!==original.folders||fresh.characters!==original.characters||fresh.locked!==original.locked||fresh.protectedGallery!==original.protectedGallery){setStatus('Local changes will be picked up on the next sync.');return false;}
          if(rebased||JSON.stringify(data)!==JSON.stringify({folders:local.folders,characters:local.characters,jobs:local.jobs}))local.saveProjectChanges({...data,characterIds:local.characterIds.filter(id=>data.characters.some(character=>character.id===id))});
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setPairing(next);
        current.current = next;
        if(isLocal&&options.current?.base!==base)options.current?.onConnection(base);
        setLast(Date.now());
        setStatus(hasLocalUpdates ? 'Local changes will be picked up on the next sync.' : isLocal&&merged.hidden.length&&!local.protectedGallery?'Projects are up to date. Set a Hidden-folder PIN on this device to open synced hidden items.':'Projects are up to date.');
        return true;
      }
      throw new Error('Both devices are updating. Tap Sync now to try again.');
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!pairing?.code || !vault.loaded || vault.legacyLocked) return;
    const refresh = () => {
      if (!document.hidden && current.current) void sync(current.current, 'refresh');
    };
    const first = setTimeout(refresh, 1000);
    const timer = setInterval(refresh,isLocal?10_000:30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [pairing?.code, sync, vault.loaded, vault.legacyLocked]);

  useEffect(()=>{
    if(!isLocal||!pairing?.code||!vault.loaded)return;
    const timer=setTimeout(()=>{if(!document.hidden&&current.current)void sync(current.current,'refresh');},1500);
    return()=>clearTimeout(timer);
  },[pairing?.code,vault.jobs,vault.folders,vault.characters,vault.loaded,vault.locked,vault.protectedGallery,sync]);
  async function makeInvite(request:Pairing){setBusy(true);setError('');try{const data=await pairRequest('create',{secret:request.code,base:sharedPCBase(request.base)},request.code);setInvite(data);setPending(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function create(base?:string){if(!isLocal){await sync({code:newPairCode(),seen:{}},'create');return;}try{const request={code:newPairCode(),seen:{},base:sharedPCBase(base)};if(await sync(request,'create'))await makeInvite(request);}catch(e){setError((e as Error).message);}}
  async function join(code:string){if(!isLocal){await sync({code:code.trim(),seen:{}},'join');return;}setBusy(true);setError('');try{const pin=code.trim();if(!/^\d{4}$/.test(pin))throw new Error('Enter the 4-digit code.');const device=/iPhone|iPad/i.test(navigator.userAgent)?'iPhone / iPad':/Windows/i.test(navigator.userAgent)?'Windows PC':'Another device';const data=await pairRequest('join',{pin,device});setJoining({pin,...data});setStatus('Approve this connection on the first device.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  useEffect(()=>{
    if(!isLocal||!invite||!pairing)return;let gone=false;let timer:ReturnType<typeof setTimeout>;
    async function poll(){if(invite!.expiresAt<=Date.now()){setInvite(undefined);setPending(null);return;}try{const data=await pairRequest('peek',{pin:invite!.pin},pairing!.code);if(!gone)setPending(data.pending);}catch{if(!gone){setInvite(undefined);setPending(null);}return;}if(!gone)timer=setTimeout(poll,3000);}
    void poll();return()=>{gone=true;clearTimeout(timer);};
  },[invite?.pin,pairing?.code]);
  useEffect(()=>{
    if(!isLocal||!joining)return;let gone=false;let timer:ReturnType<typeof setTimeout>;
    async function poll(){if(joining!.expiresAt<=Date.now()){setJoining(undefined);setError('Code expired. Create another code.');return;}try{const data=await pairRequest('status',{pin:joining!.pin,ticket:joining!.ticket});if(!gone&&!data.waiting){setJoining(undefined);await sync({code:data.secret,base:sharedPCBase(data.base),seen:{}},'join');return;}}catch(e){if(!gone){setJoining(undefined);setError((e as Error).message);}return;}if(!gone)timer=setTimeout(poll,2000);}
    void poll();return()=>{gone=true;clearTimeout(timer);};
  },[joining?.ticket,sync]);
  async function approve(){if(!invite||!pairing||!pending)return;setBusy(true);setError('');try{await pairRequest('approve',{pin:invite.pin,request:pending.request},pairing.code);setPending({...pending,approved:true});setStatus('Connection approved. The other device is finishing pairing.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function disconnect() {
    if (inFlight.current) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      setPairing(undefined);setInvite(undefined);setPending(null);setJoining(undefined);
      cache.current = undefined;
      setStatus('This device was disconnected.');
      setError('');
      setLast(undefined);
    } catch {
      setError('Could not disconnect this browser.');
    }
  }

  return {
    pairing, busy, status, error, last,invite,pending,joining,approve,
    shareBase:pairing?.base||localOptions?.base||'',
    newInvite:()=>pairing&&makeInvite(pairing),
    cancelJoin:()=>{setJoining(undefined);setStatus('Pairing cancelled.');},
    disabled: !vault.loaded || vault.legacyLocked,
    create,join,
    refresh: () => pairing && sync(pairing, 'refresh'),
    disconnect,
  };
}

export default function DeviceSync({service}: {service: ReturnType<typeof useDeviceSync>}) {
  const [shareBase,setShareBase]=useState(service.shareBase);
  useEffect(()=>{if(service.shareBase)setShareBase(service.shareBase);},[service.shareBase]);
  const [input, setInput] = useState('');
  const [reveal, setReveal] = useState(false);
  const [copyNote, setCopyNote] = useState('');
  const {pairing, busy, status, error, last, disabled} = service;

  async function copy() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
      setCopyNote('Pairing code copied.');
    } catch {
      setReveal(true);
      setCopyNote('Select the code below to copy it.');
    }
  }

  if(isLocal)return <section className="panel settings-connection device-sync-settings" aria-label="Device Sync">
    <h2><Link2 size={19}/> Phone &amp; PC Sync</h2>
    <p>Pair once with a 4-digit code. Projects, prompts, references and generation status sync between devices. Videos stay on your PC and open through Tailscale.</p>
    {pairing?<><p role="status">{busy?'Syncing…':'Phone & PC sync enabled'}{last&&!busy?' · '+new Date(last).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):''}</p><div className="device-sync-actions"><button className="button primary" disabled={busy||disabled} onClick={()=>void service.newInvite()}>Create 4-digit code</button><button className="button secondary" disabled={busy||disabled} onClick={()=>void service.refresh()}><RefreshCw size={15}/>Sync now</button><button className="text-button" disabled={busy} onClick={()=>service.disconnect()}>Disconnect this device</button></div></>:<><label className="field-label">PC Tailscale HTTPS address<input type="url" value={shareBase} onChange={e=>setShareBase(e.target.value)} placeholder="https://your-pc.tail123.ts.net" autoCapitalize="none" spellCheck={false}/></label><button className="button primary" disabled={busy||disabled||!!service.joining} onClick={()=>void service.create(shareBase)}>Create 4-digit code</button><label className="field-label">Or enter the code from your other device<input aria-label="4-digit pairing code" inputMode="numeric" autoComplete="off" maxLength={4} value={input} onChange={e=>setInput(e.target.value.replace(/\D/g,''))} placeholder="1234"/></label><button className="button secondary" disabled={busy||disabled||input.length!==4||!!service.joining} onClick={()=>void service.join(input)}>Pair device</button></>}
    {service.invite&&<div className="sync-pin"><strong>{service.invite.pin}</strong><p>Enter this code on your other device within 5 minutes.</p></div>}
    {service.pending&&!service.pending.approved&&<div className="sync-approval"><p>{service.pending.device} wants to connect. Approve only if you just entered this code on your other device.</p><button className="button primary" disabled={busy} onClick={()=>void service.approve()}>Approve device</button></div>}
    {service.joining&&<p role="status">Waiting for approval on the first device. <button className="text-button" onClick={service.cancelJoin}>Cancel</button></p>}
    <p>Both devices need Tailscale connected and the same PC online. Project names, categories, reference additions/removals and Hide/Unhide sync too. Set or unlock a Hidden-folder PIN on each device to open hidden items. Device downloads stay local; removing a device copy keeps the shared project record.</p>
    {status&&<p role="status">{status}</p>}{error&&<p className="error" role="alert">{error}</p>}
  </section>;
  return <section className="panel settings-connection device-sync-settings" aria-label="Device Sync">
    <h2><Link2 size={19}/> Device Sync</h2>
    <p>Pair your phone and laptop to share projects, prompts, references and completed creation links. Videos open from RunPod while their files are available.</p>
    {pairing ? <>
      <p role="status">{busy ? 'Syncing…' : 'Paired on this browser'}{last && !busy ? ' · ' + new Date(last).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}</p>
      <div className="device-sync-actions">
        <button className="button secondary" onClick={() => void copy()}><Copy size={15}/>Copy pairing code</button>
        <button className="button secondary" disabled={busy || disabled} onClick={() => void service.refresh()}><RefreshCw size={15}/>Sync now</button>
        <button className="text-button" disabled={busy} onClick={() => {service.disconnect();setReveal(false);setCopyNote('');setInput('');}}>Disconnect this device</button>
      </div>
      {reveal && <input aria-label="Your pairing code" readOnly value={pairing.code}/>}
      {copyNote && <p role="status">{copyNote}</p>}
    </> : <>
      <button className="button primary" disabled={busy || disabled} onClick={() => void service.create()}>Create pairing code</button>
      <label className="field-label">Pair with an existing device
        <input type="password" value={input} onChange={e => setInput(e.target.value)} placeholder="Paste pairing code" autoComplete="off" spellCheck={false}/>
      </label>
      <button className="button secondary" disabled={busy || disabled || !input.trim()} onClick={() => void service.join(input)}>Pair device</button>
    </>}
    <p>Keep the code private. Hidden items and device-only files stay local. Removing a device copy does not remove a shared project record.</p>
    {status && <p role="status">{status}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
