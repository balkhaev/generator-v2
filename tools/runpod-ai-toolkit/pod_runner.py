"""
Pod-mode runner для тренировки персон-LoRA через ai-toolkit.

В отличие от handler.py (RunPod serverless), этот скрипт запускается внутри
обычного RunPod Pod. Все параметры передаются через переменные окружения; готовый
.safetensors заливается на pre-signed URL, который сгенерил admin-worker.

Контракт env (см. apps/admin/src/providers/runpod-pod-lora-training.ts):

Required:
    DATASET_URL              HTTPS-ссылка на zip с парами image/text.
    TRIGGER_WORD             Уникальный трен-токен.
    DEFAULT_CAPTION          Caption по умолчанию.
    TRAINING_STEPS           int
    LEARNING_RATE            float
    LORA_RANK                int
    BASE_MODEL               z-image | flux-dev | flux-schnell |
                             flux2-dev | sdxl | qwen-image
    OUTPUT_NAME              Имя итогового .safetensors (без расширения).
    LORA_UPLOAD_URL          Pre-signed S3 PUT URL.

Optional:
    LORA_UPLOAD_CONTENT_TYPE Default: application/octet-stream
    AI_TOOLKIT_PATH          Default: /workspace/ai-toolkit (cloned by bootstrap)
    HF_TOKEN                 HuggingFace token для скачивания base-моделей.
    RESULT_CALLBACK_URL      Опциональный POST для уведомления admin-worker.
                             Body: { status: "ok"|"error", error?, sizeBytes? }
    RESULT_CALLBACK_TOKEN    Bearer для callback-а.

Pod завершается с exit 0 при успехе и с exit code 1+ при ошибке. Admin-worker
поллит pod через RunPod REST API и забирает результат из S3 по предсказуемому
URL после того, как pod ушёл в EXITED.
"""

from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

import yaml

AI_TOOLKIT_PATH = Path(os.getenv("AI_TOOLKIT_PATH", "/workspace/ai-toolkit"))
AI_TOOLKIT_RUN_SCRIPT = AI_TOOLKIT_PATH / "run.py"

BASE_MODEL_MAP: dict[str, dict[str, Any]] = {
    "z-image": {
        "model": {
            "name_or_path": "Tongyi-MAI/Z-Image-Turbo",
            "arch": "zimage",
            "quantize": True,
        },
        "sample": {"sampler": "flowmatch", "sample_steps": 8, "guidance_scale": 1.0},
        "train": {"noise_scheduler": "flowmatch"},
    },
    "flux-dev": {
        "model": {
            "name_or_path": "black-forest-labs/FLUX.1-dev",
            "is_flux": True,
            "quantize": True,
        },
        "sample": {"sampler": "flowmatch", "sample_steps": 28, "guidance_scale": 3.5},
        "train": {"noise_scheduler": "flowmatch"},
    },
    "flux-schnell": {
        "model": {
            "name_or_path": "black-forest-labs/FLUX.1-schnell",
            "is_flux": True,
            "quantize": True,
        },
        "sample": {"sampler": "flowmatch", "sample_steps": 4, "guidance_scale": 1.0},
        "train": {"noise_scheduler": "flowmatch"},
    },
    "flux2-dev": {
        "model": {
            "name_or_path": "black-forest-labs/FLUX.2-dev",
            "arch": "flux2",
            "quantize": True,
        },
        "sample": {"sampler": "flowmatch", "sample_steps": 28, "guidance_scale": 3.5},
        "train": {"noise_scheduler": "flowmatch"},
    },
    "sdxl": {
        "model": {
            "name_or_path": "stabilityai/stable-diffusion-xl-base-1.0",
            "is_xl": True,
            "quantize": False,
        },
        "sample": {"sampler": "ddpm", "sample_steps": 25, "guidance_scale": 7.0},
        "train": {"noise_scheduler": "ddpm"},
    },
    "qwen-image": {
        "model": {
            "name_or_path": "Qwen/Qwen-Image",
            "arch": "qwen_image",
            "quantize": True,
        },
        "sample": {"sampler": "flowmatch", "sample_steps": 28, "guidance_scale": 3.5},
        "train": {"noise_scheduler": "flowmatch"},
    },
}

REQUIRED_ENV_KEYS = (
    "DATASET_URL",
    "TRIGGER_WORD",
    "DEFAULT_CAPTION",
    "TRAINING_STEPS",
    "LEARNING_RATE",
    "LORA_RANK",
    "BASE_MODEL",
    "OUTPUT_NAME",
    "LORA_UPLOAD_URL",
)


def log(message: str, **fields: Any) -> None:
    payload = {"event": message, **fields}
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def require_env() -> dict[str, str]:
    missing = [key for key in REQUIRED_ENV_KEYS if not os.environ.get(key)]
    if missing:
        raise RuntimeError(f"Missing required env vars: {missing}")
    return {key: os.environ[key] for key in REQUIRED_ENV_KEYS}


def download_dataset(dataset_url: str, target_dir: Path) -> int:
    target_dir.mkdir(parents=True, exist_ok=True)
    log("dataset.downloading", url=dataset_url)
    with urllib.request.urlopen(dataset_url, timeout=600) as response:
        zip_bytes = response.read()
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        zf.extractall(target_dir)
    image_count = sum(
        1
        for entry in target_dir.iterdir()
        if entry.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    )
    log("dataset.extracted", image_count=image_count)
    return image_count


def build_ai_toolkit_config(
    *,
    base_model: str,
    dataset_dir: Path,
    default_caption: str,
    learning_rate: float,
    lora_rank: int,
    output_dir: Path,
    output_name: str,
    training_steps: int,
    trigger_word: str,
) -> dict[str, Any]:
    if base_model not in BASE_MODEL_MAP:
        raise ValueError(
            f"Unsupported base_model: {base_model}. "
            f"Available: {sorted(BASE_MODEL_MAP)}"
        )
    profile = BASE_MODEL_MAP[base_model]
    return {
        "job": "extension",
        "config": {
            "name": output_name,
            "process": [
                {
                    "type": "sd_trainer",
                    "training_folder": str(output_dir),
                    "device": "cuda:0",
                    "trigger_word": trigger_word,
                    "network": {
                        "type": "lora",
                        "linear": lora_rank,
                        "linear_alpha": lora_rank,
                    },
                    "save": {
                        "dtype": "float16",
                        "save_every": training_steps,
                        "max_step_saves_to_keep": 1,
                        "push_to_hub": False,
                    },
                    "datasets": [
                        {
                            "folder_path": str(dataset_dir),
                            "default_caption": default_caption,
                            "caption_ext": "txt",
                            "caption_dropout_rate": 0.05,
                            "shuffle_tokens": False,
                            "cache_latents_to_disk": True,
                            "resolution": [512, 768, 1024],
                        }
                    ],
                    "train": {
                        "batch_size": 1,
                        "steps": training_steps,
                        "gradient_accumulation_steps": 1,
                        "train_unet": True,
                        "train_text_encoder": False,
                        "gradient_checkpointing": True,
                        "noise_scheduler": profile["train"]["noise_scheduler"],
                        "optimizer": "adamw8bit",
                        "lr": learning_rate,
                        "ema_config": {"use_ema": False},
                        "dtype": "bf16",
                    },
                    "model": {
                        **{
                            k: v
                            for k, v in profile["model"].items()
                            if k != "name_or_path"
                        },
                        "name_or_path": profile["model"]["name_or_path"],
                        "low_vram": False,
                    },
                    "sample": {
                        "sampler": profile["sample"]["sampler"],
                        "sample_every": training_steps,
                        "width": 1024,
                        "height": 1024,
                        "prompts": [
                            f"a photo of {trigger_word}, studio portrait, soft light",
                        ],
                        "neg": "",
                        "seed": 42,
                        "walk_seed": True,
                        "guidance_scale": profile["sample"]["guidance_scale"],
                        "sample_steps": profile["sample"]["sample_steps"],
                    },
                }
            ],
        },
        "meta": {"name": output_name, "version": "1.0"},
    }


def run_ai_toolkit(config_path: Path) -> str:
    log("training.starting", config_path=str(config_path))
    proc = subprocess.Popen(
        [sys.executable, str(AI_TOOLKIT_RUN_SCRIPT), str(config_path)],
        cwd=str(AI_TOOLKIT_PATH),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    tail_buffer: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()
        tail_buffer.append(line)
        if len(tail_buffer) > 400:
            tail_buffer.pop(0)
    return_code = proc.wait()
    if return_code != 0:
        raise RuntimeError(
            f"ai-toolkit exited with code {return_code}. "
            f"Tail:\n{''.join(tail_buffer[-50:])}"
        )
    return "".join(tail_buffer)[-4096:]


def find_safetensors(output_dir: Path, output_name: str) -> Path:
    candidates = sorted(output_dir.rglob("*.safetensors"))
    if not candidates:
        raise FileNotFoundError(
            f"No .safetensors found in {output_dir}. "
            f"Tree: {list(output_dir.rglob('*'))[:50]}"
        )
    preferred = [p for p in candidates if output_name in p.name]
    return (preferred or candidates)[-1]


def upload_via_presigned_url(local_path: Path, upload_url: str, content_type: str) -> int:
    size_bytes = local_path.stat().st_size
    log("upload.starting", size_bytes=size_bytes, url=_redact(upload_url))
    with local_path.open("rb") as fh:
        request = urllib.request.Request(
            upload_url,
            data=fh.read(),
            method="PUT",
            headers={"Content-Type": content_type, "Content-Length": str(size_bytes)},
        )
        with urllib.request.urlopen(request, timeout=600) as response:
            if response.status >= 300:
                raise RuntimeError(
                    f"Pre-signed PUT failed with status {response.status}"
                )
    log("upload.completed", size_bytes=size_bytes)
    return size_bytes


def post_callback(payload: dict[str, Any]) -> None:
    callback_url = os.environ.get("RESULT_CALLBACK_URL")
    if not callback_url:
        return
    headers = {"Content-Type": "application/json"}
    token = os.environ.get("RESULT_CALLBACK_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        callback_url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers=headers,
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            log("callback.sent", status=response.status)
    except Exception as exc:  # noqa: BLE001
        log("callback.failed", error=str(exc))


def _redact(url: str) -> str:
    if "?" in url:
        return url.split("?", 1)[0] + "?<signed>"
    return url


def main() -> None:
    started_at = time.time()
    workdir = Path(tempfile.mkdtemp(prefix="ai-toolkit-pod-"))
    dataset_dir = workdir / "dataset"
    output_dir = workdir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        env = require_env()
        if not AI_TOOLKIT_RUN_SCRIPT.exists():
            raise RuntimeError(
                f"ai-toolkit run.py not found at {AI_TOOLKIT_RUN_SCRIPT}. "
                "Bootstrap should have cloned ostris/ai-toolkit into "
                f"{AI_TOOLKIT_PATH}."
            )

        image_count = download_dataset(env["DATASET_URL"], dataset_dir)
        if image_count == 0:
            raise ValueError("Dataset zip contains no supported images")

        config = build_ai_toolkit_config(
            base_model=env["BASE_MODEL"],
            dataset_dir=dataset_dir,
            default_caption=env["DEFAULT_CAPTION"],
            learning_rate=float(env["LEARNING_RATE"]),
            lora_rank=int(env["LORA_RANK"]),
            output_dir=output_dir,
            output_name=env["OUTPUT_NAME"],
            training_steps=int(env["TRAINING_STEPS"]),
            trigger_word=env["TRIGGER_WORD"],
        )
        config_path = workdir / "config.yaml"
        config_path.write_text(yaml.safe_dump(config, sort_keys=False))

        model_section = config["config"]["process"][0]["model"]
        log(
            "training.config_resolved",
            base_model=env["BASE_MODEL"],
            model_section=model_section,
        )

        run_ai_toolkit(config_path)

        lora_path = find_safetensors(output_dir, env["OUTPUT_NAME"])
        size_bytes = upload_via_presigned_url(
            lora_path,
            env["LORA_UPLOAD_URL"],
            os.environ.get("LORA_UPLOAD_CONTENT_TYPE", "application/octet-stream"),
        )

        elapsed = time.time() - started_at
        log("pod_runner.success", training_seconds=elapsed, lora_size_bytes=size_bytes)
        post_callback(
            {
                "status": "ok",
                "sizeBytes": size_bytes,
                "trainingSeconds": elapsed,
                "outputName": env["OUTPUT_NAME"],
            }
        )
    except Exception as exc:  # noqa: BLE001
        log("pod_runner.failed", error=str(exc), error_type=type(exc).__name__)
        post_callback({"status": "error", "error": str(exc)})
        raise
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    main()
