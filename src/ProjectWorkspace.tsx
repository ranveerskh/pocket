import Timing from './Timing';
import {createPortal} from 'react-dom';
import {isLocal,localStorage} from './local-mode';
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, Film, Clock3, Pause, Play, Plus, RotateCcw, Square, X} from 'lucide-react';
import LocalMedia, {DeviceBadge} from './LocalMedia';
import DownloadButton from './DownloadButton';
import WatchedPreview from './WatchedPreview';
import {creationLabel, creationTitle, galleryItems, type GallerySort} from './gallery-model';
import {queueRemaining, queueClock, estimatedPercent, jobTiming, mergeTimingSamples, timeLabel, timingBucket, timingStats} from './timing';
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

function Progress({job, average, similar, now}: {job: Job; average?: number; similar?:boolean; now: number}) {
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
    running: timing.generation===null&&average?'≈ '+timeLabel(average)+' estimated total':(timing.generation === null ? '—' : (job.timingSource==='inferred'?'≈ ':'')+timeLabel(timing.generation)) + ' / ' + (average ? (similar?'≈ ':'')+timeLabel(average) : '—'),
    unknown: isLocal?'Checking PC status':'Checking RunPod status',
    complete: ready ? 'Ready' : 'Output unavailable',
    error: 'Failed',
    cancelled: 'Stopped',paused:'Paused',pausing:'Confirming pause',resuming:'Recovering resume',
  } as Record<string, string>)[job.state] || job.state;
  if (job.cancelRequested) status = isLocal?'Cancel pending · waiting for PC':'Cancel pending · waiting for RunPod';

  return <div className="shot-progress">
    <span title={running?(timing.generation===null?'Elapsed time unavailable; showing estimated total from previous completed runs':similar?'Generation elapsed / approximate total from similar reference counts':'Generation elapsed / estimated total from latest matching runs'):undefined}>{status}</span>
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
  onPause?:(jobs:Job[],mode:'now'|'after')=>Promise<void>;
  onResume?:(jobs:Job[])=>Promise<void>;
  pauseBusy?:boolean;pauseMessage?:string;
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

export default function ProjectWorkspace(p: Props) {
  const [sceneColumns,setSceneColumns]=useState(()=>{try{const saved=localStorage.getItem('pocket-scene-columns');return ['1','2','3','4'].includes(saved||'')?saved!:'auto';}catch{return 'auto';}});
  const [sort,setSort]=useState<GallerySort>(()=>{try{const saved=localStorage.getItem('pocket-workspace-sort');return saved==='oldest'||saved==='newest'?saved:'scene';}catch{return 'scene';}});
  const [pendingFocus,setPendingFocus]=useState('');
  const [filter, setFilter] = useState<'scenes' | 'queue' | 'failed'>('scenes');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [timingSelection,setTimingSelection]=useState('');
  const timingDialog=useRef<HTMLElement>(null);
  const [mobileComposer, setMobileComposer] = useState(false);
  const [pauseBatch,setPauseBatch]=useState('');
  const [sidebar, setSidebar] = useState(false);
  const [showComposer, setShowComposer] = useState(true);
  const [now, setNow] = useState(Date.now);
  const feed = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLElement>(null);
  const closePreviewRef=useRef<()=>void>(()=>{});
  const items = useMemo(() => galleryItems(p.jobs, p.folder || 'unfiled','all','',sort), [p.jobs, p.folder, sort]);
  const pauseItems=items.filter(j=>!pauseBatch||j.batchId===pauseBatch);
  const pauseBatches=[...new Set(items.filter(j=>j.batchId).map(j=>j.batchId!))];
  const queue = useMemo(() => items.filter(job => ACTIVE.has(job.state)), [items]);
  const cancelCount = items.filter(canCancelBulk).length;
  const failed = items.filter(job => FAILED.has(job.state));
  const visible = filter === 'queue' ? queue : filter === 'failed' ? failed : items.filter(job => !FAILED.has(job.state));
  const query = search.trim().toLowerCase();
  const showing = query ? visible.filter(job => (creationLabel(job)+' '+creationTitle(job)).toLowerCase().includes(query)) : visible;
  const selectedJob = items.find(job => jobKey(job) === selected && job.files?.length);
  const timingJob=items.find(job=>jobKey(job)===timingSelection);
  const running = queue.filter(job => job.state === 'running');
  const needsRecovery = queue.some(job => ['submitting', 'submission_unknown'].includes(job.state));
  const samples = useTimingHistory(p.jobs);
  const averages = useMemo(() => {
    const history=mergeTimingSamples(samples,p.jobs),result=new Map<string,ReturnType<typeof timingStats>>();
    for(const job of p.jobs){const bucket=timingBucket(job);if(!result.has(bucket))result.set(bucket,timingStats([],job,history));}
    return result;
  }, [samples, p.jobs]);

  const remaining=queueRemaining(p.jobs,samples,now);
  const activeRunning=p.jobs.filter(j=>!j.hidden&&j.state==='running').length;
  useEffect(() => {
    if (!activeRunning) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeRunning]);
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
  useEffect(()=>{
    if(!timingJob)return;
    const previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setTimingSelection('');if(e.key==='Tab'){const buttons=Array.from(timingDialog.current?.querySelectorAll<HTMLElement>('button,summary,a[href]')||[]);const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
    window.addEventListener('keydown',onKey);return()=>{document.body.style.overflow=overflow;window.removeEventListener('keydown',onKey);previous?.focus({preventScroll:true});};
  },[!!timingJob]);
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
      <div className="workspace-project-row">
       <div className="workspace-project-group">
        <button className="button secondary workspace-back" aria-label="Back to projects" onClick={p.onProjects} disabled={p.busy}><ArrowLeft size={16}/></button>
        <label className="workspace-project-select">
         <select aria-label="Current project" value={p.folder} disabled={p.busy} onChange={e=>p.onFolder(e.target.value)}>
          <option value="">Unfiled</option>{p.folders.map(folder=><option key={folder.id} value={folder.id}>{folder.name}</option>)}
         </select>
        </label>
       </div>
       <input type="search" aria-label="Find a scene" placeholder="Find a scene…" value={search} onChange={e=>{setSearch(e.target.value);setLimit(PAGE_SIZE);}}/>
      </div>
      <div className="workspace-action-row">
       <time className="workspace-remaining" aria-label="Estimated time remaining for all running and queued generations" title={remaining.seconds===null?'Waiting for matching timing history or queue status':"Estimated remaining across all projects. Parallel pods overlap; paused shots excluded. Unknown start times use the full average. A plus means a running shot exceeded its estimate."}><Clock3 size={15}/>{remaining.seconds===null?'—:—':'≈ '+queueClock(remaining.seconds)+(remaining.overdue?'+':'')}</time>
       <button className="button primary local-mobile-compose" onClick={compose}><Plus size={17}/>Compose</button>
       {p.onPause&&<div className="workspace-pause-controls"><details><summary title="Pause or resume shots"><Pause size={14}/>Pause</summary><div className="workspace-pause-menu"><label className="field-label">Shots to control<select value={pauseBatch} onChange={e=>setPauseBatch(e.target.value)}><option value="">All shots in this project</option>{pauseBatches.map((id,i)=><option key={id} value={id}>Batch {i+1} · {new Date(items.find(j=>j.batchId===id)!.created).toLocaleString()}</option>)}</select></label><div className="workspace-pause-actions"><button className="button secondary" disabled={p.busy||p.pauseBusy||p.cancelling.length>0||!pauseItems.some(j=>['queued','running','unknown','pausing'].includes(j.state))} onClick={()=>void p.onPause?.(pauseItems,'after')}>Pause after current</button><button className="button secondary" disabled={p.busy||p.pauseBusy||p.cancelling.length>0||!pauseItems.some(j=>['queued','running','unknown','pausing'].includes(j.state))} onClick={()=>void p.onPause?.(pauseItems,'now')}>Pause all now</button><button className="button primary" disabled={p.busy||p.pauseBusy||p.cancelling.length>0||!pauseItems.some(j=>['paused','resuming'].includes(j.state))} onClick={()=>void p.onResume?.(pauseItems)}>Resume paused shots</button></div><p>Pause after current lets the running shot finish. Pause now restarts interrupted shots from the beginning when resumed. Wait for pause confirmation before stopping RunPod. Pod start never resumes shots automatically.</p></div></details></div>}
       {cancelCount>0&&<button className="button danger workspace-cancel-all" disabled={p.bulkCancelBusy||p.pauseBusy} onClick={()=>void p.onCancelBulk()}><Square size={14}/>{p.bulkCancelBusy?'Cancelling…':'Cancel · '+cancelCount}</button>}
      </div>
    </header>
    {p.pauseMessage&&<p className="bulk-cancel-note" role="status">{p.pauseMessage}</p>}
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
         <div className="workspace-view-tabs" role="group" aria-label="Scene views">
          <button aria-pressed={filter === 'scenes'} onClick={() => {setFilter('scenes'); setLimit(PAGE_SIZE);}}>Scenes</button>
          <button aria-pressed={filter === 'queue'} onClick={() => {setFilter('queue'); setLimit(PAGE_SIZE);}}>Queue {queue.length>0&&<span className="workspace-tab-count">{queue.length}</span>}</button>
          {failed.length > 0 && <button aria-pressed={filter === 'failed'} onClick={() => {setFilter('failed'); setLimit(PAGE_SIZE);}} title="Failed and stopped scenes">Failed <span className="workspace-tab-count">{failed.length}</span></button>}
          <button className="workspace-mobile-manage" onClick={p.onManage} disabled={p.busy}>Manage</button>
         </div>
         <div className="workspace-view-tools">
          {<label className="local-scene-layout">Sort<select aria-label="Sort scenes" value={sort} onChange={e=>{const next=e.target.value as GallerySort;setSort(next);setLimit(PAGE_SIZE);try{localStorage.setItem('pocket-workspace-sort',next);}catch{}}}><option value="scene">Scene order</option><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label>}
          {<label className="local-scene-layout">Layout<select aria-label="Scene layout" value={sceneColumns} onChange={e=>{setSceneColumns(e.target.value);try{localStorage.setItem('pocket-scene-columns',e.target.value);}catch{}}}><option value="auto">Auto</option><option value="1">List</option><option value="2">2 columns</option><option value="3">3 columns</option><option value="4">4 columns</option></select></label>}
         </div>
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
                <WatchedPreview job={job}/>
              </button>}
              <div className="workspace-shot-body">
                {job.state==='running'?<button className="shot-timing-trigger" aria-label={'Generation timing for '+creationLabel(job)} onClick={()=>{setMobileComposer(false);setTimingSelection(jobKey(job));}}>
                  <strong>{creationLabel(job)}</strong><span className="shot-timing-title" title={creationTitle(job)}>{creationTitle(job)}</span>
                  <Progress job={job} average={averages.get(timingBucket(job))?.average} similar={averages.get(timingBucket(job))?.similar} now={now}/>
                </button>:<><strong>{creationLabel(job)}</strong>
                <p title={creationTitle(job)}>{creationTitle(job)}</p>
                {ready&&<DownloadButton job={job} className="text-button shot-save" label="Save"/>}
                <Progress job={job} average={averages.get(timingBucket(job))?.average} similar={averages.get(timingBucket(job))?.similar} now={now}/></>}
                <div className="shot-actions">
                {p.onPause&&['running','queued','unknown','pausing'].includes(job.state)&&<button className="text-button" disabled={p.pauseBusy||p.busy||p.cancelling.length>0} onClick={()=>void p.onPause?.([job],'now')}><Pause size={12}/>{job.state==='pausing'?'Retry Pause':'Pause'}</button>}
                {p.onResume&&['paused','resuming'].includes(job.state)&&<button className="text-button" disabled={p.pauseBusy||p.busy||p.cancelling.length>0} onClick={()=>void p.onResume?.([job])}><Play size={12}/>{job.state==='resuming'?'Recover Resume':'Resume'}</button>}
                {(job.state === 'running' || job.state === 'queued') && <button className="text-button" disabled={p.pauseBusy||p.cancelling.includes(job.id)} onClick={() => void p.onCancel(job)}>
                  <Square size={12}/>Stop
                </button>}
                </div>
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
    {timingJob&&createPortal(<div className="local-preview-backdrop timing-dialog-backdrop" onClick={e=>{if(e.target===e.currentTarget)setTimingSelection('');}}><section ref={timingDialog} className="panel workspace-timing-dialog" role="dialog" aria-modal="true" aria-label={'Generation timing for '+creationLabel(timingJob)}><header><strong>{creationLabel(timingJob)}</strong><button autoFocus className="icon-button" aria-label="Close generation timing" onClick={()=>setTimingSelection('')}><X size={20}/></button></header><Timing jobs={p.jobs} candidate={timingJob} current={timingJob} elapsed={now}/></section></div>,document.body)}
    {selectedJob&&createPortal(<div className="local-preview-backdrop" onClick={e=>{if(e.target===e.currentTarget)closePreview();}}>{clipPreview}</div>,document.body)}
  </section>;
}
