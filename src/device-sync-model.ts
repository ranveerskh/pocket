import type {Character} from './reference-model';
import type {Folder, Job} from './vault';

export type SyncData = {folders: Folder[]; jobs: Job[]; characters: Character[]};
type RecordData = Folder | Job | Character;
type SyncRecord = {kind: 'folders' | 'jobs' | 'characters'; item: RecordData};
export type SyncScope='runpod'|'local';
export type SyncSnapshot = {version: 1; records: SyncRecord[]; hidden: string[];scope?:SyncScope;connection?:string;removed?:string[]};
export type SeenRecords = Record<string, string>;

const keyOf = ({kind, item}: SyncRecord) => kind + ':' + item.id;
const validId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,180}$/.test(value);
const validBase = (value: unknown) => typeof value === 'string' && /^https:\/\/[a-z0-9-]+\.proxy\.runpod\.net$/.test(value);
const safePath = (value: unknown) => typeof value === 'string' && value.length < 400 && !value.includes('..') && !value.startsWith('/') && !value.includes('\\');

export function sharedPCBase(value:unknown):string {
 if(typeof value!=='string')throw new Error('Use your PC Tailscale HTTPS address.');
 let url:URL;try{url=new URL(value.trim());}catch{throw new Error('Use your PC Tailscale HTTPS address.');}
 if(url.protocol!=='https:'||! /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i.test(url.hostname)||url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Use your PC Tailscale HTTPS address, such as https://pc.tail123.ts.net.');
 return url.origin;
}
function localBase(value:unknown,connection:string){if(typeof value!=='string')return;try{if(sharedPCBase(value)===connection)return connection;}catch{}try{const url=new URL(value);if(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&['8188','8000'].includes(url.port)&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash)return connection;}catch{} }
export function canonicalLocalData(data:SyncData,connection:string):SyncData {
 const base=sharedPCBase(connection);
 return {folders:data.folders,jobs:data.jobs.map(job=>localBase(job.base,base)?{...job,base}:job),characters:data.characters.map(character=>localBase(character.base,base)?{...character,base}:character)};
}
function cleanJob(job: Job,scope:SyncScope='runpod',connection=''): Job | undefined {
  if (!validId(job.id) || (job.hidden && scope!=='local') || (scope==='local'?!['queued','running','unknown','complete','error','cancelled'].includes(job.state):job.state!=='complete') || (scope==='local'?job.base!==connection:!validBase(job.base)) ||
    typeof job.prompt !== 'string' || job.prompt.length > 30_000 || (scope==='local'?job.files!==undefined&&!Array.isArray(job.files):!Array.isArray(job.files)) ||
    job.id.startsWith('pending-') || !Number.isFinite(job.created) || !Number.isFinite(job.seed) || !Number.isFinite(job.duration)) return;
  const files = (job.files||[]).filter(file => file && file.type === 'output' && safePath(file.filename) &&
    !file.filename.includes('/') && safePath(file.subfolder||'')).map(file => ({
    filename: file.filename, subfolder: file.subfolder||'', type: 'output', ...(file.podDeleted ? {podDeleted: true} : {}),
  }));
  if (!files.length && job.state==='complete') return;
  const {id, base, prompt, basePrompt, folder, seed, duration, aspect, quality, mode, workflowId, workflowName,
    created, completedAt, batchId, batchIndex, negativePrompt, guidance, referenceCharacterIds, turbo, templates} = job;
  return {
    id, base, prompt, basePrompt: typeof basePrompt === 'string' ? basePrompt.slice(0, 20_000) : undefined,
    folder: validId(folder) ? folder : undefined, seed, duration,
    aspect: typeof aspect === 'string' ? aspect : 'landscape',
    quality: typeof quality === 'string' ? quality : 'draft',
    mode: mode === 'image' ? 'image' : 'video',
    workflowId: typeof workflowId === 'string' ? workflowId : undefined,
    workflowName: typeof workflowName === 'string' ? workflowName.slice(0, 100) : undefined,
    created, completedAt: Number.isFinite(completedAt) ? completedAt : undefined,
    batchId: validId(batchId) ? batchId : undefined, batchIndex: Number.isInteger(batchIndex) ? batchIndex : undefined,
    negativePrompt: typeof negativePrompt === 'string' ? negativePrompt.slice(0, 10_000) : undefined,
    guidance: Number.isFinite(guidance) ? guidance : undefined,
    referenceCharacterIds: Array.isArray(referenceCharacterIds) ? referenceCharacterIds.filter(validId).slice(0, 3) : undefined,
    turbo: turbo === true, templates: Array.isArray(templates) ? templates.filter(validId).slice(0, 50) : undefined,
    state: scope==='local'?job.state:'complete', files,
    ...(scope==='local'?{hidden:job.hidden===true,visibilityChangedAt:Number.isFinite(job.visibilityChangedAt)?job.visibilityChangedAt:0,startedAt:Number.isFinite(job.startedAt)?job.startedAt:undefined,queuePosition:Number.isFinite(job.queuePosition)?job.queuePosition:undefined,error:typeof job.error==='string'?job.error.slice(0,1000):undefined}:{}),
  };
}

function cleanRecords(data: SyncData,scope:SyncScope='runpod',connection=''): SyncRecord[] {
  const records: SyncRecord[] = [];
  for (const folder of data.folders) if (validId(folder.id) && typeof folder.name === 'string') {
    records.push({kind: 'folders', item: {id: folder.id, name: folder.name.slice(0, 60)}});
  }
  for (const job of data.jobs) {
    const item = cleanJob(job,scope,connection);
    if (item) records.push({kind: 'jobs', item});
  }
  for (const character of data.characters) if (validId(character.id) && (scope==='local'?character.base===connection:validBase(character.base)) && typeof character.name === 'string') {
    const {id, name, base, image, audio, audioSeconds} = character;
    records.push({kind: 'characters', item: {
      id, name: name.slice(0, 100), base, image: safePath(image) ? image : undefined,
      audio: safePath(audio) ? audio : undefined, audioSeconds: Number.isFinite(audioSeconds) ? audioSeconds : undefined,
    }});
  }
  return records;
}

export function parseSnapshot(raw: string,scope:SyncScope='runpod'): SyncSnapshot {
  const parsed = JSON.parse(raw) as SyncSnapshot;
  if (parsed?.version !== 1 || !Array.isArray(parsed.records) || parsed.records.length > 6000 || !Array.isArray(parsed.hidden)) {
    throw new Error('The shared project data could not be read.');
  }
  if((parsed.scope||'runpod')!==scope)throw new Error('This pairing belongs to another app version. Create a code in Local PC settings.');
  const connection=scope==='local'?sharedPCBase(parsed.connection):'';
  const data: SyncData = {folders: [], jobs: [], characters: []};
  for (const record of parsed.records) {
    if (!record?.item || typeof record.item !== 'object') continue;
    if (record.kind === 'folders') data.folders.push(record.item as Folder);
    if (record.kind === 'jobs') data.jobs.push(record.item as Job);
    if (record.kind === 'characters') data.characters.push(record.item as Character);
  }
  return {version: 1, records: cleanRecords(data,scope,connection), hidden: parsed.hidden.filter(validId),...(scope==='local'?{removed:Array.isArray(parsed.removed)?parsed.removed.filter(value=>typeof value==='string'&&/^(folders|characters):[a-zA-Z0-9_-]{1,180}$/.test(value)).slice(0,12000):[]}:{}),...(scope==='local'?{scope,connection}:{})};
}

async function fingerprint(record: SyncRecord) {
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash.slice(0, 12), value => value.toString(16).padStart(2, '0')).join('');
}

export async function mergeSync(local: SyncData, remote: SyncSnapshot, seen: SeenRecords,scope:SyncScope='runpod',connection='') {
  if((remote.scope||'runpod')!==scope)throw new Error('Pairing scope does not match.');
  if(scope==='local'){remote=structuredClone(remote);connection=sharedPCBase(connection||remote.connection);if(remote.connection!==connection)throw new Error('This pairing uses a different PC.');local=canonicalLocalData(local,connection);}
  const sharedJobIds = new Set(remote.records.filter(record => record.kind === 'jobs').map(record => record.item.id));
  const removed=new Set(scope==='local'?remote.removed||[]:[]);
  if(scope==='local')for(const kind of ['folders','characters'] as const){const ids=new Set(local[kind].map(item=>item.id));for(const key of Object.keys(seen))if(key.startsWith(kind+':')&&!ids.has(key.slice(kind.length+1)))removed.add(key);}
  const hidden = new Set([...(scope==='local'?[]:remote.hidden), ...(scope==='local'?[]:local.jobs.filter(job => job.hidden && sharedJobIds.has(job.id)).map(job => job.id))]);
  const shared = new Map(remote.records.filter(record => !removed.has(keyOf(record)) && (scope==='local'||record.kind !== 'jobs' || !hidden.has(record.item.id)))
    .map(record => [keyOf(record), record]));
  const localRecords = cleanRecords(local,scope,connection);
  const hashes = new Map(await Promise.all(localRecords.map(async record => [keyOf(record), await fingerprint(record)] as const)));
  for (const record of localRecords) {
    const key = keyOf(record);
    if (removed.has(key) || (scope!=='local'&&record.kind === 'jobs' && hidden.has(record.item.id))) continue;
    const existing=shared.get(key);
    if(scope==='local'&&record.kind==='jobs'&&existing?.kind==='jobs'){
      const remoteVisibility=(existing.item as Job).visibilityChangedAt||0,localVisibility=(record.item as Job).visibilityChangedAt||0;
      if(remoteVisibility>localVisibility){record.item={...record.item,hidden:(existing.item as Job).hidden,visibilityChangedAt:remoteVisibility};}
      else if(localVisibility>remoteVisibility){existing.item={...existing.item,hidden:(record.item as Job).hidden,visibilityChangedAt:localVisibility};}
      const rank=(state:string)=>['complete','error','cancelled'].includes(state)?3:state==='running'?2:state==='queued'?1:0;
      const remoteRank=rank((existing.item as Job).state),localRank=rank((record.item as Job).state);
      if(remoteRank>localRank)continue;
      if(localRank>remoteRank){shared.set(key,record);continue;}
    }
    if (!shared.has(key) || hashes.get(key) !== seen[key]) shared.set(key, record);
  }

  if(scope==='local')for(const record of shared.values())if(record.kind==='jobs'){const job=record.item as Job;if(job.hidden)hidden.add(job.id);if(job.folder&&removed.has('folders:'+job.folder))job.folder=undefined;}
  const incoming: SyncData = {folders: [], jobs: [], characters: []};
  const nextSeen = {...seen};
  for (const [key, record] of shared) {
    const hash = await fingerprint(record);
    const localHash = hashes.get(key);
    // A removed device record stays removed locally. Its shared copy remains available to new devices.
    if (localHash !== hash && (localHash !== undefined || !seen[key] || (scope==='local'&&record.kind==='jobs'&&((record.item as Job).hidden||seen['visibility:'+record.item.id]==='hidden')))) {
      if (record.kind === 'folders') incoming.folders.push(record.item as Folder);
      if (record.kind === 'jobs' && (scope==='local'||!local.jobs.some(job => job.id === record.item.id && job.hidden))) incoming.jobs.push(record.item as Job);
      if (record.kind === 'characters') incoming.characters.push(record.item as Character);
    }
    nextSeen[key] = hash;
    if(scope==='local'&&record.kind==='jobs')nextSeen['visibility:'+record.item.id]=(record.item as Job).hidden?'hidden':'visible';
  }
  const snapshot: SyncSnapshot = {version: 1, records: [...shared.values()], hidden: [...hidden],...(scope==='local'?{scope,connection,removed:[...removed]}:{})};
  return {snapshot, incoming, removed:[...removed], hidden:[...hidden], seen: nextSeen, changed: JSON.stringify(remote) !== JSON.stringify(snapshot)};
}

// Hidden records remain in the encrypted room while a device's Hidden folder is locked.
export function applyLocalSync(local:SyncData,merged:Awaited<ReturnType<typeof mergeSync>>,canReadHidden:boolean):SyncData {
 const removed=new Set(merged.removed),hidden=new Set(merged.hidden);
 function combine<T extends {id:string}>(items:T[],incoming:T[]){const map=new Map(items.map(item=>[item.id,item]));for(const item of incoming)map.set(item.id,{...map.get(item.id),...item});return [...map.values()];}
 const folders=combine(local.folders,merged.incoming.folders).filter(item=>!removed.has('folders:'+item.id));
 const characters=combine(local.characters,merged.incoming.characters).filter(item=>!removed.has('characters:'+item.id));
 const jobs=combine(local.jobs,merged.incoming.jobs).filter(job=>!hidden.has(job.id)||canReadHidden).map(job=>({...job,folder:job.folder&&removed.has('folders:'+job.folder)?undefined:job.folder}));
 return {folders,characters,jobs};
}

const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
export const newPairCode = () => 'PS1-' + b64(crypto.getRandomValues(new Uint8Array(32)));

export async function pairKeys(code: string) {
  if (!/^PS1-[a-zA-Z0-9_-]{43}$/.test(code)) throw new Error('Paste the full Pocket Studio pairing code.');
  const secret = unb64(code.slice(4));
  const key = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const tokenBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('pocket-sync-room-v1:' + code)));
  return {key, token: Array.from(tokenBytes, byte => byte.toString(16).padStart(2, '0')).join('')};
}

export async function sealSnapshot(snapshot: SyncSnapshot, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, key, new TextEncoder().encode(JSON.stringify(snapshot)));
  return '1.' + b64(iv) + '.' + b64(new Uint8Array(bytes));
}

export async function openSnapshot(body: string, key: CryptoKey,scope:SyncScope='runpod') {
  const [version, iv, cipher] = body.split('.');
  if (version !== '1' || !iv || !cipher || body.length > 2_000_000) throw new Error('Invalid sync data.');
  const bytes = await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(iv)}, key, unb64(cipher));
  return parseSnapshot(new TextDecoder().decode(bytes),scope);
}
