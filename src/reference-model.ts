export type Character={id:string;name:string;base:string;image?:string;audio?:string;audioSeconds?:number};
export type References={images:{path:string;name:string}[];audios:{path:string;name:string;seconds:number}[]};
// Keep saved choices for each pod separate; stale choices must not block this pod.
export function currentCharacterIds(characters:Character[],ids:string[],base:string):string[]{
 const available=new Set(characters.filter(c=>c.base===base).map(c=>c.id));
 return [...new Set(ids)].filter(id=>available.has(id));
}
export function selectCharactersForConnection(characters:Character[],ids:string[],base:string,next:string[]):string[]{
 const unique=[...new Set(next)];
 if(unique.some(id=>!characters.some(c=>c.id===id&&c.base===base)))throw new Error('Select references uploaded to this RunPod connection.');
 characterReferences(characters,unique,base);
 const other=ids.filter(id=>characters.some(c=>c.id===id&&c.base!==base));
 return [...new Set([...other,...unique])];
}
export function characterReferences(characters:Character[],ids:string[],base:string):References{
 const chosen=ids.map(id=>characters.find(c=>c.id===id)).filter((c):c is Character=>!!c);
 if(chosen.some(c=>c.base!==base))throw new Error('Select references uploaded to this RunPod connection.');
 if(chosen.length>3)throw new Error('Select up to 3 characters.');
 const refs={images:chosen.filter(c=>c.image).map(c=>({path:c.image!,name:c.name})),audios:chosen.filter(c=>c.audio).map(c=>({path:c.audio!,name:c.name,seconds:c.audioSeconds||0}))};
 if(refs.audios.some(a=>a.seconds<2||a.seconds>15)||refs.audios.reduce((sum,a)=>sum+a.seconds,0)>15.05)throw new Error('Voice clips must be 2–15 seconds each, with at most 15 seconds combined.');
 return refs;
}
export function referencePrompt(prompt:string,refs:References){
 const lines=[...refs.images.map((r,i)=>`${JSON.stringify(r.name)}: preserve identity and appearance from <Picture ${i+1}>.`),...refs.audios.map((r,i)=>`${JSON.stringify(r.name)}: follow the voice timbre of <Audio ${i+1}>; speak only the new dialogue specified below.`)];
 return lines.length?lines.join('\n')+'\n\nSCENE:\n'+prompt:prompt;
}
export function referenceFileURL(base:string,path:string){const i=path.lastIndexOf('/');return '/api/media?'+new URLSearchParams({base,filename:path.slice(i+1),subfolder:i<0?'':path.slice(0,i),type:'input'});}
