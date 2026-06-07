"""EXPERIMENTAL RunPod serverless TTS worker для Higgs Audio v3 4B.

ЛИЦЕНЗИЯ: Research & Non-Commercial (Boson AI). Коммерческое использование /
хостинг требует отдельной лицензии. Включать только за
RUNPOD_HIGGS_TTS_ENDPOINT_ID.

Higgs v3 сервится через SGLang-Omni (OpenAI-совместимый /v1/audio/speech).
Воркер поднимает `sgl-omni serve` как фоновый процесс один раз на контейнер,
дожидается готовности, затем проксирует jobs.

Общий контракт ввода/вывода совпадает с worker-tts-voxcpm, чтобы один TS
workflow (`tts-serverless`) маршрутизировал на оба движка:

Input (job["input"]):
    {
        "text": str,                  # обязательный — что озвучить
        "referenceAudioUrl": str?,    # voice cloning: URL/путь reference WAV/mp3
        "referenceText": str?,        # транскрипт reference (улучшает клон)
        "language": str?,             # подсказка языка
        "style": str?,                # inline control: стиль/просодия
        "emotion": str?,              # inline control: <|emotion:...|>
        "temperature": float?,        # сэмплинг
        "topK": int?,                 # top-k
        "maxNewTokens": int?          # лимит токенов
    }

Output:
    {"audio": [{"filename": str, "type": "s3_url"|"base64", "data": str}]}
либо при ошибке:
    {"error": str}
"""

import base64
import os
import subprocess
import tempfile
import time
import traceback
import uuid

import requests
import runpod
from runpod.serverless.utils import rp_upload

MODEL_ID = os.environ.get("HIGGS_MODEL_ID", "bosonai/higgs-audio-v3-tts-4b")
SERVER_PORT = int(os.environ.get("HIGGS_SERVER_PORT", "8000"))
SERVER_BASE_URL = f"http://127.0.0.1:{SERVER_PORT}"
SERVER_READY_TIMEOUT_S = int(os.environ.get("HIGGS_SERVER_READY_TIMEOUT_S", "600"))
SERVER_POLL_INTERVAL_S = 3
GENERATE_TIMEOUT_S = int(os.environ.get("HIGGS_GENERATE_TIMEOUT_S", "300"))
MAX_TEXT_LENGTH = 5000

# Один фоновый sgl-omni процесс на воркер. Поднимается лениво при первом job'е,
# чтобы упавший mount/HF-cache не валил контейнер на старте в цикле рестартов.
_SERVER_PROC = None


def _server_is_ready() -> bool:
    for path in ("/health", "/v1/models"):
        try:
            response = requests.get(f"{SERVER_BASE_URL}{path}", timeout=5)
            if response.ok:
                return True
        except requests.RequestException:
            continue
    return False


def _ensure_server() -> None:
    """Поднимает sgl-omni serve (если ещё не запущен) и ждёт готовности."""
    global _SERVER_PROC
    if _server_is_ready():
        return
    if _SERVER_PROC is None or _SERVER_PROC.poll() is not None:
        _SERVER_PROC = subprocess.Popen(  # noqa: S603 — фиксированная команда
            [
                "sgl-omni",
                "serve",
                "--model-path",
                MODEL_ID,
                "--port",
                str(SERVER_PORT),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
        )

    deadline = time.time() + SERVER_READY_TIMEOUT_S
    while time.time() < deadline:
        if _server_is_ready():
            return
        if _SERVER_PROC.poll() is not None:
            raise RuntimeError(
                f"sgl-omni serve exited early with code {_SERVER_PROC.returncode}"
            )
        time.sleep(SERVER_POLL_INTERVAL_S)
    raise RuntimeError("sgl-omni serve did not become ready in time")


def _build_input(job_input: dict) -> str:
    """Inline control tokens: emotion/style оборачиваются в <|...|> перед текстом."""
    text = (job_input.get("text") or "").strip()
    prefixes = []
    emotion = (job_input.get("emotion") or "").strip()
    if emotion:
        prefixes.append(emotion if emotion.startswith("<|") else f"<|emotion:{emotion}|>")
    style = (job_input.get("style") or "").strip()
    if style:
        prefixes.append(style if style.startswith("<|") else f"<|prosody:{style}|>")
    if prefixes:
        return f"{''.join(prefixes)} {text}"
    return text


def _coerce_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _build_payload(job_input: dict) -> dict:
    payload = {"input": _build_input(job_input), "response_format": "wav"}

    reference_url = job_input.get("referenceAudioUrl")
    if isinstance(reference_url, str) and reference_url.strip():
        reference = {"audio_path": reference_url.strip()}
        reference_text = job_input.get("referenceText")
        if isinstance(reference_text, str) and reference_text.strip():
            reference["text"] = reference_text.strip()
        payload["references"] = [reference]

    language = job_input.get("language")
    if isinstance(language, str) and language.strip():
        payload["language"] = language.strip()

    temperature = _coerce_float(job_input.get("temperature"))
    if temperature is not None:
        payload["temperature"] = temperature
    top_k = _coerce_int(job_input.get("topK"))
    if top_k is not None:
        payload["top_k"] = top_k
    max_new_tokens = _coerce_int(job_input.get("maxNewTokens"))
    if max_new_tokens is not None:
        payload["max_new_tokens"] = max_new_tokens

    return payload


def handler(job):
    job_input = job.get("input") or {}
    text = job_input.get("text")
    if not isinstance(text, str) or not text.strip():
        return {"error": "Field 'text' is required and must be a non-empty string"}
    if len(text) > MAX_TEXT_LENGTH:
        return {"error": f"Field 'text' exceeds {MAX_TEXT_LENGTH} characters"}

    output_path = None
    try:
        _ensure_server()

        response = requests.post(
            f"{SERVER_BASE_URL}/v1/audio/speech",
            json=_build_payload(job_input),
            timeout=GENERATE_TIMEOUT_S,
        )
        response.raise_for_status()
        audio_bytes = response.content
        if not audio_bytes:
            return {"error": "Higgs TTS returned empty audio"}

        filename = f"higgs-{uuid.uuid4().hex}.wav"
        fd, output_path = tempfile.mkstemp(suffix=".wav", prefix="higgs-out-")
        with os.fdopen(fd, "wb") as handle:
            handle.write(audio_bytes)

        if os.environ.get("BUCKET_ENDPOINT_URL"):
            s3_url = rp_upload.upload_image(job["id"], output_path)
            return {"audio": [{"filename": filename, "type": "s3_url", "data": s3_url}]}

        encoded = base64.b64encode(audio_bytes).decode("utf-8")
        return {"audio": [{"filename": filename, "type": "base64", "data": encoded}]}
    except Exception as error:  # noqa: BLE001 — возвращаем причину в job output
        return {
            "error": f"Higgs TTS failed: {error}",
            "details": traceback.format_exc(),
        }
    finally:
        if output_path and os.path.exists(output_path):
            try:
                os.remove(output_path)
            except OSError:
                pass


runpod.serverless.start({"handler": handler})
