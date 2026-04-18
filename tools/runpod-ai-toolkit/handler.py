"""
RunPod serverless handler для тренировки персон-LoRA через ai-toolkit (Ostris).

Контракт сообщений с admin-worker (см.
apps/admin/src/providers/runpod-ai-toolkit-lora-training.ts):

INPUT (event["input"]):
    {
        "dataset_url":    str  HTTPS-ссылка на zip с парами image/text-captions.
                                Ожидаемая структура:
                                    000.jpg, 000.txt
                                    001.jpg, 001.txt
                                    ...
        "trigger_word":   str  Уникальный токен (rare token, см. DreamBooth).
                                Уже подставлен в каждый .txt.
        "default_caption": str Caption для случаев, когда .txt отсутствует.
        "training_steps": int  Сколько шагов крутить (~1000-1500 норм).
        "learning_rate":  float
        "lora_rank":      int  Обычно 16 (для лица — комфортно).
        "base_model":     str  z-image | flux-dev | flux-schnell |
                                flux2-dev | sdxl | qwen-image
        "output_name":    str  Имя для итогового .safetensors (без расширения).
    }

OUTPUT (return value):
    {
        "lora_url":         str  HTTPS-ссылка на финальный .safetensors в S3.
        "lora_size_bytes":  int
        "training_seconds": float
        "debug": {
            "ai_toolkit_version": str,
            "config":             dict (yaml as dict),
            "stdout_tail":        str,
        }
    }

S3 креды берём из env (см. README). RunPod передаёт их через "Environment
Variables" в настройках endpoint-а.
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

import boto3
import runpod
import yaml

AI_TOOLKIT_PATH = Path(os.getenv("AI_TOOLKIT_PATH", "/opt/ai-toolkit"))
AI_TOOLKIT_RUN_SCRIPT = AI_TOOLKIT_PATH / "run.py"

# Mapping наших base_model на ai-toolkit `model.name_or_path`.
# Расширять по мере подключения новых моделей в нашем workflow registry.
BASE_MODEL_MAP: dict[str, dict[str, Any]] = {
    "z-image": {
        "model": {
            "name_or_path": "Tongyi-MAI/Z-Image-Turbo",
            "arch": "z_image",
            "quantize": True,
        },
        "sample": {
            "sampler": "flowmatch",
            "sample_steps": 8,
            "guidance_scale": 1.0,
        },
        "train": {"noise_scheduler": "flowmatch"},
    },
    "flux-dev": {
        "model": {
            "name_or_path": "black-forest-labs/FLUX.1-dev",
            "arch": "flux",
            "quantize": True,
        },
        "sample": {
            "sampler": "flowmatch",
            "sample_steps": 28,
            "guidance_scale": 3.5,
        },
        "train": {"noise_scheduler": "flowmatch"},
    },
    "flux-schnell": {
        "model": {
            "name_or_path": "black-forest-labs/FLUX.1-schnell",
            "arch": "flux",
            "assistant_lora_path": None,
            "quantize": True,
        },
        "sample": {
            "sampler": "flowmatch",
            "sample_steps": 4,
            "guidance_scale": 1.0,
        },
        "train": {"noise_scheduler": "flowmatch"},
    },
    "flux2-dev": {
        "model": {
            "name_or_path": "black-forest-labs/FLUX.2-dev",
            "arch": "flux2",
            "quantize": True,
        },
        "sample": {
            "sampler": "flowmatch",
            "sample_steps": 28,
            "guidance_scale": 3.5,
        },
        "train": {"noise_scheduler": "flowmatch"},
    },
    "sdxl": {
        "model": {
            "name_or_path": "stabilityai/stable-diffusion-xl-base-1.0",
            "arch": "sdxl",
            "quantize": False,
        },
        "sample": {
            "sampler": "ddpm",
            "sample_steps": 25,
            "guidance_scale": 7.0,
        },
        "train": {"noise_scheduler": "ddpm"},
    },
    "qwen-image": {
        "model": {
            "name_or_path": "Qwen/Qwen-Image",
            "arch": "qwen_image",
            "quantize": True,
        },
        "sample": {
            "sampler": "flowmatch",
            "sample_steps": 28,
            "guidance_scale": 3.5,
        },
        "train": {"noise_scheduler": "flowmatch"},
    },
}


def download_dataset(dataset_url: str, target_dir: Path) -> int:
    """Скачивает и распаковывает zip с датасетом. Возвращает кол-во картинок."""
    target_dir.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(dataset_url, timeout=300) as response:
        zip_bytes = response.read()
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        zf.extractall(target_dir)
    image_count = sum(
        1
        for entry in target_dir.iterdir()
        if entry.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    )
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

    config: dict[str, Any] = {
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
                        "name_or_path": profile["model"]["name_or_path"],
                        "arch": profile["model"]["arch"],
                        "is_flux": profile["model"]["arch"] in {"flux", "flux2"},
                        "quantize": profile["model"].get("quantize", False),
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
        "meta": {
            "name": output_name,
            "version": "1.0",
        },
    }
    return config


def run_ai_toolkit(config_path: Path) -> str:
    """Запускает ai-toolkit и возвращает последние 4 КБ stdout/stderr."""
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
        if len(tail_buffer) > 200:
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


def upload_to_s3(local_path: Path, output_name: str) -> tuple[str, int]:
    """Загружает .safetensors в S3 и возвращает (public_url, size_bytes)."""
    bucket = os.environ["S3_BUCKET"]
    region = os.environ.get("S3_REGION", "us-east-1")
    endpoint_url = os.environ.get("S3_ENDPOINT")
    public_base_url = os.environ.get("S3_PUBLIC_BASE_URL", "").rstrip("/")
    prefix = os.environ.get("S3_PREFIX", "loras/runpod-ai-toolkit").strip("/")
    key = f"{prefix}/{output_name}-{int(time.time())}.safetensors"
    size_bytes = local_path.stat().st_size

    client_kwargs: dict[str, Any] = {"region_name": region}
    if endpoint_url:
        client_kwargs["endpoint_url"] = endpoint_url
    s3 = boto3.client("s3", **client_kwargs)
    s3.upload_file(
        str(local_path),
        bucket,
        key,
        ExtraArgs={"ContentType": "application/octet-stream"},
    )

    if public_base_url:
        url = f"{public_base_url}/{key}"
    elif endpoint_url:
        url = f"{endpoint_url.rstrip('/')}/{bucket}/{key}"
    else:
        url = f"https://{bucket}.s3.{region}.amazonaws.com/{key}"

    return url, size_bytes


def handler(event: dict[str, Any]) -> dict[str, Any]:
    started_at = time.time()
    payload = event.get("input") or {}
    required_keys = (
        "dataset_url",
        "trigger_word",
        "default_caption",
        "training_steps",
        "learning_rate",
        "lora_rank",
        "base_model",
        "output_name",
    )
    missing = [k for k in required_keys if payload.get(k) in (None, "")]
    if missing:
        raise ValueError(f"Missing required input fields: {missing}")

    workdir = Path(tempfile.mkdtemp(prefix="ai-toolkit-"))
    dataset_dir = workdir / "dataset"
    output_dir = workdir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        image_count = download_dataset(payload["dataset_url"], dataset_dir)
        if image_count == 0:
            raise ValueError("Dataset zip contains no supported images")

        config = build_ai_toolkit_config(
            base_model=payload["base_model"],
            dataset_dir=dataset_dir,
            default_caption=payload["default_caption"],
            learning_rate=float(payload["learning_rate"]),
            lora_rank=int(payload["lora_rank"]),
            output_dir=output_dir,
            output_name=payload["output_name"],
            training_steps=int(payload["training_steps"]),
            trigger_word=payload["trigger_word"],
        )
        config_path = workdir / "config.yaml"
        config_path.write_text(yaml.safe_dump(config, sort_keys=False))

        stdout_tail = run_ai_toolkit(config_path)

        lora_path = find_safetensors(output_dir, payload["output_name"])
        lora_url, lora_size_bytes = upload_to_s3(lora_path, payload["output_name"])

        return {
            "lora_url": lora_url,
            "lora_size_bytes": lora_size_bytes,
            "training_seconds": time.time() - started_at,
            "debug": {
                "ai_toolkit_path": str(AI_TOOLKIT_PATH),
                "config_summary": {
                    "base_model": payload["base_model"],
                    "lora_rank": payload["lora_rank"],
                    "training_steps": payload["training_steps"],
                    "image_count": image_count,
                },
                "stdout_tail": stdout_tail,
            },
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
