import {isLocal} from './local-mode';
import localAPI from './local-api';
import React from 'react';
import {createRoot} from 'react-dom/client';
import DeviceResetBoundary from './DeviceResetBoundary';
import './styles.css';
import './themes.css';
if(isLocal){ const originalFetch=window.fetch.bind(window); window.fetch=(input:RequestInfo|URL,init?:RequestInit)=>{ const url=typeof input==='string'?input:input instanceof URL?input.href:input.url; if(new URL(url,location.href).origin===location.origin && new URL(url,location.href).pathname==='/api/comfy') return localAPI(new Request(new URL(url,location.href),init)); return originalFetch(input,init); }; }
createRoot(document.getElementById('root')!).render(<DeviceResetBoundary/>);

if('serviceWorker' in navigator)window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(()=>{});});
