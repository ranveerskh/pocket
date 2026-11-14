/** Invoke directly from a tap when the File is ready, preserving iOS user activation. */
export function prefersNativeSave(){
 return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)||(/Mac/i.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
}
export function downloadFile(file:File){
 const url=URL.createObjectURL(file),anchor=document.createElement('a');
 anchor.href=url;anchor.download=file.name;document.body.append(anchor);anchor.click();anchor.remove();
 // Leave time for the browser to start its download before releasing the blob.
 setTimeout(()=>URL.revokeObjectURL(url),60_000);
}
export async function exportFile(file:File,native= prefersNativeSave()):Promise<'shared'|'downloaded'|'cancelled'|'needs-tap'>{
 if(native&&typeof navigator.share==='function'&&navigator.canShare?.({files:[file]})){
  try{await navigator.share({files:[file],title:file.name});return 'shared';}
  catch(error){if((error as Error).name==='AbortError')return 'cancelled';return 'needs-tap';}
 }
 downloadFile(file);return 'downloaded';
}
