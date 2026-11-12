import React from 'react';
import {createRoot} from 'react-dom/client';
import Studio from './Studio';
import './styles.css';
import './themes.css';
createRoot(document.getElementById('root')!).render(<Studio/>);

if('serviceWorker' in navigator)window.addEventListener('load',()=>{void navigator.serviceWorker.register('/sw.js').catch(()=>{});});
