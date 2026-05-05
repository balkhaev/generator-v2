# RunPod LTX 2.3 Pod Inference

Disposable RunPod Pod runtime for `runpod-ltx-2-3-text-to-video` and
`runpod-ltx-2-3-image-to-video`.

## Runtime Contract

1. Publish these two files to the same public directory:
   - `pod-bootstrap.sh`
   - `pod_runner.py`
2. Set `RUNPOD_LTX23_POD_BOOTSTRAP_URL` to the public URL of `pod-bootstrap.sh`.
   The generator derives `pod_runner.py` by replacing the final path segment.
3. Configure RunPod and S3 env in `apps/generator/.env` or deployment env:
   - `RUNPOD_API_KEY`
   - `RUNPOD_LTX23_POD_BOOTSTRAP_URL`
   - `S3_BUCKET`
   - `S3_ENDPOINT`
   - `S3_ACCESS_KEY_ID`
   - `S3_SECRET_ACCESS_KEY`
   - `S3_PUBLIC_BASE_URL`

Optional:

- `HF_TOKEN` or `HUGGINGFACE_TOKEN` for gated Hugging Face downloads.
- `CIVITAI_API_KEY` for Civitai LoRA downloads.
- `RUNPOD_LTX23_POD_GPU_TYPE_IDS` to tune GPU selection.

## RunPod Template

Use public Pod template `p4f6rm9tb4`: `LTX 2.3 t2v i2v vi2v vt2v inference
with ComfyUI`. It uses image `ls250824/run-comfyui-ltx:28042026`, exposes
ComfyUI on port `8188`, and is sized with a 15 GB container disk plus 90 GB
volume. The generator defaults point at this template.

## Flow

The generator creates a RunPod Pod with pre-signed S3 PUT URLs in env. The Pod
installs ComfyUI, installs `ComfyUI-LTXVideo`, downloads the LTX 2.3 checkpoint,
Gemma text encoder, and Lightricks distilled LoRA, runs the official ComfyUI
workflow, uploads the final MP4 to S3, and then sleeps. If `INPUT_IMAGE_URL` is
set, the same workflow runs image-to-video; otherwise it runs text-to-video. If
`LORA_URL` is set, the runner downloads and inserts that custom LoRA.

Default generation settings match the reference setup shape:

- 896x1280
- about 10 seconds (`241` frames at `24` fps)
- `8` steps
- CFG `1`
- no custom LoRA unless `loraUrl` is provided
- distilled LoRA scale `0.6`
