import {useEffect, useRef, useState} from 'react';
import {Film, Image as ImageIcon} from 'lucide-react';
import {useDeviceMedia} from './LocalMedia';
import {mediaKey} from './media-db';
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
  const file = job.files?.[0];
  const key = file ? mediaKey(job, file) : '';
  const saved = media.saved.has(key);
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
    if (!visible || !file || !saved) return;
    let gone = false;
    let url = '';
    posterQueue = posterQueue.then(async () => {
      if (gone) return;
      const blob = await media.read(job, file);
      if (!blob || gone) return;
      if (job.mode === 'image'||/\.(png|jpe?g|webp)$/i.test(file.filename)) {
        url = URL.createObjectURL(blob);
        setPoster(url);
      } else {
        const thumbnail = await videoPoster(blob);
        if (!gone) setPoster(thumbnail);
      }
    }).catch(() => {});
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
      setPoster('');
    };
  }, [visible, key, saved, job.hidden, media.changes[job.id]]);

  return <span ref={anchor} className="media-poster" aria-hidden="true">
    {poster ? <img src={poster} alt=""/> : job.mode === 'image' ? <ImageIcon size={24}/> : <Film size={24}/>}
  </span>;
}
