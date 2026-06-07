"""RunPod serverless TTS worker для VoxCPM2 (openbmb/VoxCPM2).

Общий контракт ввода/вывода (совпадает с worker-tts-higgs), чтобы один TS
workflow (`tts-serverless`) умел маршрутизировать на оба движка:

Input (job["input"]):
    {
        "text": str,                  # обязательный — что озвучить
        "referenceAudioUrl": str?,    # voice cloning: URL reference WAV/mp3
        "referenceText": str?,        # транскрипт reference (улучшает клон)
        "language": str?,             # игнорируется VoxCPM (auto), для Higgs
        "style": str?,                # voice-design тег (в скобках перед текстом)
        "cfgValue": float?,           # VoxCPM CFG (default 2.0)
        "inferenceTimesteps": int?,   # VoxCPM diffusion шаги (default 10)
        "normalize": bool?            # текстовая нормализация (default True)
    }

Output:
    {"audio": [{"filename": str, "type": "s3_url"|"base64", "data": str}]}
либо при ошибке:
    {"error": str}
"""

import base64
import os
import tempfile
import traceback
import uuid

import requests
import runpod
import soundfile as sf
from runpod.serverless.utils import rp_upload

MODEL_ID = os.environ.get("VOXCPM_MODEL_ID", "openbmb/VoxCPM2")
DEFAULT_CFG_VALUE = 2.0
DEFAULT_INFERENCE_TIMESTEPS = 10
REFERENCE_DOWNLOAD_TIMEOUT_S = 60
MAX_TEXT_LENGTH = 5000

# Глобальный кеш модели: грузим один раз на воркер (lazy при первом job'е,
# чтобы упавший mount/HF-cache не валил контейнер на старте в цикле).
_MODEL = None


def _load_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    # Импорт внутри функции — ускоряет старт контейнера и даёт понятный
    # error message в job'е, если зависимость сломана.
    from voxcpm import VoxCPM

    _MODEL = VoxCPM.from_pretrained(MODEL_ID, load_denoiser=False)
    return _MODEL


def _download_reference(url: str) -> str:
    """Скачивает reference-аудио во временный файл, возвращает путь."""
    response = requests.get(url, timeout=REFERENCE_DOWNLOAD_TIMEOUT_S, stream=True)
    response.raise_for_status()
    suffix = os.path.splitext(url.split("?")[0])[1] or ".wav"
    fd, path = tempfile.mkstemp(suffix=suffix, prefix="voxcpm-ref-")
    with os.fdopen(fd, "wb") as handle:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                handle.write(chunk)
    return path


def _build_text(raw_text: str, style: str | None) -> str:
    """VoxCPM voice-design: тег стиля передаётся в скобках перед текстом."""
    text = raw_text.strip()
    style = (style or "").strip()
    if style:
        wrapped = style if style.startswith("(") else f"({style})"
        return f"{wrapped} {text}"
    return text


def _coerce_float(value, fallback: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _coerce_int(value, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def handler(job):
    job_input = job.get("input") or {}
    text = job_input.get("text")
    if not isinstance(text, str) or not text.strip():
        return {"error": "Field 'text' is required and must be a non-empty string"}
    if len(text) > MAX_TEXT_LENGTH:
        return {"error": f"Field 'text' exceeds {MAX_TEXT_LENGTH} characters"}

    reference_path = None
    output_path = None
    try:
        model = _load_model()

        reference_url = job_input.get("referenceAudioUrl")
        if isinstance(reference_url, str) and reference_url.strip():
            reference_path = _download_reference(reference_url.strip())

        generate_kwargs = {
            "text": _build_text(text, job_input.get("style")),
            "cfg_value": _coerce_float(job_input.get("cfgValue"), DEFAULT_CFG_VALUE),
            "inference_timesteps": _coerce_int(
                job_input.get("inferenceTimesteps"), DEFAULT_INFERENCE_TIMESTEPS
            ),
        }
        if reference_path:
            generate_kwargs["reference_wav_path"] = reference_path
            reference_text = job_input.get("referenceText")
            if isinstance(reference_text, str) and reference_text.strip():
                generate_kwargs["reference_text"] = reference_text.strip()
        if job_input.get("normalize") is False:
            generate_kwargs["normalize"] = False

        wav = model.generate(**generate_kwargs)
        sample_rate = model.tts_model.sample_rate

        filename = f"voxcpm-{uuid.uuid4().hex}.wav"
        fd, output_path = tempfile.mkstemp(suffix=".wav", prefix="voxcpm-out-")
        os.close(fd)
        sf.write(output_path, wav, sample_rate)

        if os.environ.get("BUCKET_ENDPOINT_URL"):
            s3_url = rp_upload.upload_image(job["id"], output_path)
            return {"audio": [{"filename": filename, "type": "s3_url", "data": s3_url}]}

        with open(output_path, "rb") as handle:
            encoded = base64.b64encode(handle.read()).decode("utf-8")
        return {"audio": [{"filename": filename, "type": "base64", "data": encoded}]}
    except Exception as error:  # noqa: BLE001 — возвращаем причину в job output
        return {
            "error": f"VoxCPM TTS failed: {error}",
            "details": traceback.format_exc(),
        }
    finally:
        for path in (reference_path, output_path):
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass


runpod.serverless.start({"handler": handler})
