#!/usr/bin/env python3
"""Install Pocket Studio's output-only storage helper into an existing ComfyUI."""
import argparse
import hashlib
import os
from pathlib import Path
import secrets
import tempfile
import urllib.request

# Replaced when the helper source changes; failed verification never installs unknown bytes.
CHECKSUMS = {'__init__.py': '2662ebc19e0ef70fdc9bb7e66816253e22c5b800f31e4b9de88fe9dfde0e7c49', 'storage_core.py': '3d7dbc5a3f18447e52773b32e2e13b82fae1f0209ea7ce71d34e10342b1079a7'}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--comfy', default='/workspace/runpod-slim/ComfyUI')
    args = parser.parse_args()
    comfy = Path(args.comfy).resolve()
    if not (comfy / 'main.py').is_file() or not (comfy / 'custom_nodes').is_dir():
        raise SystemExit('ComfyUI was not found. Supply --comfy with the directory containing main.py and custom_nodes.')
    target = comfy / 'custom_nodes' / 'pocket_studio_storage'
    if target.is_symlink():
        raise SystemExit('Refusing to install into a linked directory.')
    # Download and verify both sources before changing an existing installation.
    downloaded = {}
    for name, expected in CHECKSUMS.items():
        url = 'https://raw.githubusercontent.com/ranveerskh/pocket/main/runpod/pocket_studio_storage/' + name
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read(200000)
        if hashlib.sha256(data).hexdigest() != expected:
            raise SystemExit('Source verification failed. Download the installer again and retry.')
        downloaded[name] = data
    if len(downloaded) != 2:
        raise SystemExit('Installer checksums are not configured.')
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name, data in downloaded.items():
        path = target / name
        if path.is_symlink():
            raise SystemExit('Refusing to replace a linked helper source.')
        with tempfile.NamedTemporaryFile(dir=target, prefix='.pocket-source-', delete=False) as stream:
            stream.write(data)
            temp = stream.name
        os.replace(temp, path)
    key_file = target / 'storage.key'
    if key_file.is_symlink():
        raise SystemExit('Refusing to use a linked key file.')
    if not key_file.exists():
        with open(key_file, 'x') as stream:
            os.chmod(key_file, 0o600)
            stream.write(secrets.token_urlsafe(32))
    print('Installed. Restart ComfyUI when no generations are active (do not terminate your Pod).')
    print('Paste this Storage key into Pocket Studio; it is not an API or billing key:')
    print(key_file.read_text().strip())
    print('Keep it private. Re-running this installer preserves the same key.')

if __name__ == '__main__':
    main()
