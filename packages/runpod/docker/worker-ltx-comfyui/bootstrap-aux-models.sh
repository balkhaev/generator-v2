#!/bin/bash
# Bootstrap дополнительных LTX 2.3 моделей на network volume при старте
# worker'а. Запускается перед оригинальным /start.sh и идемпотентно
# скачивает audio VAE и spatial upscaler если их ещё нет на volume.
#
# Volume layout (см. extra_model_paths.yaml):
#   /runpod-volume/ComfyUI/models/vae/                  → видео VAE, audio VAE
#   /runpod-volume/ComfyUI/models/latent_upscale_models/ → spatial upscaler
#
# Файлы:
#   - LTX23_audio_vae_bf16.safetensors      (365 MB, Kijai/LTX2.3_comfy)
#   - ltx-2.3-spatial-upscaler-x2-1.1.safetensors (996 MB, Lightricks/LTX-2.3)
#
# Размер ~1.4 GB; на HF Xet ~30-60s при good network. После первого
# успешного скачивания файлы остаются на volume и shared между всеми
# worker'ами этого endpoint'а — следующие cold start'ы не качают.
#
# Errors не блокируют запуск worker'а: если HF недоступен или volume RO —
# просто пишем warning и продолжаем (workflow всё равно упадёт с явной
# ошибкой про missing file, что лучше чем silent hang).

set -u

VOLUME_BASE="${LTX_AUX_VOLUME_BASE:-/runpod-volume/ComfyUI/models}"
AUDIO_VAE_DIR="${VOLUME_BASE}/vae"
UPSCALER_DIR="${VOLUME_BASE}/latent_upscale_models"

AUDIO_VAE_FILE="LTX23_audio_vae_bf16.safetensors"
AUDIO_VAE_URL="https://huggingface.co/Kijai/LTX2.3_comfy/resolve/main/vae/${AUDIO_VAE_FILE}"
AUDIO_VAE_MIN_BYTES=$((350 * 1024 * 1024)) # 350 MB sanity threshold

UPSCALER_FILE="ltx-2.3-spatial-upscaler-x2-1.1.safetensors"
UPSCALER_URL="https://huggingface.co/Lightricks/LTX-2.3/resolve/main/${UPSCALER_FILE}"
UPSCALER_MIN_BYTES=$((950 * 1024 * 1024)) # 950 MB sanity threshold

log() {
	echo "[bootstrap-aux] $(date -u +%Y-%m-%dT%H:%M:%SZ) $1"
}

ensure_file() {
	local dest_dir="$1"
	local file="$2"
	local url="$3"
	local min_bytes="$4"
	local dest_path="${dest_dir}/${file}"
	if [ -f "${dest_path}" ]; then
		local size
		size=$(stat -c %s "${dest_path}" 2>/dev/null || echo 0)
		if [ "${size}" -ge "${min_bytes}" ]; then
			log "${file}: present (${size} bytes), skip"
			return 0
		fi
		log "${file}: present but truncated (${size} bytes < ${min_bytes}), re-download"
		rm -f "${dest_path}"
	fi
	mkdir -p "${dest_dir}" || {
		log "${file}: ERROR cannot mkdir ${dest_dir}"
		return 1
	}
	log "${file}: downloading from ${url}"
	# --continue: resume after partial download (e.g. worker recycled mid-pull)
	# --tries: retry on transient HF rate-limit / network blips
	# --timeout: per-request timeout (HF Xet redirects can be slow)
	if wget --continue --tries=10 --waitretry=10 --timeout=120 \
		--no-verbose -O "${dest_path}" "${url}"; then
		local final_size
		final_size=$(stat -c %s "${dest_path}" 2>/dev/null || echo 0)
		log "${file}: downloaded (${final_size} bytes)"
		return 0
	fi
	log "${file}: ERROR download failed; leaving partial file for next resume"
	return 1
}

main() {
	if [ "${LTX_AUX_BOOTSTRAP_DISABLED:-false}" = "true" ]; then
		log "disabled via LTX_AUX_BOOTSTRAP_DISABLED"
		return 0
	fi
	if [ ! -d "$(dirname "${VOLUME_BASE}")" ]; then
		log "volume base directory missing: $(dirname "${VOLUME_BASE}") — skipping bootstrap"
		return 0
	fi
	log "ensuring aux models present under ${VOLUME_BASE}"
	ensure_file "${AUDIO_VAE_DIR}" "${AUDIO_VAE_FILE}" "${AUDIO_VAE_URL}" "${AUDIO_VAE_MIN_BYTES}" || true
	ensure_file "${UPSCALER_DIR}" "${UPSCALER_FILE}" "${UPSCALER_URL}" "${UPSCALER_MIN_BYTES}" || true
	log "done"
}

main
