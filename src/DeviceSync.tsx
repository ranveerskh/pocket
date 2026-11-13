import {localStorage} from './local-mode';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Copy, Link2, RefreshCw} from 'lucide-react';
import {mergeSync, newPairCode, openSnapshot, pairKeys, sealSnapshot, type SeenRecords, type SyncSnapshot} from './device-sync-model';
import type {useGalleryStore} from './vault';

type Pairing = {code: string; seen: SeenRecords};
const STORAGE_KEY = 'pocket-device-pairing-v1';
const API = '/.netlify/functions/device-sync';
const EMPTY: SyncSnapshot = {version: 1, records: [], hidden: []};

function readPairing(): Pairing | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Pairing | null;
    if (saved && /^PS1-[a-zA-Z0-9_-]{43}$/.test(saved.code) && saved.seen) return saved;
  } catch {}
}

function mergeItems<T extends {id: string}>(items: T[], incoming: T[]) {
  if (!incoming.length) return items;
  const result = new Map(items.map(item => [item.id, item]));
  for (const item of incoming) result.set(item.id, {...result.get(item.id), ...item});
  return [...result.values()];
}

export function useDeviceSync(vault: ReturnType<typeof useGalleryStore>) {
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
    if (inFlight.current || !live.current.loaded || live.current.legacyLocked) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const {key, token} = await pairKeys(request.code);
      const authorization = 'Bearer ' + token;
      for (let attempt = 0; attempt < 3; attempt++) {
        const prior = cache.current?.code === request.code ? cache.current : undefined;
        const headers: Record<string, string> = {Authorization: authorization};
        if (prior) headers['X-Pocket-Sync-Known'] = prior.etag;
        const response = await fetch(API, {headers, signal: AbortSignal.timeout(20_000)});
        let snapshot = EMPTY;
        let etag: string | null = null;
        if (response.status === 304 && prior) {
          snapshot = prior.snapshot;
          etag = prior.etag;
        } else if (response.ok) {
          etag = response.headers.get('X-Pocket-Sync-Revision');
          if (!etag) throw new Error('The sync server did not return a revision.');
          snapshot = await openSnapshot(await response.text(), key);
        } else if (response.status === 404) {
          if (mode !== 'create') throw new Error('Pairing space not found. Copy the code again from the first device.');
        } else {
          throw new Error('Could not reach device sync. Try again shortly.');
        }

        const local = live.current;
        if (local.legacyLocked) return;
        const merged = await mergeSync(local, snapshot, request.seen);
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
        const hasLocalUpdates = latest.jobs !== local.jobs || latest.folders !== local.folders || latest.characters !== local.characters;
        const next = {code: request.code, seen: hasLocalUpdates ? request.seen : merged.seen};
        if (!hasLocalUpdates && (merged.incoming.folders.length || merged.incoming.characters.length || merged.incoming.jobs.length)) {
          local.saveProjectChanges({
            folders: mergeItems(local.folders, merged.incoming.folders),
            characters: mergeItems(local.characters, merged.incoming.characters),
            jobs: mergeItems(local.jobs, merged.incoming.jobs),
            characterIds: local.characterIds,
          });
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setPairing(next);
        current.current = next;
        setLast(Date.now());
        setStatus(hasLocalUpdates ? 'Local changes will be picked up on the next sync.' : 'Projects are up to date.');
        return;
      }
      throw new Error('Both devices are updating. Tap Sync now to try again.');
    } catch (e) {
      setError((e as Error).message);
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
    const timer = setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [pairing?.code, sync, vault.loaded, vault.legacyLocked]);

  function disconnect() {
    if (inFlight.current) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      setPairing(undefined);
      cache.current = undefined;
      setStatus('This device was disconnected.');
      setError('');
      setLast(undefined);
    } catch {
      setError('Could not disconnect this browser.');
    }
  }

  return {
    pairing, busy, status, error, last,
    disabled: !vault.loaded || vault.legacyLocked,
    create: () => sync({code: newPairCode(), seen: {}}, 'create'),
    join: (code: string) => sync({code: code.trim(), seen: {}}, 'join'),
    refresh: () => pairing && sync(pairing, 'refresh'),
    disconnect,
  };
}

export default function DeviceSync({service}: {service: ReturnType<typeof useDeviceSync>}) {
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
