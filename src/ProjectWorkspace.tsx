import {createPortal} from 'react-dom';
import {isLocal,localStorage} from './local-mode';
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, Film, Play, Plus, RotateCcw, Square, X} from 'lucide-react';
import LocalMedia, {DeviceBadge} from './LocalMedia';
import DownloadButton from './DownloadButton';
import MediaPoster from './MediaPoster';
import {creationLabel, creationTitle, galleryItems, type GallerySort} from './gallery-model';
import {estimatedPercent, jobTiming, mergeTimingSamples, timeLabel, timingBucket} from './timing';
import {useTimingHistory} from './useTimingHistory';
import type {Folder, Job} from './vault';
import {canCancelBulk} from './bulk-cancel';

const PAGE_SIZE = 24;
const scrollPositions = new Map<string, {top: number; limit: number}>();
const ACTIVE = new Set(['staging', 'submitting', 'submission_unknown', 'queued', 'running', 'unknown']);
const FAILED = new Set(['cancelled', 'error']);
function jobKey(job: Job) {
  return job.batchId ? job.batchId + ':' + job.batchIndex : job.id;
}

function Progress({job, average, now}: {job: Job; average?: number; now: number}) {
  const timing = jobTiming(job, now);
  const running = job.state === 'running';
  const ready = job.state === 'complete' && Boolean(job.files?.length);
  const percent = ready ? 100 : running && average && timing.generation !== null
    ? estimatedPercent(timing.generation, average)
    : undefined;
  let status = ({
    staging: 'Waiting to submit',
    submitting: isLocal?'Sending to PC':'Sending to RunPod',
    submission_unknown: 'Submission needs recovery',
    queued: job.queuePosition ? 'Queued #' + job.queuePosition : 'Queued',
    running: 'Rendering · ' + timeLabel(timing.generation ?? timing.total),
    unknown: isLocal?'Checking PC status':'Checking RunPod status',
    complete: ready ? 'Ready' : 'Output unavailable',
    error: 'Failed',
    cancelled: 'Stopped',
  } as Record<string, string>)[job.state] || job.state;
  if (job.cancelRequested) status = isLocal?'Cancel pending · waiting for PC':'Cancel pending · waiting for RunPod';
  else if (running && percent !== undefined) status += ' · estimated';
  return <div className="shot-progress">
    <span>{status}</span>
    {(running || ready || job.state === 'queued') &&
      <progress max={100} value={percent ?? (job.state === 'queued' ? 0 : undefined)} aria-label={status}/>}
    {job.error && !job.cancelRequested && <small>{job.error}</small>}
  </div>;
}

type Props = {
  jobs: Job[];
  folders: Folder[];
  folder: string;
  bulk: boolean;
  busy: boolean;
  composer: ReactNode;
  onFolder: (id: string) => void;
  onMode: (bulk: boolean) => void;
  onProjects: () => void;
  onManage: () => void;
  onReuse: (job: Job) => void;
  onCancel: (job: Job) => Promise<void>;
  cancelling: string[];
  onCancelBulk: () => Promise<void>;
  bulkCancelBusy: boolean;
  bulkCancelMessage: string;
  onReference: (job: Job) => void;
  onRecover: () => void;
  recovering: boolean;
  connectionNote?: string;
  focusJobKey?: string;
  onFocusConsumed?: () => void;
};

function LocalProjectWorkspace(p: Props) {
  const [sceneColumns,setSceneColumns]=useState(()=>{try{const saved=localStorage.getItem('pocket-scene-columns');return ['1','2','3'].includes(saved||'')?saved!:'auto';}catch{return 'auto';}});
  const [sort,setSort]=useState<GallerySort>(()=>{try{const saved=localStorage.getItem('pocket-workspace-sort');return saved==='oldest'||saved==='newest'?saved:'scene';}catch{return 'scene';}});
  const [pendingFocus,setPendingFocus]=useState('');
  const [filter, setFilter] = useState<'scenes' | 'queue' | 'failed'>('scenes');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [mobileComposer, setMobileComposer] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [showComposer, setShowComposer] = useState(true);
  const [now, setNow] = useState(Date.now);
  const feed = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLElement>(null);
  const closePreviewRef=useRef<()=>void>(()=>{});
  const items = useMemo(() => galleryItems(p.jobs, p.folder || 'unfiled','all','',sort), [p.jobs, p.folder, sort]);
  const queue = useMemo(() => items.filter(job => ACTIVE.has(job.state)), [items]);
  const cancelCount = items.filter(canCancelBulk).length;
  const failed = items.filter(job => FAILED.has(job.state));
  const visible = filter === 'queue' ? queue : filter === 'failed' ? failed : items.filter(job => !FAILED.has(job.state));
  const query = search.trim().toLowerCase();
  const showing = query ? visible.filter(job => (creationLabel(job)+' '+creationTitle(job)).toLowerCase().includes(query)) : visible;
  const selectedJob = items.find(job => jobKey(job) === selected && job.files?.length);
  const running = queue.filter(job => job.state === 'running');
  const needsRecovery = queue.some(job => ['submitting', 'submission_unknown'].includes(job.state));
  const samples = useTimingHistory(p.jobs);
  const averages = useMemo(() => {
    const buckets = new Map<string, number[]>();
    for (const sample of mergeTimingSamples(samples, p.jobs)) {
      const values = buckets.get(sample.bucket) ?? [];
      values.push(sample.seconds);
      buckets.set(sample.bucket, values);
    }
    return new Map(Array.from(buckets, ([key, values]) => [key, values.reduce((a, b) => a + b, 0) / values.length]));
  }, [samples, p.jobs]);

  useEffect(() => {
    if (!running.length) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running.length]);
  useEffect(() => {
    const position = scrollPositions.get(p.folder);
    setLimit(position?.limit ?? PAGE_SIZE);
    setSelected('');
    setFilter('scenes');
    setSearch('');
    const frame = requestAnimationFrame(() => {
      if (feed.current) feed.current.scrollTop = position?.top ?? 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [p.folder]);


  useEffect(()=>{
    if(!p.focusJobKey)return;
    const index=items.filter(job=>!FAILED.has(job.state)).findIndex(job=>jobKey(job)===p.focusJobKey);
    if(index<0)return;
    setMobileComposer(false);
    setSelected('');
    setFilter('scenes');
    setSearch('');
    setLimit(current=>Math.max(current,index+1));
    setPendingFocus(p.focusJobKey);
  },[p.focusJobKey,items]);
  useEffect(()=>{
    if(!pendingFocus)return;
    const target=document.getElementById('shot-'+pendingFocus);
    if(!target)return;
    const frame=requestAnimationFrame(()=>{
      target.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      setPendingFocus('');
      p.onFocusConsumed?.();
    });
    return()=>cancelAnimationFrame(frame);
  },[pendingFocus,showing,limit]);

  useEffect(()=>{if(!selectedJob)return;const previous=document.body.style.overflow;const previousFocus=document.activeElement as HTMLElement|null;document.body.style.overflow='hidden';const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('.download-backdrop'))closePreviewRef.current();if(event.key==='Tab'&&!document.querySelector('.download-backdrop')){const elements=Array.from(preview.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,video[controls]')||[]);const first=elements[0],last=elements[elements.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};window.addEventListener('keydown',close);return()=>{document.body.style.overflow=previous;window.removeEventListener('keydown',close);previousFocus?.focus({preventScroll:true});};},[!!selectedJob]);
  const playable=showing.filter(job=>job.state==='complete'&&job.files?.length);
  const playingIndex=playable.findIndex(job=>jobKey(job)===selected);
  function nextClip(offset:number){const next=playable[playingIndex+offset];if(next)setSelected(jobKey(next));}
  function closePreview(){
    const target=selectedJob;
    setSelected('');
    if(target){const index=showing.findIndex(job=>jobKey(job)===jobKey(target));setLimit(current=>Math.max(current,index+1));setPendingFocus(jobKey(target));}
  }
  closePreviewRef.current=closePreview;
  const clipPreview=selectedJob&&<section ref={preview} className="workspace-preview panel local-preview-dialog" role="dialog" aria-modal="true" aria-label="Media preview">
    <header className="workspace-player-toolbar"><div className="workspace-player-title"><strong>{creationLabel(selectedJob)}</strong><small>{playingIndex>=0?`${playingIndex+1} / ${playable.length}`:''}</small></div><div className="workspace-player-controls">
      <button className="icon-button" aria-label="Previous scene" disabled={playingIndex<=0} onClick={()=>nextClip(-1)}><ChevronLeft size={22}/></button>
      <button className="icon-button" aria-label="Next scene" disabled={playingIndex<0||playingIndex>=playable.length-1} onClick={()=>nextClip(1)}><ChevronRight size={22}/></button>
      <DownloadButton key={selectedJob.id} job={selectedJob} className="button primary player-save" label="Save"/>
      <button autoFocus className="icon-button" aria-label="Close preview" onClick={closePreview}><X size={19}/></button>
    </div></header>
    <LocalMedia key={selectedJob.id} job={selectedJob} preview alt={creationTitle(selectedJob)}/>
    <div className="workspace-preview-actions"><DeviceBadge job={selectedJob}/><button className="button secondary" disabled={p.busy} onClick={()=>{p.onReuse(selectedJob);setSelected('');compose();}}>Reuse prompt</button>{selectedJob.mode==='image'&&<button className="button secondary" disabled={p.busy} onClick={()=>{p.onReference(selectedJob);setSelected('');compose();}}>Use as reference</button>}</div>
  </section>;
  function compose() {
    setShowComposer(true);
    setMobileComposer(true);
  }
  function jump(job: Job) {
    const index = items.filter(item => !FAILED.has(item.state)).indexOf(job);
    setFilter('scenes');
    setSearch('');
    setLimit(current => Math.max(current, index + 1));
    requestAnimationFrame(() => document.getElementById('shot-' + jobKey(job))?.scrollIntoView({block: 'nearest'}));
  }

  return <section className="project-workspace" aria-label="Project workspace">
    <header className="project-workspace-header">
      <button className="button secondary" onClick={p.onProjects} disabled={p.busy}><ArrowLeft size={16}/>Projects</button>
      <label className="workspace-project-select">
        <span>Project</span>
        <select aria-label="Current project" value={p.folder} disabled={p.busy} onChange={e => p.onFolder(e.target.value)}>
          <option value="">Unfiled</option>
          {p.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
      </label>
      <button className="button secondary workspace-queue-link" onClick={() => setFilter('queue')}>
        {running.length ? running.length + ' running' : 'Queue'} · {queue.length}
      </button>
      {<button className="button primary local-mobile-compose" onClick={compose}><Plus size={17}/>{p.bulk?'Bulk prompts':'Compose'}</button>}
      {cancelCount>0&&<button className="button danger" disabled={p.bulkCancelBusy} onClick={()=>void p.onCancelBulk()}><Square size={14}/>{p.bulkCancelBusy?'Cancelling…':'Cancel all bulk · '+cancelCount}</button>}
      <button className="button secondary workspace-manage" onClick={p.onManage} disabled={p.busy}>Manage media</button>
    </header>
    {p.bulkCancelMessage&&<p className="bulk-cancel-note" role="status">{p.bulkCancelMessage}</p>}
    <div className={'project-workspace-columns' + (sidebar ? '' : ' sidebar-folded') + (showComposer ? '' : ' composer-folded')}>
      <aside className="workspace-sidebar">
        <button className="text-button" onClick={() => setSidebar(value => !value)} aria-expanded={sidebar}>
          {sidebar ? 'Hide scenes' : 'Scenes'}
        </button>
        {sidebar && <div className="workspace-scene-index">
          {items.filter(job => !FAILED.has(job.state)).map(job => <button key={jobKey(job)} onClick={() => jump(job)}>
            <strong>{creationLabel(job)}</strong><span>{creationTitle(job)}</span>
          </button>)}
        </div>}
      </aside>
      <div className="workspace-feed" ref={feed} onScroll={e => {if (filter === 'scenes') scrollPositions.set(p.folder, {top: e.currentTarget.scrollTop, limit});}}>
        <div className="workspace-filters" aria-label="Project view">
          <button aria-pressed={filter === 'scenes'} onClick={() => {setFilter('scenes'); setLimit(PAGE_SIZE);}}>Scenes</button>
          <button aria-pressed={filter === 'queue'} onClick={() => {setFilter('queue'); setLimit(PAGE_SIZE);}}>Queue {queue.length || ''}</button>
          {failed.length > 0 && <button aria-pressed={filter === 'failed'} onClick={() => {setFilter('failed'); setLimit(PAGE_SIZE);}}>Failed / stopped {failed.length}</button>}
          <button className="workspace-mobile-manage" onClick={p.onManage} disabled={p.busy}>Manage</button>
          {<label className="local-scene-layout">Sort<select aria-label="Sort scenes" value={sort} onChange={e=>{const next=e.target.value as GallerySort;setSort(next);setLimit(PAGE_SIZE);try{localStorage.setItem('pocket-workspace-sort',next);}catch{}}}><option value="scene">Scene order</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label>}
          {<label className="local-scene-layout">Layout<select aria-label="Scene layout" value={sceneColumns} onChange={e=>{setSceneColumns(e.target.value);try{localStorage.setItem('pocket-scene-columns',e.target.value);}catch{}}}><option value="auto">Auto</option><option value="1">List</option><option value="2">2 columns</option><option value="3">3 columns</option></select></label>}
          <input type="search" aria-label="Find a scene" placeholder="Find a scene…" value={search} onChange={e => {setSearch(e.target.value);setLimit(PAGE_SIZE);}}/>
        </div>
        {p.connectionNote && queue.length > 0 && <p className="workspace-note" role="status">{p.connectionNote}</p>}
        {needsRecovery && <button className="button secondary" onClick={p.onRecover} disabled={p.recovering || p.busy}>
          <RotateCcw size={15}/>{p.recovering ? 'Checking queue…' : 'Recover queue status'}
        </button>}
        {!showing.length && <div className="workspace-empty">
          <Film size={30}/><h2>{query ? 'No matching scenes' : filter === 'queue' ? 'Queue is clear' : 'Your scenes appear here'}</h2>
          {!query && filter !== 'queue' && <button className="button primary" onClick={compose}><Plus size={16}/>Create a scene</button>}
        </div>}
        <div className="workspace-shots local-scene-grid" data-columns={sceneColumns}>
          {showing.slice(0, limit).map(job => {
            const ready = job.state === 'complete' && Boolean(job.files?.length);
            return <article className={"workspace-shot panel"+(selected===jobKey(job)?" is-playing":"")} aria-current={selected===jobKey(job)?true:undefined} id={'shot-' + jobKey(job)} key={jobKey(job)}>
              {ready && <button className="shot-preview-button" onClick={() => {setMobileComposer(false);setSelected(jobKey(job));}} aria-label={(isLocal?'Preview ':'Play ') + creationLabel(job)}>
                <MediaPoster job={job}/><span className="shot-preview-label"><Play size={16}/> Preview</span>
              </button>}
              <div className="workspace-shot-body">
                <strong>{creationLabel(job)}</strong>
                <p title={creationTitle(job)}>{creationTitle(job)}</p>
                {ready&&<DownloadButton job={job} className="text-button shot-save" label="Save"/>}
                <Progress job={job} average={averages.get(timingBucket(job))} now={now}/>
                {(job.state === 'running' || job.state === 'queued') && <button className="text-button" disabled={p.cancelling.includes(job.id)} onClick={() => void p.onCancel(job)}>
                  <Square size={12}/>Stop
                </button>}
                {FAILED.has(job.state) && <button className="text-button" disabled={p.busy} onClick={() => {p.onReuse(job); compose();}}>
                  <RotateCcw size={13}/>Reuse prompt
                </button>}
              </div>
            </article>;
          })}
        </div>
        {showing.length > limit && <button className="button secondary workspace-more" onClick={() => setLimit(n => n + PAGE_SIZE)}>Show more · {limit} / {showing.length}</button>}
      </div>
      <aside className={'workspace-composer' + (mobileComposer ? ' composer-mobile-open' : '')}>
        <div className="composer-controls">
          <button className="text-button workspace-desktop-fold" onClick={() => setShowComposer(value => !value)} aria-expanded={showComposer}>
            {showComposer ? 'Hide composer' : 'Compose'} <ChevronDown size={14}/>
          </button>
          <button className="text-button workspace-mobile-fold" onClick={() => setMobileComposer(false)}>Close <X size={16}/></button>
          <div className="composer-modes">
            <button aria-pressed={!p.bulk} disabled={p.busy} onClick={() => p.onMode(false)}>Single</button>
            <button aria-pressed={p.bulk} disabled={p.busy} onClick={() => p.onMode(true)}>Bulk</button>
          </div>
        </div>
        <div className="composer-body">
          {queue.length > 0 && <section className="composer-queue" aria-label="Active project queue">
            <strong>Queue · {queue.length}</strong>
            {[...running, ...queue.filter(job => job.state !== 'running')].slice(0, 4).map(job => <button
              key={jobKey(job)} className="text-button" onClick={() => jump(job)}
            >
              {creationLabel(job)} · {job.cancelRequested ? 'Cancel pending' : job.state === 'running' ? 'Rendering' : job.state === 'queued' ? 'Queued' : 'Submitting'}
            </button>)}
          </section>}
          {p.composer}
        </div>
      </aside>
    </div>
    {selectedJob&&createPortal(<div className="local-preview-backdrop" onClick={e=>{if(e.target===e.currentTarget)closePreview();}}>{clipPreview}</div>,document.body)}
  </section>;
}

function RunPodProjectWorkspace(p: Props) {
  const [sceneColumns,setSceneColumns]=useState(()=>{try{const saved=localStorage.getItem('pocket-scene-columns');return ['1','2','3'].includes(saved||'')?saved!:'auto';}catch{return 'auto';}});
  const [sort,setSort]=useState<GallerySort>(()=>{try{const saved=localStorage.getItem('pocket-workspace-sort');return saved==='oldest'||saved==='newest'?saved:'scene';}catch{return 'scene';}});
  const [pendingFocus,setPendingFocus]=useState('');
  const [filter, setFilter] = useState<'scenes' | 'queue' | 'failed'>('scenes');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [mobileComposer, setMobileComposer] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [showComposer, setShowComposer] = useState(true);
  const [now, setNow] = useState(Date.now);
  const feed = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLElement>(null);
  const previousCount = useRef(p.jobs.length);
  const items = useMemo(() => galleryItems(p.jobs, p.folder || 'unfiled','all','',isLocal?sort:'scene'), [p.jobs, p.folder, sort]);
  const queue = useMemo(() => items.filter(job => ACTIVE.has(job.state)), [items]);
  const cancelCount = items.filter(canCancelBulk).length;
  const failed = items.filter(job => FAILED.has(job.state));
  const visible = filter === 'queue' ? queue : filter === 'failed' ? failed : items.filter(job => !FAILED.has(job.state));
  const query = search.trim().toLowerCase();
  const showing = query ? visible.filter(job => (creationLabel(job)+' '+creationTitle(job)).toLowerCase().includes(query)) : visible;
  const selectedJob = items.find(job => jobKey(job) === selected && job.files?.length);
  const running = queue.filter(job => job.state === 'running');
  const needsRecovery = queue.some(job => ['submitting', 'submission_unknown'].includes(job.state));
  const samples = useTimingHistory(p.jobs);
  const averages = useMemo(() => {
    const buckets = new Map<string, number[]>();
    for (const sample of mergeTimingSamples(samples, p.jobs)) {
      const values = buckets.get(sample.bucket) ?? [];
      values.push(sample.seconds);
      buckets.set(sample.bucket, values);
    }
    return new Map(Array.from(buckets, ([key, values]) => [key, values.reduce((a, b) => a + b, 0) / values.length]));
  }, [samples, p.jobs]);

  useEffect(() => {
    if (!running.length) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running.length]);
  useEffect(() => {
    const position = scrollPositions.get(p.folder);
    setLimit(position?.limit ?? PAGE_SIZE);
    setSelected('');
    setFilter('scenes');
    setSearch('');
    const frame = requestAnimationFrame(() => {
      if (feed.current) feed.current.scrollTop = position?.top ?? 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [p.folder]);
  useEffect(() => {
    if (selected && !isLocal) preview.current?.scrollIntoView({block: 'nearest'});
  }, [selected]);
  useEffect(() => {
    if (!isLocal && p.jobs.length > previousCount.current && p.busy) setMobileComposer(false);
    previousCount.current = p.jobs.length;
  }, [p.jobs.length, p.busy]);

  useEffect(()=>{
    if(!isLocal||!p.focusJobKey)return;
    const index=items.filter(job=>!FAILED.has(job.state)).findIndex(job=>jobKey(job)===p.focusJobKey);
    if(index<0)return;
    setMobileComposer(false);
    setSelected('');
    setFilter('scenes');
    setSearch('');
    setLimit(current=>Math.max(current,index+1));
    setPendingFocus(p.focusJobKey);
  },[p.focusJobKey,items]);
  useEffect(()=>{
    if(!pendingFocus)return;
    const target=document.getElementById('shot-'+pendingFocus);
    if(!target)return;
    const frame=requestAnimationFrame(()=>{
      target.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      setPendingFocus('');
      p.onFocusConsumed?.();
    });
    return()=>cancelAnimationFrame(frame);
  },[pendingFocus,showing,limit]);

  useEffect(()=>{if(!isLocal||!selectedJob)return;const previous=document.body.style.overflow;const previousFocus=document.activeElement as HTMLElement|null;document.body.style.overflow='hidden';const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelected('');if(event.key==='Tab'){const elements=Array.from(preview.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,video[controls]')||[]);const first=elements[0],last=elements[elements.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};window.addEventListener('keydown',close);return()=>{document.body.style.overflow=previous;window.removeEventListener('keydown',close);previousFocus?.focus();};},[selectedJob?.id]);
  const clipPreview=selectedJob&&<section ref={preview} className={'workspace-preview panel'+(isLocal?' local-preview-dialog':'')} role={isLocal?'dialog':undefined} aria-modal={isLocal?true:undefined} aria-label="Media preview">
    <header><strong>{creationLabel(selectedJob)}</strong><button autoFocus={isLocal} className="icon-button" aria-label="Close preview" onClick={()=>setSelected('')}><X size={19}/></button></header>
    <LocalMedia key={selectedJob.id} job={selectedJob} preview alt={creationTitle(selectedJob)}/>
    <div className="workspace-preview-actions"><DeviceBadge job={selectedJob}/><DownloadButton job={selectedJob} label="Save file"/><button className="button secondary" disabled={p.busy} onClick={()=>{p.onReuse(selectedJob);setSelected('');compose();}}>Reuse prompt</button>{selectedJob.mode==='image'&&<button className="button secondary" disabled={p.busy} onClick={()=>{p.onReference(selectedJob);setSelected('');compose();}}>Use as reference</button>}</div>
  </section>;
  function compose() {
    setShowComposer(true);
    setMobileComposer(true);
  }
  function jump(job: Job) {
    const index = items.filter(item => !FAILED.has(item.state)).indexOf(job);
    setFilter('scenes');
    setSearch('');
    setLimit(current => Math.max(current, index + 1));
    requestAnimationFrame(() => document.getElementById('shot-' + jobKey(job))?.scrollIntoView({block: 'nearest'}));
  }

  return <section className="project-workspace" aria-label="Project workspace">
    <header className="project-workspace-header">
      <button className="button secondary" onClick={p.onProjects} disabled={p.busy}><ArrowLeft size={16}/>Projects</button>
      <label className="workspace-project-select">
        <span>Project</span>
        <select aria-label="Current project" value={p.folder} disabled={p.busy} onChange={e => p.onFolder(e.target.value)}>
          <option value="">Unfiled</option>
          {p.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
      </label>
      <button className="button secondary workspace-queue-link" onClick={() => setFilter('queue')}>
        {running.length ? running.length + ' running' : 'Queue'} · {queue.length}
      </button>
      {isLocal&&<button className="button primary local-mobile-compose" onClick={compose}><Plus size={17}/>{p.bulk?'Bulk prompts':'Compose'}</button>}
      {cancelCount>0&&<button className="button danger" disabled={p.bulkCancelBusy} onClick={()=>void p.onCancelBulk()}><Square size={14}/>{p.bulkCancelBusy?'Cancelling…':'Cancel all bulk · '+cancelCount}</button>}
      <button className="button secondary workspace-manage" onClick={p.onManage} disabled={p.busy}>Manage media</button>
    </header>
    {p.bulkCancelMessage&&<p className="bulk-cancel-note" role="status">{p.bulkCancelMessage}</p>}
    <div className={'project-workspace-columns' + (sidebar ? '' : ' sidebar-folded') + (showComposer ? '' : ' composer-folded')}>
      <aside className="workspace-sidebar">
        <button className="text-button" onClick={() => setSidebar(value => !value)} aria-expanded={sidebar}>
          {sidebar ? 'Hide scenes' : 'Scenes'}
        </button>
        {sidebar && <div className="workspace-scene-index">
          {items.filter(job => !FAILED.has(job.state)).map(job => <button key={jobKey(job)} onClick={() => jump(job)}>
            <strong>{creationLabel(job)}</strong><span>{creationTitle(job)}</span>
          </button>)}
        </div>}
      </aside>
      <div className="workspace-feed" ref={feed} onScroll={e => {if (filter === 'scenes') scrollPositions.set(p.folder, {top: e.currentTarget.scrollTop, limit});}}>
        <div className="workspace-filters" aria-label="Project view">
          <button aria-pressed={filter === 'scenes'} onClick={() => {setFilter('scenes'); setLimit(PAGE_SIZE);}}>Scenes</button>
          <button aria-pressed={filter === 'queue'} onClick={() => {setFilter('queue'); setLimit(PAGE_SIZE);}}>Queue {queue.length || ''}</button>
          {failed.length > 0 && <button aria-pressed={filter === 'failed'} onClick={() => {setFilter('failed'); setLimit(PAGE_SIZE);}}>Failed / stopped {failed.length}</button>}
          <button className="workspace-mobile-manage" onClick={p.onManage} disabled={p.busy}>Manage</button>
          {isLocal&&<label className="local-scene-layout">Sort<select aria-label="Sort scenes" value={sort} onChange={e=>{const next=e.target.value as GallerySort;setSort(next);setLimit(PAGE_SIZE);try{localStorage.setItem('pocket-workspace-sort',next);}catch{}}}><option value="scene">Scene order</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label>}
          {isLocal&&<label className="local-scene-layout">Layout<select aria-label="Scene layout" value={sceneColumns} onChange={e=>{setSceneColumns(e.target.value);try{localStorage.setItem('pocket-scene-columns',e.target.value);}catch{}}}><option value="auto">Auto</option><option value="1">List</option><option value="2">2 columns</option><option value="3">3 columns</option></select></label>}
          <input type="search" aria-label="Find a scene" placeholder="Find a scene…" value={search} onChange={e => {setSearch(e.target.value);setLimit(PAGE_SIZE);}}/>
        </div>
        {p.connectionNote && queue.length > 0 && <p className="workspace-note" role="status">{p.connectionNote}</p>}
        {needsRecovery && <button className="button secondary" onClick={p.onRecover} disabled={p.recovering || p.busy}>
          <RotateCcw size={15}/>{p.recovering ? 'Checking queue…' : 'Recover queue status'}
        </button>}
        {!isLocal&&clipPreview}
        {!showing.length && <div className="workspace-empty">
          <Film size={30}/><h2>{query ? 'No matching scenes' : filter === 'queue' ? 'Queue is clear' : 'Your scenes appear here'}</h2>
          {!query && filter !== 'queue' && <button className="button primary" onClick={compose}><Plus size={16}/>Create a scene</button>}
        </div>}
        <div className={"workspace-shots"+(isLocal?" local-scene-grid":"")} data-columns={isLocal?sceneColumns:undefined}>
          {showing.slice(0, limit).map(job => {
            const ready = job.state === 'complete' && Boolean(job.files?.length);
            return <article className="workspace-shot panel" id={'shot-' + jobKey(job)} key={jobKey(job)}>
              {ready && <button className="shot-preview-button" onClick={() => {setMobileComposer(false);setSelected(jobKey(job));}} aria-label={(isLocal?'Preview ':'Play ') + creationLabel(job)}>
                <MediaPoster job={job}/><span className="shot-preview-label"><Play size={16}/> Preview</span>
              </button>}
              <div className="workspace-shot-body">
                <strong>{creationLabel(job)}</strong>
                <p title={creationTitle(job)}>{creationTitle(job)}</p>
                <Progress job={job} average={averages.get(timingBucket(job))} now={now}/>
                {(job.state === 'running' || job.state === 'queued') && <button className="text-button" disabled={p.cancelling.includes(job.id)} onClick={() => void p.onCancel(job)}>
                  <Square size={12}/>Stop
                </button>}
                {FAILED.has(job.state) && <button className="text-button" disabled={p.busy} onClick={() => {p.onReuse(job); compose();}}>
                  <RotateCcw size={13}/>Reuse prompt
                </button>}
              </div>
            </article>;
          })}
        </div>
        {showing.length > limit && <button className="button secondary workspace-more" onClick={() => setLimit(n => n + PAGE_SIZE)}>Show more · {limit} / {showing.length}</button>}
      </div>
      <aside className={'workspace-composer' + (mobileComposer ? ' composer-mobile-open' : '')}>
        <div className="composer-controls">
          <button className="text-button workspace-desktop-fold" onClick={() => setShowComposer(value => !value)} aria-expanded={showComposer}>
            {showComposer ? 'Hide composer' : 'Compose'} <ChevronDown size={14}/>
          </button>
          <button className="text-button workspace-mobile-fold" onClick={() => setMobileComposer(false)}>Close <X size={16}/></button>
          <div className="composer-modes">
            <button aria-pressed={!p.bulk} disabled={p.busy} onClick={() => p.onMode(false)}>Single</button>
            <button aria-pressed={p.bulk} disabled={p.busy} onClick={() => p.onMode(true)}>Bulk</button>
          </div>
        </div>
        <div className="composer-body">
          {queue.length > 0 && <section className="composer-queue" aria-label="Active project queue">
            <strong>Queue · {queue.length}</strong>
            {[...running, ...queue.filter(job => job.state !== 'running')].slice(0, 4).map(job => <button
              key={jobKey(job)} className="text-button" onClick={() => jump(job)}
            >
              {creationLabel(job)} · {job.cancelRequested ? 'Cancel pending' : job.state === 'running' ? 'Rendering' : job.state === 'queued' ? 'Queued' : 'Submitting'}
            </button>)}
          </section>}
          {p.composer}
        </div>
      </aside>
    </div>
    {isLocal&&selectedJob&&createPortal(<div className="local-preview-backdrop" onClick={e=>{if(e.target===e.currentTarget)setSelected('');}}>{clipPreview}</div>,document.body)}
    <button hidden={isLocal} className="button primary workspace-mobile-compose" onClick={compose}><Plus size={17}/>{p.bulk ? 'Bulk prompts' : 'Compose'}</button>
  </section>;
}

export default isLocal?LocalProjectWorkspace:RunPodProjectWorkspace;
