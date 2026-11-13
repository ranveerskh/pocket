import {getStore} from '@netlify/blobs';
const TTL=5*60_000;
const headers={'Cache-Control':'no-store'};
const reply=(status:number,error:string)=>Response.json({error},{status,headers});
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
type Invite={secret?:string;base:string;expiresAt:number;owner:string;used?:boolean;pending?:{hash:string;device:string;approved:boolean}};
async function bounded(request:Request){const reader=request.body?.getReader();if(!reader)return '';let size=0;const chunks:Uint8Array[]=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1500){await reader.cancel();throw Error('Request too large.');}chunks.push(value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(bytes);}
export default async function pairing(request:Request,context:{ip?:string}={}){
 if(request.method!=='POST')return reply(405,'Method unavailable.');
 if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return reply(403,'Cross-site request rejected.');
 try{
  const store=getStore({name:'pocket-local-pairing-v1',consistency:'strong'});
  const p=JSON.parse(await bounded(request));
  const auth=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  async function rate(action:string,max:number,window:number){
   const ip=context.ip||request.headers.get('x-nf-client-connection-ip');if(!ip)throw Error('Client address unavailable.');
   const key='rate/'+await hash(action+':'+ip);
   for(let i=0;i<5;i++){
    const old=await store.getWithMetadata(key,{type:'json'});const entry=old?.data as any;const current=Number(entry?.expiresAt)>Date.now();const count=current?Number(entry.count||0):0;
    if(count>=max)return false;
    const result=await store.setJSON(key,{count:count+1,expiresAt:current?entry.expiresAt:Date.now()+window},old?.etag?{onlyIfMatch:old.etag}:{onlyIfNew:true});if(result.modified)return true;
   }return false;
  }
  if(p.action==='create'){
   if(!auth||typeof p.secret!=='string'||!/^PS1-[a-zA-Z0-9_-]{43}$/.test(p.secret)||auth!==await hash('pocket-sync-room-v1:'+p.secret))return reply(401,'A paired device is required.');
   if(typeof p.base!=='string'||!/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(p.base))return reply(400,'Use your PC Tailscale HTTPS address.');
   if(!await rate('create',10,15*60_000))return reply(429,'Too many pairing codes. Try again in 15 minutes.');
   for(let i=0;i<30;i++){
    const pin=String(1000+crypto.getRandomValues(new Uint32Array(1))[0]%9000),key='pin/'+pin;
    const old=await store.getWithMetadata(key,{type:'json'});if(old&&Number((old.data as any)?.expiresAt)>Date.now())continue;
    const data:Invite={secret:p.secret,base:p.base,expiresAt:Date.now()+TTL,owner:auth};
    const result=await store.setJSON(key,data,old?.etag?{onlyIfMatch:old.etag}:{onlyIfNew:true});
    if(result.modified)return Response.json({pin,expiresAt:data.expiresAt},{headers});
   }return reply(503,'Pairing is busy. Try again shortly.');
  }
  if(typeof p.pin!=='string'||!/^\d{4}$/.test(p.pin))return reply(400,'Enter the 4-digit pairing code.');
  if(p.action==='join'&&!await rate('join',5,15*60_000))return reply(429,'Too many pairing attempts. Try again in 15 minutes.');
  const key='pin/'+p.pin;
  const old=await store.getWithMetadata(key,{type:'json'});const data=old?.data as Invite|undefined;
  if(!old?.etag||!data||data.used||data.expiresAt<=Date.now())return reply(404,'Code expired or already used. Create another code on the first device.');
  const save=(next:Invite)=>store.setJSON(key,next,{onlyIfMatch:old.etag});
  if(p.action==='join'){
   if(data.pending)return reply(409,'A device is already waiting. Check the first device or create another code.');
   const ticket=random();const device=typeof p.device==='string'?p.device.slice(0,60):'Another device';
   if(!(await save({...data,pending:{hash:await hash(ticket),device,approved:false}})).modified)return reply(409,'Code just changed. Try again.');
   return Response.json({ticket,expiresAt:data.expiresAt},{headers});
  }
  if(p.action==='peek'||p.action==='approve'){
   if(!auth||auth!==data.owner)return reply(401,'Use the first paired device.');
   if(p.action==='approve'){
    if(!data.pending||p.request!==data.pending.hash)return reply(409,'Pairing request changed.');
    if(!(await save({...data,pending:{...data.pending,approved:true}})).modified)return reply(409,'Pairing request changed. Try again.');
   }
   return Response.json({pending:data.pending?{request:data.pending.hash,device:data.pending.device,approved:p.action==='approve'||data.pending.approved}:null},{headers});
  }
  if(p.action==='status'){
   if(typeof p.ticket!=='string'||!/^[a-f0-9]{64}$/.test(p.ticket)||!data.pending||await hash(p.ticket)!==data.pending.hash)return reply(401,'Invalid pairing request.');
   if(!data.pending.approved)return Response.json({waiting:true},{headers});
   if(!(await save({base:data.base,owner:data.owner,expiresAt:data.expiresAt,used:true})).modified)return reply(409,'Pairing just changed. Try again.');
   return Response.json({secret:data.secret,base:data.base},{headers});
  }
  return reply(400,'Unknown pairing action.');
 }catch{return reply(503,'Pairing is temporarily unavailable. Try again shortly.');}
}
