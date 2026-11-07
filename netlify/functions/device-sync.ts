import {getStore} from '@netlify/blobs';

const MAX_BYTES = 2_000_000;
const headers = {'Cache-Control': 'no-store'};
const reply = (status: number, error: string) => Response.json({error}, {status, headers});

async function readBounded(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) return body + decoder.decode();
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, {stream: true});
    }
  } finally {
    reader.releaseLock();
  }
}

export default async function sync(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return reply(403, 'Cross-site request rejected.');
  const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return reply(401, 'A pairing code is required.');
  try {
    const store = getStore({name: 'pocket-device-sync-v1', consistency: 'strong'});
    if (request.method === 'GET') {
      const tag = request.headers.get('if-none-match') || undefined;
      const data = await store.getWithMetadata(token, {etag: tag, type: 'text'});
      if (!data) return reply(404, 'Pairing space not found.');
      if (data.data === null) return new Response(null, {status: 304, headers});
      if (!data.etag) return reply(503, 'Sync revision unavailable.');
      return new Response(data.data, {headers: {...headers, 'Content-Type': 'text/plain', ETag: data.etag}});
    }
    if (request.method !== 'PUT') return reply(405, 'Method unavailable.');
    const match = request.headers.get('if-match');
    const create = request.headers.get('if-none-match') === '*';
    if ((!match && !create) || (match && create) || match === '*') return reply(428, 'A sync revision is required.');
    const body = await readBounded(request);
    if (body === null) return reply(413, 'This project library is too large to sync.');
    if (!/^1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/.test(body)) return reply(400, 'Invalid encrypted sync data.');
    const result = await store.set(token, body, match ? {onlyIfMatch: match} : {onlyIfNew: true});
    if (!result.modified || !result.etag) return reply(412, 'The other device just synced. Retrying…');
    return new Response(null, {status: 204, headers: {...headers, ETag: result.etag}});
  } catch {
    return reply(503, 'Device sync storage is temporarily unavailable.');
  }
}
