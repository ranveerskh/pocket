import {useEffect, useRef, useState} from 'react';
import {Film, Image as ImageIcon} from 'lucide-react';
import {useDeviceMedia} from './LocalMedia';
import {mediaKey,remoteMediaURL} from './media-db';
import {isLocal} from './local-mode';
import type {Job} from './vault';

let posterQueue: Promise<void> = Promise.resolve();

function videoPoster(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(blob);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const timer = setTimeout(() => finish(), 6000);
    function finish(poster?: string) {
      clearTimeout(timer);
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      if (poster) resolve(poster);
      else reject(new Error('Thumbnail unavailable.'));
    }
    video.onerror = () => finish();
    video.onloadeddata = () => {
      try {
        if (!video.videoWidth || !video.videoHeight) return finish();
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(video.videoWidth, 320);
        canvas.height = Math.max(1, Math.round(video.videoHeight * canvas.width / video.videoWidth));
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        finish();
      }
    };
    video.src = url;
  });
}

export default function MediaPoster({job}: {job: Job}) {
  const media = useDeviceMedia();
  const anchor = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [poster, setPoster] = useState('');
  const [fallback,setFallback]=useState('');
  const [failedSource,setFailedSource]=useState('');
  const file = job.files?.[0];
  const key = file ? mediaKey(job, file) : '';
  const saved = media.saved.has(key);
  const image=job.mode==='image'||/\.(png|jpe?g|webp)$/i.test(file?.filename||'');
  useEffect(() => {
    if (!anchor.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), {rootMargin: '160px'});
    observer.observe(anchor.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !file) return;
    const remote=isLocal&&job.base&&!file.podDeleted?remoteMediaURL(job.base,file):'';
    if(!saved){setFallback(remote);return;}
    setFallback('');
    let gone = false;
    let url = '';
    posterQueue = posterQueue.then(async () => {
      if (gone) return;
      const blob = await media.read(job, file);
      if(gone)return;
      if(!blob){setFallback(remote);return;}
      if (image) {
        url = URL.createObjectURL(blob);
        setPoster(url);
      } else {
        try{const thumbnail = await videoPoster(blob);if(!gone)setPoster(thumbnail);}
        catch{if(!gone&&isLocal){url=URL.createObjectURL(blob);setFallback(url);}}
      }
    }).catch(()=>{if(!gone)setFallback(remote);});
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
      setPoster('');
      setFallback('');
    };
  }, [visible, key, saved, job.hidden,job.base,file?.podDeleted,image,media.changes[job.id]]);

  return <span ref={anchor} className="media-poster" aria-hidden="true">
    {poster&&failedSource!==poster?<img src={poster} alt="" onError={()=>setFailedSource(poster)}/>:visible&&fallback&&failedSource!==fallback?(image?<img src={fallback} alt="" loading="lazy" onError={()=>setFailedSource(fallback)}/>:<video src={fallback+'#t=0.1'} muted playsInline preload="metadata" onError={()=>setFailedSource(fallback)}/>):image?<ImageIcon size={24}/>:<Film size={24}/>}
  </span>;
}
