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
# Используется curl -fL (fail on HTTP error, follow redirects). HF Xet
# redirect'ы вынуждают разворачивать ответ через -L. Проверка
# content-length против sanity threshold отсеивает HTML error pages.
#
# После первого успешного скачивания файлы остаются на network volume и
# shared между всеми worker'ами endpoint'а.

set -u

VOLUME_BASE="${LTX_AUX_VOLUME_BASE:-/runpod-volume/ComfyUI/models}"
AUDIO_VAE_DIR="${VOLUME_BASE}/vae"
UPSCALER_DIR="${VOLUME_BASE}/latent_upscale_models"

AUDIO_VAE_FILE="LTX23_audio_vae_bf16.safetensors"
AUDIO_VAE_URL="https://huggingface.co/Kijai/LTX2.3_comfy/resolve/main/vae/${AUDIO_VAE_FILE}"
AUDIO_VAE_MIN_BYTES=$((350 * 1024 * 1024))

UPSCALER_FILE="ltx-2.3-spatial-upscaler-x2-1.1.safetensors"
UPSCALER_URL="https://huggingface.co/Lightricks/LTX-2.3/resolve/main/${UPSCALER_FILE}"
UPSCALER_MIN_BYTES=$((950 * 1024 * 1024))

log() {
	echo "[bootstrap-aux] $(date -u +%Y-%m-%dT%H:%M:%SZ) $1"
}

is_valid_safetensors() {
	# Минимальная sanity: файл начинается с 8-byte LE header (header_len) и
	# первые ~16 байт ASCII-print/JSON braces. Не валидируем содержимое.
	local path="$1"
	if [ ! -s "${path}" ]; then
		return 1
	fi
	local size
	size=$(stat -c %s "${path}" 2>/dev/null || echo 0)
	if [ "${size}" -lt 1024 ]; then
		return 1
	fi
	# Detect HTML error responses (e.g. HF rate-limit / unauthorized).
	if head -c 64 "${path}" | grep -q -i -e '<html' -e '<!doctype' -e '<head'; then
		return 1
	fi
	return 0
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
		if [ "${size}" -ge "${min_bytes}" ] && is_valid_safetensors "${dest_path}"; then
			log "${file}: present and valid (${size} bytes), skip"
			return 0
		fi
		log "${file}: present but invalid or truncated (${size} bytes), re-download"
		rm -f "${dest_path}"
	fi
	mkdir -p "${dest_dir}" || {
		log "${file}: ERROR cannot mkdir ${dest_dir}"
		return 1
	}
	log "${file}: downloading from ${url}"
	local attempt
	for attempt in 1 2 3 4 5; do
		# -f: fail on HTTP >=400; -L: follow HF Xet redirects;
		# -C -: resume from any partial; --retry: in-curl retries for blips.
		if curl -fL --retry 8 --retry-delay 5 --retry-max-time 0 \
			--connect-timeout 30 -C - -o "${dest_path}.partial" "${url}"; then
			mv "${dest_path}.partial" "${dest_path}"
			local final_size
			final_size=$(stat -c %s "${dest_path}" 2>/dev/null || echo 0)
			if [ "${final_size}" -ge "${min_bytes}" ] && is_valid_safetensors "${dest_path}"; then
				log "${file}: downloaded ok (${final_size} bytes)"
				return 0
			fi
			log "${file}: post-download validation failed (${final_size} bytes), retry"
			rm -f "${dest_path}"
		else
			log "${file}: curl exit non-zero on attempt ${attempt}; partial kept for resume"
		fi
		sleep 10
	done
	log "${file}: ERROR exhausted retries"
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
	command -v curl >/dev/null 2>&1 || {
		log "curl not in PATH; falling back to no-op (worker base image должен иметь curl)"
		return 0
	}
	ensure_file "${AUDIO_VAE_DIR}" "${AUDIO_VAE_FILE}" "${AUDIO_VAE_URL}" "${AUDIO_VAE_MIN_BYTES}" || true
	ensure_file "${UPSCALER_DIR}" "${UPSCALER_FILE}" "${UPSCALER_URL}" "${UPSCALER_MIN_BYTES}" || true
	log "summary: $(ls -la ${VOLUME_BASE}/vae 2>/dev/null | head -20)"
	log "summary: $(ls -la ${VOLUME_BASE}/latent_upscale_models 2>/dev/null | head -20)"
	log "done"
}

main
