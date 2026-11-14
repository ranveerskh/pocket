import {deviceResetting} from './reset-state.ts';
export const isLocal = typeof location !== 'undefined' && /^\/local\/?$/.test(location.pathname);
export function localBase(value:string) {
 let u:URL;
 try { u=new URL(value.trim()); } catch { throw new Error('Enter the PC address or your private Tailscale HTTPS address.'); }
 const loopback=u.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname) && ['','8188','8000'].includes(u.port);
 const tailscale=u.protocol==='https:' && /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i.test(u.hostname) && !u.port;
 if ((!loopback && !tailscale) || u.username || u.password || u.pathname!=='/' || u.search || u.hash) throw new Error('Use http://127.0.0.1:8188 on the PC or your private https://device.tailnet.ts.net address.');
 return u.origin;
}
export const localStorage:Storage = typeof window === 'undefined' ? (undefined as unknown as Storage) : new Proxy(window.localStorage,{get(target,prop) { if(['getItem','removeItem'].includes(String(prop))) return (key:string)=>{if(deviceResetting&&prop==='removeItem')return;return (target as any)[prop]((isLocal?'local:':'')+key);}; if(prop==='setItem')return (key:string,value:string)=>{if(!deviceResetting)target.setItem((isLocal?'local:':'')+key,value);}; const value=Reflect.get(target,prop,target); return typeof value==='function'?value.bind(target):value; }});
export function mediaURL(base:string,file:{filename:string;subfolder?:string;type?:string},download=false) { const p=new URLSearchParams({filename:file.filename,subfolder:file.subfolder||'',type:file.type||'output'}); if(isLocal) { try { return localBase(base)+'/view?'+p; } catch { return ''; } } p.set('base',base);p.set('download',download?'1':'0');return '/api/media?'+p; }
