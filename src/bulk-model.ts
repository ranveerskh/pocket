export type BulkFormat='auto'|'lines'|'blocks';
export function parseBulk(text:string,format:BulkFormat='auto'){
 const input=text.trim();let prompts:string[];
 if(format==='auto'&&input.startsWith('*')){
  prompts=[];let cursor=0;
  while(cursor<input.length){
   while(/\s/.test(input[cursor]||'')&&cursor<input.length)cursor++;
   if(cursor===input.length)break;
   if(input[cursor]!=='*')throw new Error('Wrap every prompt in *…*. Only spaces or new lines can go between prompts.');
   const end=input.indexOf('*',cursor+1);
   if(end<0)throw new Error('The last prompt needs a closing *.');
   const prompt=input.slice(cursor+1,end).trim();
   if(!prompt)throw new Error('A *…* prompt cannot be empty.');
   prompts.push(prompt);cursor=end+1;
  }
 }else prompts=(format==='blocks'?input.split(/\r?\n\s*\r?\n/):input.split(/\r?\n/)).map(p=>p.trim()).filter(Boolean);
 if(!prompts.length)throw new Error('Paste at least one prompt.');
 if(prompts.length>50)throw new Error('Use at most 50 prompts per batch.');
 if(prompts.some(p=>p.length>20000))throw new Error('Each prompt must be under 20,000 characters.');
 return prompts;
}
export function chunks<T>(items:T[],size=5){const out:T[][]=[];for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));return out;}

export function jobsInBatch<T extends {batchId?:string}>(jobs:T[],batchId?:string){return batchId?jobs.filter(j=>j.batchId===batchId):[];}
