#!/usr/bin/env bash
# Pod-mode bootstrap для тренировки персон-LoRA через ai-toolkit на RunPod.
#
# Скачивается и исполняется внутри RunPod Pod через dockerStartCmd:
#   bash -lc 'curl -sSfL "$RUNPOD_POD_BOOTSTRAP_URL" | bash'
#
# Запускается ПОВЕРХ официального образа `ostris/aitoolkit:latest`, который
# уже содержит:
#   - torch 2.9.1+cu128, torchvision, torchaudio
#   - /app/ai-toolkit (склонированный репо ostris/ai-toolkit)
#   - все pip-зависимости из requirements.txt + собранный UI
#   - openssh-server, ffmpeg, nodejs, curl, unzip
# Этот же image сидит за официальным RunPod-template `0fqzfjy6f3`, поэтому
# хосты RunPod держат его в локальном кеше и `docker pull` занимает секунды
# вместо 10–15 минут на community image.
#
# Контракт env (см. apps/admin/src/providers/runpod-pod-lora-training.ts):
#   POD_RUNNER_URL  Публичный URL pod_runner.py (рядом с этим скриптом).
#   LOG_UPLOAD_URL  Опциональный pre-signed PUT URL для real-time лога.
#   PUBLIC_KEY      Опциональный SSH ключ для отладки (запустится sshd).
#   AI_TOOLKIT_PATH Опционально, default=/app/ai-toolkit.
#   + переменные pod_runner.py: DATASET_URL, OUTPUT_NAME, TRIGGER_WORD,
#     BASE_MODEL, TRAINING_STEPS, LEARNING_RATE, LORA_RANK, DEFAULT_CAPTION,
#     LORA_UPLOAD_URL, опционально HF_TOKEN, RESULT_CALLBACK_URL,
#     RESULT_CALLBACK_TOKEN.
#
# RunPod рестартует контейнер при любом exit (нет одноразового pod-режима),
# поэтому мы:
#   1. Кладём sentinel-файл `<workspace>/.pod-runner-done` после успешного
#      pod_runner.py и при следующем boot сразу уходим в `exec sleep infinity`,
#      чтобы вторая (и третья, и седьмая) тренировка не запустилась.
#   2. После успешного завершения тоже делаем `exec sleep infinity` —
#      контейнер не "падает", desiredStatus у RunPod остаётся RUNNING.
#   3. admin-worker через `pollUntilExited` параллельно опрашивает S3 на
#      наличие `.safetensors` и стопает pod через REST API сам, как только
#      артефакт появился. См. apps/admin/src/providers/runpod-pod-lora-training.ts.
# При ошибке pod_runner.py наоборот — даём контейнеру упасть, чтобы admin
# увидел ненулевой exit/EXITED и пометил тренировку как failed.

set -euo pipefail
set -o errtrace

log() { printf '[bootstrap] %s\n' "$*"; }
fail() { log "ERROR: $*"; exit 1; }

trap 'fail "bootstrap aborted on line $LINENO"' ERR

: "${POD_RUNNER_URL:?POD_RUNNER_URL is required}"

# ostris/aitoolkit:latest держит репо в /app/ai-toolkit, поэтому используем
# именно этот путь по умолчанию. На custom-образах можно переопределить.
export AI_TOOLKIT_PATH="${AI_TOOLKIT_PATH:-/app/ai-toolkit}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
POD_RUNNER_DONE_SENTINEL="${WORKSPACE_DIR}/.pod-runner-done"

mkdir -p "$WORKSPACE_DIR"
cd "$WORKSPACE_DIR"

BOOTSTRAP_LOG="${WORKSPACE_DIR}/pod-bootstrap.log"
exec > >(tee -a "$BOOTSTRAP_LOG") 2>&1

# Sentinel-короткое замыкание: если предыдущая инкарнация контейнера уже
# успешно дотренировала и залила .safetensors, не запускаем тренировку
# заново. Просто держим контейнер живым, пока admin-worker не стопнет pod
# через REST API.
if [ -f "$POD_RUNNER_DONE_SENTINEL" ]; then
  log "found sentinel $POD_RUNNER_DONE_SENTINEL — pod_runner.py already succeeded; sleeping until admin stops the pod"
  exec sleep infinity
fi

log "ostris/aitoolkit slim bootstrap; AI_TOOLKIT_PATH=$AI_TOOLKIT_PATH"

# ─── live log shipper ───────────────────────────────────────────────────────
# Тренировка идёт без публичного IP, поэтому без shipping логов мы остаёмся
# слепы (admin-worker видит только desiredStatus=RUNNING + 0% GPU). При
# наличии LOG_UPLOAD_URL фоновый цикл раз в 15с заливает текущий лог в S3.
if [ -n "${LOG_UPLOAD_URL:-}" ]; then
  log "starting background log shipper (interval=15s)"
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

# ─── optional sshd ──────────────────────────────────────────────────────────
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

# ─── sanity checks ──────────────────────────────────────────────────────────
# Если кто-то запустит этот скрипт на не-ostris образе, явно скажем что не так.
if [ ! -f "$AI_TOOLKIT_PATH/run.py" ]; then
  fail "ai-toolkit not found at $AI_TOOLKIT_PATH (expected $AI_TOOLKIT_PATH/run.py). Use ostris/aitoolkit:* image or set AI_TOOLKIT_PATH/RUNPOD_POD_BOOTSTRAP_URL appropriately."
fi
log "ai-toolkit detected at $AI_TOOLKIT_PATH"
python3 -c 'import torch; print("[bootstrap] torch=", torch.__version__, "cuda=", torch.version.cuda)'

# ─── fetch + run pod_runner.py ─────────────────────────────────────────────
log "downloading pod_runner.py"
curl -sSfL "$POD_RUNNER_URL" -o "$WORKSPACE_DIR/pod_runner.py"

log "starting pod_runner.py"
cd "$WORKSPACE_DIR"

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

if [ "$RUNNER_EXIT" -eq 0 ]; then
  # Успех: ставим sentinel и держим контейнер живым. Admin-worker сам
  # стопнет pod через REST API после того, как увидит .safetensors в S3.
  # Без этого RunPod рестартанёт контейнер и pod_runner.py начнёт тренировку
  # с нуля по кругу (наблюдалось x7 за 2 часа на одном pod).
  date -u +'%Y-%m-%dT%H:%M:%SZ' > "$POD_RUNNER_DONE_SENTINEL"
  log "pod_runner.py succeeded; wrote sentinel and sleeping forever (admin-worker will stop the pod)"
  exec sleep infinity
fi

# При ошибке наоборот — даём контейнеру упасть, чтобы admin увидел EXITED
# с ненулевым кодом и пометил тренировку failed.
exit "$RUNNER_EXIT"
