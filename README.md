# Pocket Studio — GitHub + Netlify

Phone-friendly ComfyUI interface with **MiniMax H3 video** and **Z-Image Turbo images**. Your laptop can stay off after deploying; your RunPod pod and ComfyUI must stay running.

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
- Settings, prompt and gallery records live in that browser's localStorage. They do not sync across devices/domains or with the original ChatGPT-hosted page.
- Generated files stay on RunPod. Keep the pod running for preview/download and download files before deleting storage.
- Removing a local record does not delete the original RunPod output.
- JPG, PNG and WebP references under 15 MB are supported. Export HEIC photos as JPG first.
- The app never starts/stops the pod or changes RunPod billing.
- Netlify handles short API requests and streams media. GPU generation is queued asynchronously on RunPod. Hosting usage/limits follow your Netlify account's plan.

## Verification

The production frontend build, TypeScript and mocked workflow/API checks passed before packaging. **No live RunPod endpoint was provided, so actual GPU generation and an actual Netlify deployment remain unverified.**

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
