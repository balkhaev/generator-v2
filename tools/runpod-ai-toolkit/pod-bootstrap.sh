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

BOOTSTRAP_LOG="${WORKSPACE_DIR}/pod-bootstrap.log"
exec > >(tee -a "$BOOTSTRAP_LOG") 2>&1

# ─── live log shipper ───────────────────────────────────────────────────────
# Тренировка идёт внутри pod-а без публичного IP, поэтому без shipping
# логов мы остаёмся слепы: если pip упал или модель не качается, мы видим
# только desiredStatus=RUNNING + 0% GPU. Когда LOG_UPLOAD_URL передан
# (presigned PUT URL), фоновый цикл раз в 30с заливает текущий лог в S3
# и admin-worker может его прочитать без SSH/console.
if [ -n "${LOG_UPLOAD_URL:-}" ]; then
  log "starting background log shipper (interval=30s)"
  (
    while true; do
      if [ -s "$BOOTSTRAP_LOG" ]; then
        curl -sS -X PUT \
          -H "content-type: text/plain; charset=utf-8" \
          --data-binary "@$BOOTSTRAP_LOG" \
          "$LOG_UPLOAD_URL" >/dev/null 2>&1 || true
      fi
      sleep 30
    done
  ) &
fi

log "installing system dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y --no-install-recommends git curl unzip ca-certificates openssh-server >/dev/null
log "system deps installed"

if [ -n "${PUBLIC_KEY:-}" ]; then
  log "configuring sshd for debugging"
  mkdir -p /root/.ssh
  chmod 700 /root/.ssh
  printf '%s\n' "$PUBLIC_KEY" > /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
  mkdir -p /var/run/sshd
  if [ -x /usr/sbin/sshd ]; then
    /usr/sbin/sshd >/dev/null 2>&1 || true
    log "sshd started in background"
  fi
fi

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

# Запускаем без exec, чтобы фоновый log shipper мог отправить финальный
# чанк лога после завершения тренировки.
set +e
python3 pod_runner.py
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

exit "$RUNNER_EXIT"
