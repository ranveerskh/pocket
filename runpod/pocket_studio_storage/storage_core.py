"""Authenticated, receipt-based deletion of individual ComfyUI output media files."""
import base64
import hashlib
import hmac
import json
import os
import stat
import time
from pathlib import Path

EXTENSIONS = {'.mp4', '.webm', '.mov', '.mkv', '.png', '.jpg', '.jpeg', '.webp', '.gif'}
MAX_SIZE = 1024 * 1024 * 1024


class OutputStorage:
    def __init__(self, root, key, clock=time.time):
        self.root = Path(root).resolve(strict=True)
        self.key = key.encode()
        self.clock = clock

    def _parts(self, item):
        name, folder = item.get('filename'), item.get('subfolder', '')
        if item.get('type', 'output') != 'output':
            raise ValueError('Only output media can be deleted. Inputs and models are protected.')
        if not isinstance(name, str) or not isinstance(folder, str) or not name or len(name) > 255 or len(folder) > 1000:
            raise ValueError('Invalid output filename.')
        if any(ord(c) < 32 for c in name + folder) or '\\' in name + folder or '/' in name or ':' in name + folder:
            raise ValueError('Invalid output path.')
        parts = folder.split('/') if folder else []
        if any(p in ('', '.', '..') for p in parts) or name in ('.', '..') or folder.startswith('/'):
            raise ValueError('Invalid output path.')
        if Path(name).suffix.lower() not in EXTENSIONS:
            raise ValueError('Only generated image/video files can be deleted.')
        return parts + [name]

    def _parent(self, item):
        parts = self._parts(item)
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        fd = os.open(str(self.root), flags)
        try:
            for part in parts[:-1]:
                new = os.open(part, flags, dir_fd=fd)
                os.close(fd)
                fd = new
            return fd, parts[-1]
        except BaseException:
            os.close(fd)
            raise

    @staticmethod
    def _stamp(s):
        return [s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns]

    def _inspect(self, fd, name):
        s = os.stat(name, dir_fd=fd, follow_symlinks=False)
        if not stat.S_ISREG(s.st_mode):
            raise ValueError('Directories, links and special files cannot be deleted.')
        if s.st_size > MAX_SIZE:
            raise ValueError('This file exceeds the 1 GB app deletion limit. Use Jupyter for this file.')
        file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
        with os.fdopen(file_fd, 'rb') as stream:
            before = os.fstat(stream.fileno())
            if self._stamp(before) != self._stamp(s):
                raise ValueError('File changed. Review deletion again.')
            digest = hashlib.sha256()
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
            after = os.fstat(stream.fileno())
        if self._stamp(after) != self._stamp(before):
            raise ValueError('File changed while checking. Review deletion again.')
        return {'stamp': self._stamp(after), 'sha256': digest.hexdigest()}

    def _sign(self, payload):
        raw = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip('=') + '.' + hmac.new(self.key, raw, hashlib.sha256).hexdigest()

    def _verify(self, token):
        if not isinstance(token, str) or len(token) > 8192:
            raise ValueError('Review the files before deleting.')
        try:
            raw64, signature = token.split('.')
            raw = base64.urlsafe_b64decode(raw64 + '=' * (-len(raw64) % 4))
            if not hmac.compare_digest(hmac.new(self.key, raw, hashlib.sha256).hexdigest(), signature):
                raise ValueError()
            payload = json.loads(raw)
            if payload['expires'] < self.clock() or payload['expires'] > self.clock() + 901:
                raise ValueError()
            self._parts(payload['file'])
            return payload
        except (KeyError, ValueError, TypeError, json.JSONDecodeError):
            raise ValueError('Deletion review expired or is invalid. Review the files again.') from None

    def plan(self, item):
        fd, name = self._parent(item)
        try:
            identity = self._inspect(fd, name)
            file = {'filename': item['filename'], 'subfolder': item.get('subfolder', ''), 'type': 'output'}
            payload = {'file': file, 'identity': identity, 'expires': int(self.clock()) + 900}
            return {**file, 'size': identity['stamp'][2], 'sha256': identity['sha256'], 'receipt': self._sign(payload)}
        finally:
            os.close(fd)

    def delete(self, receipt):
        payload = self._verify(receipt)
        item = payload['file']
        fd, name = self._parent(item)
        try:
            try:
                identity = self._inspect(fd, name)
            except FileNotFoundError:
                return {**item, 'status': 'already_missing'}
            if identity != payload['identity']:
                raise ValueError('File changed since review; nothing was deleted. Review it again.')
            # The parent descriptor is held throughout: symlink/path replacement cannot redirect the unlink.
            current = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if self._stamp(current) != identity['stamp']:
                raise ValueError('File changed; nothing was deleted.')
            os.unlink(name, dir_fd=fd)
            return {**item, 'status': 'deleted'}
        finally:
            os.close(fd)
