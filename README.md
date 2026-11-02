# Pocket Studio — GitHub + Netlify

Phone-friendly ComfyUI interface with **MiniMax H3 video** and **Z-Image Turbo images**. Your laptop can stay off after deploying. RunPod/ComfyUI is needed for generation and the first device copy; saved device media plays without the pod.

**Current release: V7.** The device-storage and hidden-only PIN behavior below supersedes historical release notes.

## Deploy

1. Extract the ZIP. Create a GitHub repository and upload **all the files inside the extracted folder**. `package.json`, `netlify.toml`, `index.html`, `src/`, `server/`, `netlify/` and `scripts/` must sit at the repository root, not inside another nested folder.
2. In Netlify, import the GitHub repository as a new project.
3. Leave **Base directory** empty. **Build command:** `npm run build`. **Publish directory:** `dist`. The included `netlify.toml` already sets these values and Node.js 24.
4. Deploy. Netlify builds the interface and deploys `/api/comfy` and `/api/media` as Edge Functions automatically. Uploading only `dist` with drag-and-drop does NOT deploy these API routes. Use GitHub import.
5. Open the resulting Netlify URL in Safari. Choose Image or Video → Connection → paste your **RunPod → Connect → ComfyUI HTTP service** URL → Save & test connection.
6. Return to Create, write a prompt and Generate. Safari → Share → Add to Home Screen is optional.

Use the ComfyUI proxy URL, such as `https://YOUR-POD-8188.proxy.runpod.net`. Do not paste the RunPod dashboard or JupyterLab URL. The app supports HTTPS `*.proxy.runpod.net` links. The Netlify backend forwards requests, so wildcard CORS does not need to be enabled on ComfyUI.

## Features

- Video/image model switch.
- Prompt, frame, size, seed and optional video reference image.
- Video: 4, 5, 6, 8 or 10 seconds requested, native audio from the workflow, 24 fps.
- Video Turbo LoRA option if installed. Normal mode uses 20 steps; Turbo uses 8.
- Image: the uploaded text-to-image workflow, 8 steps, one image per job.
- Queue/running status, elapsed time, stop, preview, download and browser-local history.
- Use a generated image as a first-frame reference for video.

Actual video duration can be slightly longer than requested because the uploaded workflow rounds to the model's frame blocks. Progress shows queue/running status, not a guessed percentage.

## Required model files

Install the nodes from your uploaded workflows. The app does not download models. Paths below are relative to `ComfyUI/models/`; filenames must match.

### MiniMax H3 video

- `diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors`
- `text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`
- `vae/minimax_h3_video_vae_int8_convrot.safetensors`
- `vae/minimax_h3_audio_vae_fp32.safetensors`
- Optional: `loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors`

### Z-Image Turbo

- `diffusion_models/z_image_turbo_bf16.safetensors`
- `text_encoders/qwen_3_4b.safetensors`
- `vae/ae.safetensors`

Connection testing checks the selected model's required nodes and filenames. Both models can use the same pod if their required files are installed.

## Local use (optional)

Requires Node.js 24 (or compatible >=22.13).

```sh
npm install
npm test
npm run build
npx netlify-cli dev
```

Open `http://localhost:8888` for the full app including API routes. `npm run dev` alone runs the frontend without Netlify's backend. The deployed Netlify URL works independently of your laptop.

## Files and access

- This package contains no personal RunPod endpoint, token or API key. Each browser supplies its own RunPod URL. No endpoint is saved server-side.
- This self-hosted version has no ChatGPT sign-in gate. Its webpage is public unless you configure access protection in Netlify.
- Public gallery metadata, settings and drafts live in browser-local storage. Hidden records and their media key are PIN-encrypted. Actual media copies live in IndexedDB. Galleries do not sync across phones/browser profiles/domains.
- Generated originals remain on RunPod. Completed files are also copied to this device while the app is open. Wait for Saved on this device before stopping the pod if you want local playback.
- Removing a creation deletes its local media copy and gallery record, while keeping the original RunPod output.
- JPG, PNG and WebP references under 15 MB are supported. Export HEIC photos as JPG first.
- The app never starts/stops the pod or changes RunPod billing.
- Netlify handles short API requests and streams media. GPU generation is queued asynchronously on RunPod. Hosting usage/limits follow your Netlify account's plan.

## Verification

The production frontend build, TypeScript and mocked workflow/API checks passed before packaging. GPU checks use mocked endpoints; no paid GPU test job was submitted. Device import and local Blob playback were tested in the browser, including persistence after reload. Native iPhone Save/Share behavior still requires checking on the actual phone.

## Source map

- `src/Studio.tsx`, `src/styles.css`: interface.
- `server/comfy.ts`: workflow builder and RunPod client.
- `server/workflow.ts`, `server/image-workflow.ts`: supplied API workflow graphs.
- `netlify/edge-functions/comfy.ts`: upload, model checks, submission, status, cancellation.
- `netlify/edge-functions/media.ts`: streamed preview/download with byte-range forwarding.
- `netlify.toml`: build and deployment configuration.

Official deployment reference: https://docs.netlify.com/build/edge-functions/get-started/


## Version 2: manual models, gallery folders, PIN and templates

### Add a model yourself

1. Install and test the model/workflow on your RunPod in ComfyUI.
2. In ComfyUI choose **Export (API)**.
3. In Pocket Studio open **Workflows → Import JSON** and choose that file.
4. Set the display name and image/video output type. Check the detected prompt, seed, size, duration and optional reference-image mappings, then **Save workflow**.
5. Choose it in the **Workflow** dropdown on Create, or click **Use** in Workflows. Test the connection before generating.

No GitHub edit or Netlify rebuild is needed for future browser-local workflow imports. Importing JSON does not install or download model files or nodes. A normal UI workflow JSON with `nodes`/`links` is not supported: export API format instead.

Prompt mapping is required. Unmapped settings remain as written in your JSON. Map both width and height together or leave both unchanged. Duration mappings must accept **seconds**, not frames; workflows that derive a frame count from a duration input can map that seconds input. Otherwise leave duration unmapped. Reference images map to an existing `LoadImage.image` input. Save original workflow JSONs separately; imported workflows and edits are local to this browser. Model filenames currently come from your JSON, not from a model marketplace.

### Gallery and folders

- Gallery displays image/video thumbnails with filters and prompt search. Open a tile for a full preview, download, reuse, reference-image action or folder move.
- New folder creates a local organizational folder. Manage folders to rename or remove one. Removing a folder moves its items to Unfiled without deleting media.
- Select **Save to folder** on Create to file new generations automatically.
- Folder organization does not create directories on RunPod. Thumbnail availability depends on the pod and original files.

### Gallery PIN

- **Gallery → Set PIN** creates a 6–12 digit PIN. Confirm the PIN, then use **Lock now**.
- **PIN settings** lets an unlocked user change or remove protection.
- Locking or reloading requires unlocking before gallery records/folders can be read or new generation records can be saved. An existing GPU job continues on RunPod while locked; after unlocking its status is refreshed.
- The browser's saved gallery records (including folder names, media paths and prompts in those records) are encrypted with AES-256-GCM. The key is derived with PBKDF2-SHA256 and held in memory while unlocked. Each save uses a fresh random IV.
- This feature requires **HTTPS** (as Netlify provides) or a browser-trusted localhost development origin. A custom insecure HTTP preview may not support Web Crypto.
- There is no PIN recovery. Keep the PIN safe and download important media before clearing browser/site data. Imported workflow JSONs, general connection settings and template choices are stored separately from the gallery vault.
- The lock protects this browser's local gallery. It does not put a PIN on RunPod files or its ComfyUI history, and does not create an account or cross-device synchronization.

### Built-in generation templates

Template buttons independently toggle instructions such as Cinematic, Photoreal, Continuity lock, One speaker, Immediate dialogue, No text/logos, Natural sound, Portrait lighting and Product studio. Compatible toggles are appended to the prompt only when generating. **All off** disables them; **See applied instructions** shows the exact text. The original draft is saved separately so reusing a creation does not duplicate its template instructions.

### Additional checks

Imported-workflow mappings, invalid imports/mappings, template on/off behavior, encrypted gallery save/read and wrong-PIN rejection are covered by `npm test`, alongside the existing workflow and API mock checks. A live Netlify/RunPod generation test still requires your deployed site and running pod.

## Version 3 — visible projects, Hidden items and timing

After deploying this release, the header and Gallery display **VERSION 3 · PROJECTS + HIDDEN**. If you do not see this label, your browser is showing an older deployment. Confirm Netlify deployed the latest GitHub commit, then reload the page. Do not clear site data to fix a deployment: that would remove browser-local records.

Upload ALL extracted files to the repository root, including new `.tsx`/`.ts` modules in `src/` and both `netlify/edge-functions` handlers. Keep build command `npm run build` and publish directory `dist`.

### Project gallery

Gallery opens on a project-card overview. **New project** creates a separate project for a story or set of generations. Open a card to see its items and use **Generate in project** to save new results directly there. The Create screen also has **Save to project**. Existing version-2 folders automatically appear as projects without losing their IDs or assignments. Project cards use only non-hidden creations as covers/counts.

### Clearly visible gallery lock

The prominent **Lock gallery** button is always available while the gallery is unlocked. Without a PIN it opens setup; **Save PIN & lock gallery** both configures the PIN and locks immediately. With a PIN already configured, **Lock gallery** locks immediately. **PIN settings** remains available while unlocked to change/remove it. The same encrypted records are compatible with the previous release.

### Hidden items

Use the eye-slash button on any completed gallery tile, or **Hide** in its preview. Hidden items are removed from All creations, normal search, project grids/covers/counts and the Create screen's current preview. They retain their original project assignment.

Open **Gallery → Hidden items** to view them. Open an item to **Reuse**, **Download**, **Delete** or **Unhide**; image items also have **Use in video**. Unhiding returns the item to its project. Delete requires confirmation and removes only the gallery record, not the original file on RunPod. Active jobs cannot be hidden or deleted until finished.

Hidden is an organizational flag, not encryption by itself. Set the gallery PIN to encrypt local gallery records. Projects, Hidden items, PIN and timing history are local to this browser; original media remains on RunPod.

### Duration-specific estimated timing bar

Generation timing shows elapsed submission-to-completion time and an estimated progress bar based on the last matching completed run. It displays **Last run**, **Average**, and **Longest recorded**. Expand **Timing by video length** to see independent rows for 4, 5, 6, 8 and 10 seconds. Four-, six-, eight- and ten-second runs never share a duration bucket.

A timing bucket also matches the workflow, resolution preset, frame/aspect, Turbo setting, reference-image use and GPU device (or connection when device details are unavailable). Imported workflows without a seconds mapping use a separate workflow-default duration bucket. Only successful completed runs from this release with measured timestamps contribute; old records without timings are left intact and are not assigned invented durations.

On the first matching generation the bar is indeterminate. Later runs estimate progress from the last matched time, with a cap of 95% until ComfyUI reports completion. At completion the bar reaches 100%. A slower-than-history run stays active and explicitly says it is taking longer.

This is a time estimate, not actual sampler/GPU progress. Times include queue and model loading and are observed at status polling intervals, so completion measurement can lag by about one polling interval. Longest recorded is historical, not a promise or time limit. Hiding an item does not erase its timing; deleting its local record removes that sample from history. Locking pauses browser status polling; after unlocking the job is checked again, so timing can include that locked interval.

## Version 4 — paste, 50-prompt RunPod queue, private footer access and safe downloads

### Paste and bulk generation

The single-prompt editor and Bulk generation panel have a Paste button. Clipboard permissions are controlled by the browser; if access is refused, long-press the input and use the native Paste action.

Expand **Bulk generation** on Create. Paste up to 50 prompts and choose one prompt per line, or multi-line prompts separated by a blank line. All items use the currently selected workflow, templates, duration/size, project and optional reference image. Each item gets a random seed unless you explicitly set a seed.

Click **Queue prompts** once. The page submits small groups of five to ComfyUI and displays the added count. Wait until **all prompts are queued** before closing your phone. ComfyUI's own execution queue processes them sequentially, so the next queued generation starts when the previous job finishes (or fails). The pod and ComfyUI must remain running. No scheduled ChatGPT task or always-open browser is involved after submission.

Stop adding remaining prompts stops future groups, but already queued jobs continue on RunPod. Existing active/pending jobs belonging to other sessions are not cleared or interrupted.

Batch items carry a batch ID and item index in ComfyUI metadata. Interrupted submissions are labelled unconfirmed. Use **Recover queue status** to reconcile those records against the pod queue and recent history. Recovery never automatically resubmits missing/ambiguous items. The backend avoids adding an item again when its batch/index is already found. This is not a distributed lock across simultaneous independent requests; do not submit the same batch concurrently from multiple tabs. Source-of-truth execution lives on RunPod; clearing its queue/history or restarting/deleting the pod can remove recovery information. The recent-history lookup covers 500 records.

The browser polls statuses for queued jobs in batches rather than opening 50 separate render-status requests. Successful completion timings remain separate by duration/settings.

### Discreet private gallery

There is no Hidden-items tab, project card or count in the public gallery. Click **Pocket Studio · Version 4** in the footer, enter the gallery PIN, and the private gallery opens. If no PIN exists, this entry sets one first. Each new footer entry asks for the PIN even when the general gallery was already unlocked. Closing the private view, changing the main navigation or backgrounding the page closes private access. The ordinary optional gallery lock remains available.

Hiding an item removes its project association. It is excluded from public project covers/counts, All creations, public searches, the current Create preview and public timing-history samples. Unhide returns it to Unfiled, after which it can be moved to a project. Old hidden records with project assignments are detached on load/unlock. Private items can be reused, downloaded, selected/deleted or unhidden after PIN access.

The PIN protects this browser's encrypted gallery records at rest; the private-view gate controls the visible interface. It does not protect RunPod's originals or its ComfyUI API/history from someone who already has access to that pod.

### Select and delete

Inside a gallery/project/private view choose **Select items**, select thumbnails (or Select all in view), then **Delete selected**. Active or unconfirmed submissions are not selectable for deletion. Confirm before records are removed. As before, deleting gallery records keeps the original RunPod files; this app does not provide filesystem deletion on RunPod.

### iPhone Home Screen downloads

Download buttons now fetch the media inside the studio and open a small save panel instead of navigating the installed app to `/api/media`. After preparation, tap **Save / Share file**, then choose Save Video, Save Image or Save to Files in the iOS sheet. The second explicit tap supplies the user gesture required by the Web Share API. If sharing is unavailable, the panel offers **Open download in Safari** in a separate browser context. It never automatically replaces the studio page.

Desktop browsers also have a blob-file Save button. A 150 MB Content-Length guard routes large files to the separate browser download option to limit in-app memory use; absent/misreported size headers can still require memory for the full file. Web Share/browser support differs; real iPhone installed-app behavior must be verified on the device. No claim of an end-to-end iOS test is made from the desktop build.

### Verification

`npm run build` and `npm test` cover the updated bundle, 50-item batches in groups of five, duplicate detection, partial failure and recovery, bulk status reconciliation, prompt parsing, encrypted records, hidden/project filtering, timing and MIME handling. These are mock/API logic checks; no live 50-video GPU job was started during development.

Bulk prompts now default to automatic `*prompt*` markers. Each marked prompt can contain new lines and blank lines. Markers are stripped before generation. Use stars only as delimiters in auto mode; select line/block mode for literal stars. Missing markers or text between marked prompts prevents submission.

Completion alerts: new queued/running/unknown → complete transitions show a generic gallery banner across app tabs. Existing completed history, failed jobs and hidden records do not alert. The Completion alerts control near the footer enables a test chime and foreground completion sound for this session. Sound must be enabled again after reload and may be affected by iPhone silent mode/volume. No OS notification permission or background push service is used; a closed/suspended app cannot monitor completion.


## Version 5: R2V and reusable characters

The built-in Reference workflow comes from the user's `video_minimax_h3_r2v.json` API export. It keeps the current T2V/first-frame and Z-Image modes available. R2V resolves switches before submission, uses 20 steps by default and optional 4-step reference Turbo, uses the normal scheduler, and strips template sample prompts/images. The R2V diffusion checkpoint is `minimax_h3_ref2va_pruned_int8_convrot.safetensors`; the existing H3 CLIP and both VAEs are shared. Optional Turbo uses `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors`.

Connect the R2V workflow, create named characters, and upload a photo, a voice, or both. Up to three selected characters are supported in this UI. Standalone voice files must be 2–15 seconds each and at most 15 seconds combined. Each upload is limited to 15 MB. JPG/PNG/WebP images and WAV/MP3/M4A/AAC/FLAC/OGG/WebM audio are accepted when supported by the browser's metadata decoder and ComfyUI. Both types use ComfyUI's generic `/upload/image` route with the `image` multipart field. API reference wiring uses flat dotted keys such as `ref_audios.ref_audio_0`, not nested objects.

Names and references are mapped into every prompt automatically, with independent Picture and Audio numbering. Character selection remains selected for subsequent single generations and is captured for bulk submissions. Reuse restores the character selection where those saved characters still exist. Files must remain in the pod input folder on persistent storage. Character metadata and selected IDs are stored with the gallery in this browser, encrypted when a PIN is enabled. Existing vaults without character fields remain compatible. Characters are scoped to their RunPod URL; another browser or a new pod URL does not automatically inherit the presets. Remove saved character removes the browser record only, leaving uploaded files on RunPod.

Completion alerts now have a persistent Notifications on/off preference plus a separate Sound on/off control for each session. Turning notifications off clears the current banner, suppresses sound and does not replay skipped events when turned back on. These are in-app alerts only, not background or lock-screen push.

At most 20 timing samples are retained globally across all completed jobs. Old elapsedSeconds fields are removed on load, unlock, and job updates. Gallery records, prompts, output links, and completion dates are preserved. The remaining samples still use separate buckets for duration/workflow/size/GPU and R2V image/audio counts.

Validation uses generated API graphs and mocked ComfyUI endpoints, including audio uploads and bulk references. Browser QA covers workflow controls and alert preferences. An actual R2V GPU render and real iPhone audio/voice fidelity require a live pod/device check; no quality or identity guarantee is implied.


## Version 7: each phone keeps its own media

- Completed jobs copy their output files into IndexedDB one at a time. Existing gallery files are copied too if their saved RunPod link is reachable. Missing/offline files and quota failures stay visible as errors; Retry device copies retries them. Closing/suspending the app can interrupt copying; reopening resumes missing copies. The app never auto-deletes RunPod files.
- Playback, Save to phone, and image reuse read the device Blob first. A saved file can play with the original pod offline. The Saved on this device badge confirms local file keys, not a cloud backup. Another phone does not inherit these records or Blobs.
- Gallery → Storage & backup exposes Import project ZIP, Retry device copies and a user-triggered persistent-storage request. The browser may decline persistence. Clearing site data or browser eviction can remove local data; keep important exports in Photos/Files.
- Open a project → Save project ZIP exports its media and generation prompts/settings. All creations and Unfiled can be exported too. Hidden items are always excluded. ZIPs are uncompressed, portable standard ZIPs capped at 512 MB and 500 media files to bound phone memory use. Split larger projects.
- Import project ZIP validates paths, CRC checksums, sizes, manifest fields and file references before writing. It creates fresh job/project IDs and saves media in one IndexedDB transaction. Existing projects are kept; metadata failure rolls back the new media. Imported completed media does not need a RunPod link. Queued prompt-only records become archived prompts rather than resubmitted GPU jobs.
- Project ZIPs include media/prompts/settings, not model weights, custom workflow graphs or saved character photo/voice presets. Those must be configured separately for another generation. Pod URLs, hidden items, PINs and account credentials are not exported.
- Save dialogs prepare files first and then offer a separate Save/Share click to preserve the iPhone user gesture. No download automatically navigates the app away. Browser download-event automation did not capture a desktop save event, so no automated end-to-end native-download claim is made; ZIP interoperability and Blob preparation were independently checked.
- Only Hidden needs a PIN. Hidden media Blobs use AES-GCM with a random media key wrapped inside the PIN-encrypted vault. PIN changes preserve this media key; locking removes it from memory. Hiding converts cached Blobs before moving a record into Hidden; unhiding decrypts device Blobs. Public projects and generation remain usable with Hidden locked. Old whole-gallery vaults migrate after one unlock with the old PIN.
- A service worker caches only the static app shell/assets for reopening offline after successful installation on HTTPS. API responses are excluded; private media lives in IndexedDB. Generation still needs connectivity and a running pod. Do not interpret local galleries as per-user RunPod authorization: people with access to the same pod can still access its original output/API.

Validation: TypeScript/production build; existing workflow/bulk/API regressions; archive roundtrip and Python ZIP interoperability; malformed/corrupt/oversized archive rejection; hidden exclusion; media encryption/wrong-key rejection; serialized media operations; PIN rotation; metadata quota rollback; offline shell fallback. Real browser import showed Saved on this device, a decoded local MP4 Blob with no RunPod base URL, and successful playback after full reload. No real user media or paid GPU job was used for QA.
