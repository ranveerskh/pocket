import type {Character} from './reference-model';
import type {Folder, Job} from './vault';

export type SyncData = {folders: Folder[]; jobs: Job[]; characters: Character[]};
type RecordData = Folder | Job | Character;
type SyncRecord = {kind: 'folders' | 'jobs' | 'characters'; item: RecordData};
export type SyncSnapshot = {version: 1; records: SyncRecord[]; hidden: string[]};
export type SeenRecords = Record<string, string>;

const keyOf = ({kind, item}: SyncRecord) => kind + ':' + item.id;
const validId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,180}$/.test(value);
const validBase = (value: unknown) => typeof value === 'string' && /^https:\/\/[a-z0-9-]+\.proxy\.runpod\.net$/.test(value);
const safePath = (value: unknown) => typeof value === 'string' && value.length < 400 && !value.includes('..') && !value.startsWith('/') && !value.includes('\\');

function cleanJob(job: Job): Job | undefined {
  if (!validId(job.id) || job.hidden || job.state !== 'complete' || !validBase(job.base) ||
    typeof job.prompt !== 'string' || job.prompt.length > 30_000 || !Array.isArray(job.files) ||
    !Number.isFinite(job.created) || !Number.isFinite(job.seed) || !Number.isFinite(job.duration)) return;
  const files = job.files.filter(file => file && file.type === 'output' && safePath(file.filename) &&
    !file.filename.includes('/') && safePath(file.subfolder)).map(file => ({
    filename: file.filename, subfolder: file.subfolder, type: 'output', ...(file.podDeleted ? {podDeleted: true} : {}),
  }));
  if (!files.length) return;
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
    state: 'complete', files,
  };
}

function cleanRecords(data: SyncData): SyncRecord[] {
  const records: SyncRecord[] = [];
  for (const folder of data.folders) if (validId(folder.id) && typeof folder.name === 'string') {
    records.push({kind: 'folders', item: {id: folder.id, name: folder.name.slice(0, 60)}});
  }
  for (const job of data.jobs) {
    const item = cleanJob(job);
    if (item) records.push({kind: 'jobs', item});
  }
  for (const character of data.characters) if (validId(character.id) && validBase(character.base) && typeof character.name === 'string') {
    const {id, name, base, image, audio, audioSeconds} = character;
    records.push({kind: 'characters', item: {
      id, name: name.slice(0, 100), base, image: safePath(image) ? image : undefined,
      audio: safePath(audio) ? audio : undefined, audioSeconds: Number.isFinite(audioSeconds) ? audioSeconds : undefined,
    }});
  }
  return records;
}

export function parseSnapshot(raw: string): SyncSnapshot {
  const parsed = JSON.parse(raw) as SyncSnapshot;
  if (parsed?.version !== 1 || !Array.isArray(parsed.records) || parsed.records.length > 6000 || !Array.isArray(parsed.hidden)) {
    throw new Error('The shared project data could not be read.');
  }
  const data: SyncData = {folders: [], jobs: [], characters: []};
  for (const record of parsed.records) {
    if (!record?.item || typeof record.item !== 'object') continue;
    if (record.kind === 'folders') data.folders.push(record.item as Folder);
    if (record.kind === 'jobs') data.jobs.push(record.item as Job);
    if (record.kind === 'characters') data.characters.push(record.item as Character);
  }
  return {version: 1, records: cleanRecords(data), hidden: parsed.hidden.filter(validId)};
}

async function fingerprint(record: SyncRecord) {
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash.slice(0, 12), value => value.toString(16).padStart(2, '0')).join('');
}

export async function mergeSync(local: SyncData, remote: SyncSnapshot, seen: SeenRecords) {
  const sharedJobIds = new Set(remote.records.filter(record => record.kind === 'jobs').map(record => record.item.id));
  const hidden = new Set([...remote.hidden, ...local.jobs.filter(job => job.hidden && sharedJobIds.has(job.id)).map(job => job.id)]);
  const shared = new Map(remote.records.filter(record => record.kind !== 'jobs' || !hidden.has(record.item.id))
    .map(record => [keyOf(record), record]));
  const localRecords = cleanRecords(local);
  const hashes = new Map(await Promise.all(localRecords.map(async record => [keyOf(record), await fingerprint(record)] as const)));
  for (const record of localRecords) {
    const key = keyOf(record);
    if (record.kind === 'jobs' && hidden.has(record.item.id)) continue;
    if (!shared.has(key) || hashes.get(key) !== seen[key]) shared.set(key, record);
  }

  const incoming: SyncData = {folders: [], jobs: [], characters: []};
  const nextSeen = {...seen};
  for (const [key, record] of shared) {
    const hash = await fingerprint(record);
    const localHash = hashes.get(key);
    // A removed device record stays removed locally. Its shared copy remains available to new devices.
    if (localHash !== hash && (localHash !== undefined || !seen[key])) {
      if (record.kind === 'folders') incoming.folders.push(record.item as Folder);
      if (record.kind === 'jobs' && !local.jobs.some(job => job.id === record.item.id && job.hidden)) incoming.jobs.push(record.item as Job);
      if (record.kind === 'characters') incoming.characters.push(record.item as Character);
    }
    nextSeen[key] = hash;
  }
  const snapshot: SyncSnapshot = {version: 1, records: [...shared.values()], hidden: [...hidden]};
  return {snapshot, incoming, seen: nextSeen, changed: JSON.stringify(remote) !== JSON.stringify(snapshot)};
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

export async function openSnapshot(body: string, key: CryptoKey) {
  const [version, iv, cipher] = body.split('.');
  if (version !== '1' || !iv || !cipher || body.length > 2_000_000) throw new Error('Invalid sync data.');
  const bytes = await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(iv)}, key, unb64(cipher));
  return parseSnapshot(new TextDecoder().decode(bytes));
}
