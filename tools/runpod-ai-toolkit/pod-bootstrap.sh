#!/usr/bin/env bash
# Pod-mode bootstrap для тренировки персон-LoRA через ai-toolkit на RunPod.
#
# Скачивается и исполняется внутри RunPod Pod через dockerStartCmd:
#   bash -lc 'curl -sSfL "$RUNPOD_POD_BOOTSTRAP_URL" | bash'
#
# Контракт env (см. apps/admin/src/providers/runpod-pod-lora-training.ts):
#   POD_RUNNER_URL       Публичный URL pod_runner.py (рядом с этим скриптом).
#   AI_TOOLKIT_REF       Опциональный git ref ostris/ai-toolkit, default=main.
#   + все переменные, которые нужны pod_runner.py (DATASET_URL, OUTPUT_NAME,
#     TRIGGER_WORD, BASE_MODEL, TRAINING_STEPS, LEARNING_RATE, LORA_RANK,
#     DEFAULT_CAPTION, LORA_UPLOAD_URL, опционально HF_TOKEN, RESULT_CALLBACK_URL,
#     RESULT_CALLBACK_TOKEN, AI_TOOLKIT_PATH).
#
# Скрипт:
#   1) ставит системные пакеты (git, unzip, python build deps);
#   2) клонирует ostris/ai-toolkit;
#   3) ставит pip-зависимости (torch уже в base-образе runpod/pytorch);
#   4) скачивает pod_runner.py;
#   5) запускает pod_runner.py.
#
# Pod завершается с кодом pod_runner.py — admin-worker ловит это через RunPod
# REST API (desiredStatus → EXITED) и забирает результат из S3 по pre-signed URL.

set -euo pipefail
set -o errtrace

log() { printf '[bootstrap] %s\n' "$*"; }
fail() { log "ERROR: $*"; exit 1; }

trap 'fail "bootstrap aborted on line $LINENO"' ERR

: "${POD_RUNNER_URL:?POD_RUNNER_URL is required}"

AI_TOOLKIT_PATH="${AI_TOOLKIT_PATH:-/workspace/ai-toolkit}"
AI_TOOLKIT_REF="${AI_TOOLKIT_REF:-main}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"

mkdir -p "$WORKSPACE_DIR"
cd "$WORKSPACE_DIR"

log "installing system dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y --no-install-recommends git curl unzip ca-certificates >/dev/null
log "system deps installed"

if [ ! -d "$AI_TOOLKIT_PATH/.git" ]; then
  log "cloning ostris/ai-toolkit (ref=$AI_TOOLKIT_REF) into $AI_TOOLKIT_PATH"
  git clone --depth 1 --branch "$AI_TOOLKIT_REF" \
    https://github.com/ostris/ai-toolkit.git "$AI_TOOLKIT_PATH"
else
  log "ai-toolkit already present at $AI_TOOLKIT_PATH, skipping clone"
fi

cd "$AI_TOOLKIT_PATH"
log "installing ai-toolkit python requirements"
python3 -m pip install --no-cache-dir --upgrade pip setuptools wheel >/dev/null
python3 -m pip install --no-cache-dir -r requirements.txt
python3 -m pip install --no-cache-dir pyyaml

log "downloading pod_runner.py"
curl -sSfL "$POD_RUNNER_URL" -o "$WORKSPACE_DIR/pod_runner.py"

log "starting pod_runner.py"
cd "$WORKSPACE_DIR"
export AI_TOOLKIT_PATH
exec python3 pod_runner.py
