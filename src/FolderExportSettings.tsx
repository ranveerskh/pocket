import {useEffect, useRef, useState} from 'react';
import {FolderOpen, HardDrive} from 'lucide-react';
import {creationDownloadName} from './gallery-model';
import {mediaKey, storageMessage} from './media-db';
import type {useDeviceLibrary} from './LocalMedia';
import type {Job, MediaFile, useGalleryStore} from './vault';

type WritableFolder = FileSystemDirectoryHandle & {
  queryPermission(options: {mode: 'readwrite'}): Promise<PermissionState>;
  requestPermission(options: {mode: 'readwrite'}): Promise<PermissionState>;
};
type FolderConfig = {folder: WritableFolder; from: number; id: string};
const permission = {mode: 'readwrite'} as const;
const pickerWindow = window as Window & {
  showDirectoryPicker?: (options: {mode: 'readwrite'; id: string}) => Promise<WritableFolder>;
};
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pocket-folder-export', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => {
    database = undefined;
    throw error;
  });
  return database;
}

async function readConfig(): Promise<FolderConfig | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('settings').objectStore('settings').get('folder');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveConfig(config?: FolderConfig) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    if (config) store.put(config, 'folder');
    else store.delete('folder');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

async function exportedName(config: FolderConfig, job: Job, file: MediaFile) {
  const key = JSON.stringify([config.id, mediaKey(job, file)]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const suffix = [...new Uint8Array(hash).slice(0, 8)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const name = creationDownloadName(job, file.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot, dot + 12) : '';
  return name.slice(0, dot > 0 ? dot : undefined).slice(0, 100) + '-' + suffix + extension;
}

export function useFolderExport(vault: ReturnType<typeof useGalleryStore>, media: ReturnType<typeof useDeviceLibrary>) {
  const supported = typeof pickerWindow.showDirectoryPicker === 'function';
  const [config, setConfig] = useState<FolderConfig>();
  const [loaded, setLoaded] = useState(false);
  const [access, setAccess] = useState<PermissionState>('prompt');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const exported = useRef(new Set<string>());
  const latest = useRef({config, jobs: vault.jobs});
  latest.current = {config, jobs: vault.jobs};

  useEffect(() => {
    if (!supported) return;
    let alive = true;
    void readConfig().then(async saved => {
      if (alive && saved) {
        setConfig(saved);
        setAccess(await saved.folder.queryPermission(permission));
      }
    }).catch(e => {if (alive) setError(storageMessage(e));})
      .finally(() => {if (alive) setLoaded(true);});
    return () => {alive = false;};
  }, [supported]);

  useEffect(() => {
    if (!config || access !== 'granted' || !vault.loaded || vault.legacyLocked || error || busy || writing) return;
    const pending = vault.jobs.filter(job => !job.hidden && job.base && job.state === 'complete' &&
      (job.completedAt ?? job.created) >= config.from).flatMap(job =>
      (job.files ?? []).map(file => ({job, file, key: config.id + mediaKey(job, file)})));
    const next = pending.find(item => media.saved.has(mediaKey(item.job, item.file)) && !exported.current.has(item.key));
    if (!next) return;
    setWriting(true);
    void (async () => {
      const {job, file, key} = next;
      const allowed = () => latest.current.config?.id === config.id &&
        latest.current.jobs.some(current => current.id === job.id && current.base === job.base && !current.hidden);
      if (await config.folder.queryPermission(permission) !== 'granted') {
        setAccess('prompt');
        return;
      }
      const name = await exportedName(config, job, file);
      // Use a stable, folder-specific name so a reload never creates duplicate exports.
      try {
        const existing = await config.folder.getFileHandle(name);
        if ((await existing.getFile()).size > 0) {
          exported.current.add(key);
          return;
        }
      } catch (e) {
        if ((e as DOMException).name !== 'NotFoundError') throw e;
      }
      const blob = await media.read(job, file);
      if (!blob || !allowed()) {
        exported.current.add(key);
        return;
      }
      const output = await config.folder.getFileHandle(name, {create: true});
      const writer = await output.createWritable();
      try {
        if (!allowed()) {
          await writer.abort();
          return;
        }
        await writer.write(blob);
        await writer.close();
        exported.current.add(key);
      } catch (e) {
        await writer.abort().catch(() => {});
        throw e;
      }
    })().catch(e => setError(storageMessage(e))).finally(() => setWriting(false));
  }, [config, access, vault.jobs, vault.loaded, vault.legacyLocked, media.saved, busy, writing, error]);

  async function choose() {
    if (!supported || busy || writing) return;
    setBusy(true);
    try {
      const folder = await pickerWindow.showDirectoryPicker!({mode: 'readwrite', id: 'pocket-studio-output'});
      const next = {folder, from: Date.now(), id: crypto.randomUUID()};
      const state = await folder.queryPermission(permission);
      await saveConfig(next);
      setConfig(next);
      setAccess(state);
      setError('');
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setError(storageMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function allow() {
    if (!config || busy || writing) return;
    setBusy(true);
    try {
      setAccess(await config.folder.requestPermission(permission));
      setError('');
    } catch (e) {
      setError(storageMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (busy || writing) return;
    setBusy(true);
    try {
      await saveConfig();
      setConfig(undefined);
      setAccess('prompt');
      setError('');
    } catch (e) {
      setError(storageMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return {supported, loaded, config, access, error, busy, writing, choose, allow, remove, retry: () => setError('')};
}

export default function FolderExportSettings({service}: {service: ReturnType<typeof useFolderExport>}) {
  const {supported, loaded, config, access, error, busy, writing, choose, allow, remove, retry} = service;
  return <section className="panel folder-export-settings">
    <h2><HardDrive size={20}/> Auto-save folder</h2>
    {supported ? <>
      <p>Choose a folder for extra copies of new public creations. Files export while Pocket Studio is open and after the device copy is ready.</p>
      <p role="status">{writing ? 'Exporting a file…' : config
        ? config.folder.name + (access === 'granted' ? ' · Active' : ' · Permission needed')
        : 'Folder export is off'}</p>
      <div className="folder-export-actions">
        <button className="button secondary" disabled={!loaded || busy || writing} onClick={() => void choose()}>
          <FolderOpen size={16}/>{config ? 'Change save folder' : 'Choose save folder'}
        </button>
        {config && access !== 'granted' && <button className="button primary" disabled={busy || writing} onClick={() => void allow()}>Allow folder access</button>}
        {config && <button className="text-button" disabled={busy || writing} onClick={() => void remove()}>Turn off folder export</button>}
      </div>
      {error && <p className="error" role="alert">{error} {config && <button className="text-button" onClick={retry}>Retry</button>}</p>}
    </> : <p>Use Save file on a clip to export it. On iPhone, choose Save to Files from the share sheet. On a laptop with Chrome or Edge, you can choose an automatic export folder here.</p>}
  </section>;
}
