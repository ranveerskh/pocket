"""Only temporary test outputs are ever deleted by these tests."""
import importlib.util
import pathlib
import tempfile
import unittest
import sys
import types
import hashlib
import contextlib
import io
from unittest.mock import patch

BASE = pathlib.Path(__file__).resolve().parents[1] / 'runpod' / 'pocket_studio_storage'
spec = importlib.util.spec_from_file_location('pocket_storage_core_test', BASE / 'storage_core.py')
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)

class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name) / 'output'
        self.root.mkdir()
        (self.root / 'video').mkdir()
        self.file = self.root / 'video' / 'test.mp4'
        self.file.write_bytes(b'test video')
        self.item = {'filename': 'test.mp4', 'subfolder': 'video', 'type': 'output'}
        self.clock = 1000
        self.store = core.OutputStorage(self.root, 'x' * 43, lambda: self.clock)
    def tearDown(self):
        self.temp.cleanup()
    def test_delete_and_retry(self):
        plan = self.store.plan(self.item)
        self.assertTrue(self.file.exists(), 'Planning must not delete')
        self.assertEqual(self.store.delete(plan['receipt'])['status'], 'deleted')
        self.assertFalse(self.file.exists())
        self.assertEqual(self.store.delete(plan['receipt'])['status'], 'already_missing')
    def test_changed_file_kept(self):
        plan = self.store.plan(self.item)
        self.file.write_bytes(b'replaced output')
        with self.assertRaises(ValueError): self.store.delete(plan['receipt'])
        self.assertTrue(self.file.exists())
    def test_expired_and_forged_kept(self):
        token = self.store.plan(self.item)['receipt']
        with self.assertRaises(ValueError): self.store.delete(token[:-1] + ('0' if token[-1] != '0' else '1'))
        self.clock += 901
        with self.assertRaises(ValueError): self.store.delete(token)
        self.assertTrue(self.file.exists())
    def test_paths_inputs_and_models_protected(self):
        for changes in [{'filename':'../secret.mp4'},{'subfolder':'../models'},{'subfolder':'/tmp'},{'subfolder':'a//b'},{'filename':'evil.py'},{'filename':'x\\test.mp4'},{'type':'input'},{'type':'temp'}]:
            with self.subTest(changes=changes):
                with self.assertRaises((ValueError, OSError)): self.store.plan({**self.item, **changes})
        self.assertTrue(self.file.exists())
    def test_links_protected(self):
        outside = pathlib.Path(self.temp.name) / 'outside'
        outside.mkdir()
        protected = outside / 'test.mp4'
        protected.write_bytes(b'keep')
        (self.root / 'linked').symlink_to(outside, target_is_directory=True)
        (self.root / 'video' / 'link.mp4').symlink_to(protected)
        for item in [{**self.item,'subfolder':'linked'},{**self.item,'filename':'link.mp4'}]:
            with self.assertRaises((ValueError, OSError)): self.store.plan(item)
        self.assertEqual(protected.read_bytes(), b'keep')
    def test_parent_swap_cannot_delete_outside(self):
        plan = self.store.plan(self.item)
        outside = pathlib.Path(self.temp.name) / 'outside'
        outside.mkdir()
        protected = outside / 'test.mp4'
        protected.write_bytes(b'keep')
        inspect = self.store._inspect
        def swap(fd, name):
            result = inspect(fd, name)
            (self.root / 'video').rename(self.root / 'previous-video')
            (self.root / 'video').symlink_to(outside, target_is_directory=True)
            return result
        self.store._inspect = swap
        self.assertEqual(self.store.delete(plan['receipt'])['status'], 'deleted')
        self.assertEqual(protected.read_bytes(), b'keep')
    def test_installer_preserves_key(self):
        installer_spec = importlib.util.spec_from_file_location('storage_installer_test', BASE.parent / 'install-storage-helper.py')
        module = importlib.util.module_from_spec(installer_spec)
        installer_spec.loader.exec_module(module)
        comfy = pathlib.Path(self.temp.name) / 'ComfyUI'
        comfy.mkdir()
        (comfy / 'main.py').write_text('# test fixture')
        (comfy / 'custom_nodes').mkdir()
        def source(url, timeout):
            return io.BytesIO((BASE / url.rsplit('/',1)[-1]).read_bytes())
        with patch.object(sys,'argv',['install','--comfy',str(comfy)]), patch.object(module.urllib.request,'urlopen',source), contextlib.redirect_stdout(io.StringIO()):
            module.main()
            key_file = comfy / 'custom_nodes' / 'pocket_studio_storage' / 'storage.key'
            first = key_file.read_text()
            self.assertGreaterEqual(len(first), 32)
            self.assertEqual(key_file.stat().st_mode & 0o777, 0o600)
            module.main()
            self.assertEqual(key_file.read_text(), first)

    def test_installer_checksums_match(self):
        installer_spec = importlib.util.spec_from_file_location('storage_installer', BASE.parent / 'install-storage-helper.py')
        module = importlib.util.module_from_spec(installer_spec)
        installer_spec.loader.exec_module(module)
        self.assertEqual(set(module.CHECKSUMS), {'__init__.py','storage_core.py'})
        for name, expected in module.CHECKSUMS.items():
            self.assertEqual(hashlib.sha256((BASE / name).read_bytes()).hexdigest(), expected)

# Exercise the actual helper routes when the ComfyUI HTTP dependency is available.
try:
    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer
    HTTP_AVAILABLE = True
except ImportError:
    HTTP_AVAILABLE = False

@unittest.skipUnless(HTTP_AVAILABLE, 'aiohttp is installed with ComfyUI; core tests still run without it')
class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        (self.root / 'video').mkdir()
        self.media = self.root / 'video' / 'sample.mp4'
        self.media.write_bytes(b'route test video')
        routes = web.RouteTableDef()
        fake_server = types.ModuleType('server')
        fake_server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes))
        fake_paths = types.ModuleType('folder_paths')
        fake_paths.get_output_directory = lambda: str(self.root)
        self.previous = {name:sys.modules.get(name) for name in ['server','folder_paths']}
        sys.modules['server'],sys.modules['folder_paths'] = fake_server,fake_paths
        name = '_pocket_storage_http_test'
        spec = importlib.util.spec_from_file_location(name, BASE / '__init__.py', submodule_search_locations=[str(BASE)])
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        module._KEY_FILE = self.root / 'key'
        module._KEY_FILE.write_text('x' * 43)
        app = web.Application()
        app.add_routes(routes)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        self.headers = {'Authorization':'Bearer ' + 'x' * 43}
    async def asyncTearDown(self):
        await self.client.close()
        for name,previous in self.previous.items():
            if previous is None: sys.modules.pop(name, None)
            else: sys.modules[name] = previous
        self.temp.cleanup()
    async def test_authentication_and_confirmation(self):
        r = await self.client.post('/pocket-studio/storage/delete', json={'confirmed':True,'receipt':'invalid'})
        self.assertEqual(r.status, 401)
        self.assertTrue(self.media.exists())
        r = await self.client.get('/pocket-studio/storage/status', headers=self.headers)
        self.assertEqual((await r.json())['protocol'], 1)
        r = await self.client.post('/pocket-studio/storage/plan', headers=self.headers, json={'file':{'filename':'sample.mp4','subfolder':'video','type':'output'}})
        plan = (await r.json())['file']
        self.assertTrue(self.media.exists())
        r = await self.client.post('/pocket-studio/storage/delete', headers=self.headers, json={'receipt':plan['receipt'],'confirmed':False})
        self.assertEqual(r.status, 400)
        self.assertTrue(self.media.exists())
        r = await self.client.post('/pocket-studio/storage/delete', headers=self.headers, json={'receipt':plan['receipt'],'confirmed':True})
        self.assertEqual((await r.json())['file']['status'], 'deleted')
        self.assertFalse(self.media.exists())
    async def test_changed_file_and_traversal(self):
        r = await self.client.post('/pocket-studio/storage/plan', headers=self.headers, json={'file':{'filename':'sample.mp4','subfolder':'video','type':'output'}})
        plan = (await r.json())['file']
        self.media.write_bytes(b'new version')
        r = await self.client.post('/pocket-studio/storage/delete', headers=self.headers, json={'receipt':plan['receipt'],'confirmed':True})
        self.assertEqual(r.status, 400)
        self.assertEqual(self.media.read_bytes(), b'new version')
        r = await self.client.post('/pocket-studio/storage/plan', headers=self.headers, json={'file':{'filename':'sample.mp4','subfolder':'../models','type':'output'}})
        self.assertEqual(r.status, 400)

if __name__ == '__main__':
    unittest.main()
