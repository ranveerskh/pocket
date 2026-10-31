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
- Settings, prompt and up to 30 job records live in that browser's localStorage. They do not sync across devices/domains or with the original ChatGPT-hosted page.
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
