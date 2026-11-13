import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {ArrowLeft, ChevronDown, Film, Play, Plus, RotateCcw, Square, X} from 'lucide-react';
import LocalMedia, {DeviceBadge} from './LocalMedia';
import DownloadButton from './DownloadButton';
import MediaPoster from './MediaPoster';
import {creationLabel, creationTitle, galleryItems} from './gallery-model';
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
    submitting: 'Sending to RunPod',
    submission_unknown: 'Submission needs recovery',
    queued: job.queuePosition ? 'Queued #' + job.queuePosition : 'Queued',
    running: 'Rendering · ' + timeLabel(timing.generation ?? timing.total),
    unknown: 'Checking RunPod status',
    complete: ready ? 'Ready' : 'Output unavailable',
    error: 'Failed',
    cancelled: 'Stopped',
  } as Record<string, string>)[job.state] || job.state;
  if (job.cancelRequested) status = 'Cancel pending · waiting for RunPod';
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
};

export default function ProjectWorkspace(p: Props) {
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
  const items = useMemo(() => galleryItems(p.jobs, p.folder || 'unfiled'), [p.jobs, p.folder]);
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
    if (selected) preview.current?.scrollIntoView({block: 'nearest'});
  }, [selected]);
  useEffect(() => {
    if (p.jobs.length > previousCount.current && p.busy) setMobileComposer(false);
    previousCount.current = p.jobs.length;
  }, [p.jobs.length, p.busy]);

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
          <input type="search" aria-label="Find a scene" placeholder="Find a scene…" value={search} onChange={e => {setSearch(e.target.value);setLimit(PAGE_SIZE);}}/>
        </div>
        {p.connectionNote && queue.length > 0 && <p className="workspace-note" role="status">{p.connectionNote}</p>}
        {needsRecovery && <button className="button secondary" onClick={p.onRecover} disabled={p.recovering || p.busy}>
          <RotateCcw size={15}/>{p.recovering ? 'Checking queue…' : 'Recover queue status'}
        </button>}
        {selectedJob && <section ref={preview} className="workspace-preview panel" aria-label="Clip preview">
          <header><strong>{creationLabel(selectedJob)}</strong><button className="icon-button" aria-label="Close preview" onClick={() => setSelected('')}><X size={19}/></button></header>
          <LocalMedia key={selectedJob.id} job={selectedJob} preview alt={creationTitle(selectedJob)}/>
          <div className="workspace-preview-actions">
            <DeviceBadge job={selectedJob}/>
            <DownloadButton job={selectedJob} label="Save file"/>
            <button className="button secondary" disabled={p.busy} onClick={() => {p.onReuse(selectedJob); compose();}}>Reuse prompt</button>
            {selectedJob.mode === 'image' && <button className="button secondary" disabled={p.busy} onClick={() => {p.onReference(selectedJob); compose();}}>Use as reference</button>}
          </div>
        </section>}
        {!showing.length && <div className="workspace-empty">
          <Film size={30}/><h2>{query ? 'No matching scenes' : filter === 'queue' ? 'Queue is clear' : 'Your scenes appear here'}</h2>
          {!query && filter !== 'queue' && <button className="button primary" onClick={compose}><Plus size={16}/>Create a scene</button>}
        </div>}
        <div className="workspace-shots">
          {showing.slice(0, limit).map(job => {
            const ready = job.state === 'complete' && Boolean(job.files?.length);
            return <article className="workspace-shot panel" id={'shot-' + jobKey(job)} key={jobKey(job)}>
              {ready && <button className="shot-preview-button" onClick={() => setSelected(jobKey(job))} aria-label={'Play ' + creationLabel(job)}>
                <MediaPoster job={job}/><span><Play size={16}/> Preview</span>
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
    <button className="button primary workspace-mobile-compose" onClick={compose}><Plus size={17}/>{p.bulk ? 'Bulk prompts' : 'Compose'}</button>
  </section>;
}
