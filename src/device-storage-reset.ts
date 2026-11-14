export function deviceStoragePlan(local:boolean,storage:Storage){
 const prefix=local?'local:pocket-':'pocket-',keys:string[]=[];
 for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(prefix))keys.push(key);}
 return {keys,databases:[local?'pocket-local-device-media':'pocket-device-media',local?'pocket-local-folder-export':'pocket-folder-export']};
}
export async function eraseDeviceStorage(local:boolean,storage:Storage,deleteDatabase:(name:string)=>Promise<void>){
 const plan=deviceStoragePlan(local,storage);
 // Clear media before metadata so a blocked database keeps recovery records available.
 for(const name of plan.databases)await deleteDatabase(name);
 for(const key of plan.keys)storage.removeItem(key);
}
