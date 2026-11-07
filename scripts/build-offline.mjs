import fs from 'node:fs';
import {offlineShell} from './offline-shell.mjs';
const assets=fs.readdirSync('dist/assets').filter(n=>/\.(js|css)$/.test(n)).map(n=>'/assets/'+n);
assets.push('/manifest.webmanifest','/pocket-studio.svg','/pocket-180.png','/pocket-192.png','/pocket-512.png');
fs.writeFileSync('dist/sw.js',offlineShell(assets));
console.log('Offline app shell prepared; API responses and media are not put in shared caches.');
