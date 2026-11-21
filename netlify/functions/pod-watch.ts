import {watchStore,checkWatch,type PodWatch} from '../../server/pod-watch.ts';
// Published scheduled function; does not depend on any browser or device.
export default async function(){
 const store=watchStore(),pending:{key:string;checkedAt:number}[]=[];
 for await(const page of store.list({paginate:true})){
  await Promise.all(page.blobs.map(async b=>{const w=await store.get(b.key,{type:'json'}) as PodWatch|null;if(w&&['armed','idle','stopping'].includes(w.state))pending.push({key:b.key,checkedAt:w.checkedAt||0});}));
 }
 // Bound each invocation to three independent pods within the 30-second limit.
 // Oldest checks first ensure multiple accounts make progress on later ticks.
 await Promise.allSettled(pending.sort((a,b)=>a.checkedAt-b.checkedAt).slice(0,3).map(w=>checkWatch(w.key)));
}
export const config={schedule:'* * * * *'};
