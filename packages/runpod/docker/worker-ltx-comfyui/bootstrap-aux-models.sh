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

# Globals переопределяются в main()/resolve_volume_base.
VOLUME_BASE="${LTX_AUX_VOLUME_BASE:-/runpod-volume/ComfyUI/models}"
AUDIO_VAE_DIR=""
UPSCALER_DIR=""

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

resolve_volume_base() {
	# Возвращает первый существующий variant ComfyUI models layout:
	#   1. /runpod-volume/ComfyUI/models                 (наш standard)
	#   2. /runpod-volume/models                          (flat)
	#   3. /workspace/ComfyUI/models                      (legacy pod-mode)
	# Если override задан через env — используем его без проверки (debug).
	if [ -n "${LTX_AUX_VOLUME_BASE_OVERRIDE:-}" ]; then
		echo "${LTX_AUX_VOLUME_BASE_OVERRIDE}"
		return
	fi
	for candidate in \
		"/runpod-volume/ComfyUI/models" \
		"/runpod-volume/models" \
		"/workspace/ComfyUI/models"; do
		if [ -d "${candidate}" ] || [ -d "$(dirname "${candidate}")" ]; then
			echo "${candidate}"
			return
		fi
	done
	# default — даже если volume не смонтирован, попробуем создать
	echo "/runpod-volume/ComfyUI/models"
}

write_sentinel() {
	local status="$1"
	local base="$2"
	local sentinel="${base}/_bootstrap_aux_status.json"
	mkdir -p "${base}" 2>/dev/null || true
	cat >"${sentinel}" <<EOF
{
  "status": "${status}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "image_digest": "${IMAGE_DIGEST:-unknown}",
  "volume_base": "${base}",
  "audio_vae": "$(ls -la "${base}/vae/${AUDIO_VAE_FILE}" 2>/dev/null || echo missing)",
  "upscaler": "$(ls -la "${base}/latent_upscale_models/${UPSCALER_FILE}" 2>/dev/null || echo missing)"
}
EOF
	log "sentinel written to ${sentinel}: ${status}"
}

main() {
	if [ "${LTX_AUX_BOOTSTRAP_DISABLED:-false}" = "true" ]; then
		log "disabled via LTX_AUX_BOOTSTRAP_DISABLED"
		return 0
	fi
	VOLUME_BASE="$(resolve_volume_base)"
	AUDIO_VAE_DIR="${VOLUME_BASE}/vae"
	UPSCALER_DIR="${VOLUME_BASE}/latent_upscale_models"
	log "resolved volume base: ${VOLUME_BASE}"
	log "host info: $(uname -a)"
	log "mounts: $(mount | grep -E 'runpod|workspace' || echo none)"
	log "ls /runpod-volume: $(ls -la /runpod-volume 2>/dev/null | head -10 || echo missing)"
	log "ls VOLUME_BASE: $(ls -la ${VOLUME_BASE} 2>/dev/null | head -10 || echo missing)"

	command -v curl >/dev/null 2>&1 || {
		log "FATAL: curl not in PATH"
		write_sentinel "no-curl" "${VOLUME_BASE}"
		return 0
	}
	log "ensuring aux models present under ${VOLUME_BASE}"
	local rc_audio=0 rc_upscaler=0
	ensure_file "${AUDIO_VAE_DIR}" "${AUDIO_VAE_FILE}" "${AUDIO_VAE_URL}" "${AUDIO_VAE_MIN_BYTES}" || rc_audio=$?
	ensure_file "${UPSCALER_DIR}" "${UPSCALER_FILE}" "${UPSCALER_URL}" "${UPSCALER_MIN_BYTES}" || rc_upscaler=$?
	log "summary vae dir: $(ls -la ${AUDIO_VAE_DIR} 2>/dev/null | head -20 || echo missing)"
	log "summary upscaler dir: $(ls -la ${UPSCALER_DIR} 2>/dev/null | head -20 || echo missing)"
	local status="ok"
	if [ "${rc_audio}" -ne 0 ] || [ "${rc_upscaler}" -ne 0 ]; then
		status="partial(audio=${rc_audio},upscaler=${rc_upscaler})"
	fi
	write_sentinel "${status}" "${VOLUME_BASE}"
	log "done with status: ${status}"
}

main
