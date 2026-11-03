"""Pocket Studio storage helper. No executable model nodes, no file-listing route."""
import asyncio
import hmac
import json
import os
from pathlib import Path

from aiohttp import web
import folder_paths
from server import PromptServer
from .storage_core import OutputStorage

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
_KEY_FILE = Path(__file__).with_name('storage.key')

def _authorized(request):
    try:
        key = _KEY_FILE.read_text().strip()
    except OSError:
        return None
    supplied = request.headers.get('Authorization', '')
    if len(key) < 32 or not supplied.isascii() or not hmac.compare_digest(supplied, 'Bearer ' + key):
        return None
    return key

async def _body(request):
    raw = await request.read()
    if len(raw) > 65536:
        raise ValueError('Request is too large.')
    return json.loads(raw)

def _error(exc):
    if isinstance(exc, FileNotFoundError):
        return 'File not found in this pod output folder. Use Find on current pod before deleting.'
    if isinstance(exc, (ValueError, TypeError)):
        return str(exc)
    return 'Could not access this output file. Check file permissions and try again.'

@PromptServer.instance.routes.get('/pocket-studio/storage/status')
async def storage_status(request):
    if not _authorized(request):
        return web.json_response({'error': 'Storage key is missing or incorrect.'}, status=401)
    return web.json_response({'protocol': 1, 'output_delete': True, 'max_files': 1}, headers={'Cache-Control': 'no-store'})

@PromptServer.instance.routes.post('/pocket-studio/storage/plan')
async def storage_plan(request):
    key = _authorized(request)
    if not key:
        return web.json_response({'error': 'Storage key is missing or incorrect.'}, status=401)
    try:
        payload = await _body(request)
        store = OutputStorage(folder_paths.get_output_directory(), key)
        file = await asyncio.to_thread(store.plan, payload['file'])
        return web.json_response({'file': file}, headers={'Cache-Control': 'no-store'})
    except Exception as exc:
        return web.json_response({'error': _error(exc)}, status=400)

@PromptServer.instance.routes.post('/pocket-studio/storage/delete')
async def storage_delete(request):
    key = _authorized(request)
    if not key:
        return web.json_response({'error': 'Storage key is missing or incorrect.'}, status=401)
    try:
        payload = await _body(request)
        if payload.get('confirmed') is not True:
            raise ValueError('Confirm deletion in Pocket Studio first.')
        store = OutputStorage(folder_paths.get_output_directory(), key)
        file = await asyncio.to_thread(store.delete, payload.get('receipt'))
        return web.json_response({'file': file}, headers={'Cache-Control': 'no-store'})
    except Exception as exc:
        return web.json_response({'error': _error(exc)}, status=400)
