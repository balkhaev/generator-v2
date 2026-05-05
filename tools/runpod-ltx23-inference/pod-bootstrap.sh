#!/usr/bin/env bash
# Disposable RunPod Pod bootstrap for LTX 2.3 ComfyUI inference.
#
# Executed through RunPod dockerStartCmd:
#   bash -lc 'curl -sSfL "$RUNPOD_LTX23_POD_BOOTSTRAP_URL" | bash'
#
# Required env:
#   POD_RUNNER_URL      Public URL for pod_runner.py.
#   OUTPUT_UPLOAD_URL   Pre-signed S3 PUT URL for the final MP4.
#   LOG_UPLOAD_URL      Pre-signed S3 PUT URL for the live bootstrap log.
#   PROMPT              Text prompt.
#
# The generator polls S3 for the output object and deletes the Pod after upload.
# RunPod restarts containers after exit, so on success we write a sentinel and
# sleep forever. On failure we exit non-zero so the provider can mark the job
# failed when the Pod reaches EXITED/TERMINATED without an artifact.

set -euo pipefail
set -o errtrace

log() { printf '[bootstrap] %s\n' "$*"; }
fail() { log "ERROR: $*"; exit 1; }

trap 'fail "bootstrap aborted on line $LINENO"' ERR

: "${POD_RUNNER_URL:?POD_RUNNER_URL is required}"
: "${OUTPUT_UPLOAD_URL:?OUTPUT_UPLOAD_URL is required}"
: "${PROMPT:?PROMPT is required}"

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
COMFYUI_DIR="${COMFYUI_DIR:-${WORKSPACE_DIR}/ComfyUI}"
POD_RUNNER_DONE_SENTINEL="${WORKSPACE_DIR}/.ltx23-inference-done"
BOOTSTRAP_LOG="${WORKSPACE_DIR}/pod-bootstrap.log"

mkdir -p "$WORKSPACE_DIR"
cd "$WORKSPACE_DIR"
exec > >(tee -a "$BOOTSTRAP_LOG") 2>&1

if [ -f "$POD_RUNNER_DONE_SENTINEL" ]; then
  log "found sentinel $POD_RUNNER_DONE_SENTINEL; inference already succeeded, sleeping until generator deletes the pod"
  exec sleep infinity
fi

if [ -n "${LOG_UPLOAD_URL:-}" ]; then
  log "starting background log shipper"
  (
    while true; do
      if [ -s "$BOOTSTRAP_LOG" ]; then
        curl -sS -X PUT \
          -H "content-type: text/plain; charset=utf-8" \
          --data-binary "@$BOOTSTRAP_LOG" \
          "$LOG_UPLOAD_URL" >/dev/null 2>&1 || true
      fi
      sleep 15
    done
  ) &
fi

if command -v apt-get >/dev/null 2>&1; then
  log "installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl ffmpeg git libgl1 libglib2.0-0
fi

python3 - <<'PY'
import torch
print("[bootstrap] torch=", torch.__version__, "cuda=", torch.version.cuda, "available=", torch.cuda.is_available())
PY

if [ ! -d "$COMFYUI_DIR/.git" ]; then
  log "cloning ComfyUI into $COMFYUI_DIR"
  git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git "$COMFYUI_DIR"
else
  log "ComfyUI already present at $COMFYUI_DIR"
fi

log "installing ComfyUI python dependencies"
python3 -m pip install --upgrade pip wheel setuptools
python3 -m pip install -r "$COMFYUI_DIR/requirements.txt"
python3 -m pip install pillow requests websocket-client

LTX_NODE_DIR="$COMFYUI_DIR/custom_nodes/ComfyUI-LTXVideo"
if [ ! -d "$LTX_NODE_DIR/.git" ]; then
  log "cloning ComfyUI-LTXVideo custom nodes"
  git clone --depth 1 https://github.com/Lightricks/ComfyUI-LTXVideo.git "$LTX_NODE_DIR"
else
  log "ComfyUI-LTXVideo already present"
fi

if [ -f "$LTX_NODE_DIR/requirements.txt" ]; then
  log "installing ComfyUI-LTXVideo dependencies"
  python3 -m pip install -r "$LTX_NODE_DIR/requirements.txt"
fi

log "downloading pod_runner.py"
curl -sSfL "$POD_RUNNER_URL" -o "$WORKSPACE_DIR/pod_runner.py"

log "starting pod_runner.py"
set +e
python3 "$WORKSPACE_DIR/pod_runner.py"
RUNNER_EXIT=$?
set -e

log "pod_runner.py exited with code $RUNNER_EXIT"

if [ -n "${LOG_UPLOAD_URL:-}" ] && [ -s "$BOOTSTRAP_LOG" ]; then
  log "uploading final bootstrap log"
  curl -sS -X PUT \
    -H "content-type: text/plain; charset=utf-8" \
    --data-binary "@$BOOTSTRAP_LOG" \
    "$LOG_UPLOAD_URL" >/dev/null 2>&1 || true
fi

if [ "$RUNNER_EXIT" -eq 0 ]; then
  date -u +'%Y-%m-%dT%H:%M:%SZ' > "$POD_RUNNER_DONE_SENTINEL"
  log "inference succeeded; wrote sentinel and sleeping forever (generator will delete the pod)"
  exec sleep infinity
fi

exit "$RUNNER_EXIT"
