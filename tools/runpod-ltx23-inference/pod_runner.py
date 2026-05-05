"""
Headless ComfyUI runner for LTX 2.3 + Synth LoRA on a disposable RunPod Pod.

The generator passes every runtime setting through env vars and gives this
script pre-signed S3 PUT URLs. The final MP4 is uploaded directly to S3; the
generator then polls S3 and deletes the Pod.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path, PurePosixPath
from typing import Any

import requests
from PIL import Image

WORKSPACE_DIR = Path(os.getenv("WORKSPACE_DIR", "/workspace"))
COMFYUI_DIR = Path(os.getenv("COMFYUI_DIR", str(WORKSPACE_DIR / "ComfyUI")))
COMFYUI_HOST = os.getenv("COMFYUI_HOST", "127.0.0.1")
COMFYUI_PORT = int(os.getenv("COMFYUI_PORT", "8188"))
COMFYUI_BASE_URL = f"http://{COMFYUI_HOST}:{COMFYUI_PORT}"
OUTPUT_EXTENSIONS = {".mp4", ".webm", ".mkv", ".mov"}
DEFAULT_MANUAL_SIGMAS = "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0"


def log(event: str, **fields: Any) -> None:
    payload = {"event": event, **fields}
    sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
    sys.stdout.flush()


def env_required(name: str) -> str:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        raise RuntimeError(f"{name} is required")
    return value.strip()


def env_optional(name: str, default: str = "") -> str:
    value = os.getenv(name)
    return default if value is None else value.strip()


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return int(value)


def env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return float(value)


def safe_relative_path(name: str) -> Path:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise RuntimeError(f"Unsafe model filename: {name}")
    return Path(*path.parts)


def download_file(url: str, target: Path, *, token: str | None = None) -> None:
    if not url:
        return
    if target.exists() and target.stat().st_size > 0:
        log("download.cached", path=str(target), size_bytes=target.stat().st_size)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(f"{target.suffix}.tmp")
    headers: dict[str, str] = {"user-agent": "generator-runpod-ltx23/1.0"}
    if token:
        headers["authorization"] = f"Bearer {token}"

    log("download.start", target=str(target), url=url)
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=3600) as response:
        with tmp.open("wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
    tmp.replace(target)
    log("download.done", path=str(target), size_bytes=target.stat().st_size)


def download_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"user-agent": "generator-runpod-ltx23/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read().decode("utf-8")


def build_manual_sigmas(steps: int) -> str:
    if steps == 8:
        return DEFAULT_MANUAL_SIGMAS
    values = [1.0 - (index / max(steps, 1)) for index in range(steps)]
    values.append(0.0)
    return ", ".join(f"{max(value, 0.0):.6f}".rstrip("0").rstrip(".") for value in values)


def ensure_placeholder_image(width: int, height: int) -> None:
    input_dir = COMFYUI_DIR / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    path = input_dir / "example.png"
    if path.exists():
        return
    Image.new("RGB", (width, height), color=(0, 0, 0)).save(path)
    log("placeholder-image.created", path=str(path), width=width, height=height)


def set_widget(node: dict[str, Any], index: int, value: Any) -> None:
    widgets = node.setdefault("widgets_values", [])
    while len(widgets) <= index:
        widgets.append(None)
    widgets[index] = value


def patch_workflow_graph(workflow: dict[str, Any], settings: dict[str, Any]) -> None:
    noise_offset = 0
    save_index = 0
    for node in workflow.get("nodes", []):
        node_type = node.get("type")
        title = node.get("title") or ""
        widgets = node.setdefault("widgets_values", [])

        if node_type == "CheckpointLoaderSimple":
            set_widget(node, 0, settings["checkpoint_name"])
        elif node_type == "LTXVAudioVAELoader":
            set_widget(node, 0, settings["checkpoint_name"])
        elif node_type == "LTXAVTextEncoderLoader":
            set_widget(node, 0, settings["text_encoder_name"])
            set_widget(node, 1, settings["checkpoint_name"])
        elif node_type == "CLIPTextEncode" and "Positive Prompt" in title:
            set_widget(node, 0, settings["prompt"])
        elif node_type == "CLIPTextEncode" and "Negative Prompt" in title:
            set_widget(node, 0, settings["negative_prompt"])
        elif node_type == "RandomNoise" and settings.get("seed") is not None:
            set_widget(node, 0, int(settings["seed"]) + noise_offset)
            set_widget(node, 1, "fixed")
            noise_offset += 1
        elif node_type == "PrimitiveFloat" and title == "fps":
            set_widget(node, 0, settings["fps"])
        elif node_type == "PrimitiveInt" and title == "number of frames":
            set_widget(node, 0, settings["num_frames"])
            set_widget(node, 1, "fixed")
        elif node_type == "EmptyLTXVLatentVideo":
            set_widget(node, 0, settings["width"])
            set_widget(node, 1, settings["height"])
            set_widget(node, 2, settings["num_frames"])
        elif node_type == "LTXVEmptyLatentAudio":
            set_widget(node, 0, settings["num_frames"])
            set_widget(node, 1, settings["fps"])
            set_widget(node, 2, 1)
        elif node_type == "CFGGuider":
            set_widget(node, 0, settings["cfg_scale"])
        elif node_type == "GuiderParameters" and widgets and widgets[0] == "VIDEO":
            set_widget(node, 1, settings["cfg_scale"])
        elif node_type == "LTXVScheduler":
            set_widget(node, 0, settings["steps"])
        elif node_type == "ManualSigmas":
            set_widget(node, 0, build_manual_sigmas(settings["steps"]))
        elif node_type == "LoraLoaderModelOnly":
            lora_name = str(widgets[0]) if widgets else ""
            if "distilled-lora" in lora_name:
                set_widget(node, 0, settings["distilled_lora_name"])
                set_widget(node, 1, settings["distilled_lora_scale"])
        elif node_type == "CreateVideo":
            set_widget(node, 0, settings["fps"])
        elif node_type == "SaveVideo":
            set_widget(node, 0, f"runpod_ltx23_{settings['job_id']}_{save_index}")
            set_widget(node, 1, "auto")
            set_widget(node, 2, "auto")
            save_index += 1
        elif node_type == "PrimitiveBoolean" and title == "bypass_i2v":
            set_widget(node, 0, True)
        elif node_type == "LoadImage":
            set_widget(node, 0, "example.png")
            set_widget(node, 1, "image")


def link_lookup(workflow: dict[str, Any]) -> dict[int, tuple[int, int]]:
    lookup: dict[int, tuple[int, int]] = {}
    for link in workflow.get("links", []):
        if isinstance(link, list) and len(link) >= 3:
            lookup[int(link[0])] = (int(link[1]), int(link[2]))
        elif isinstance(link, dict):
            link_id = link.get("id")
            origin_id = link.get("origin_id")
            origin_slot = link.get("origin_slot")
            if link_id is not None and origin_id is not None and origin_slot is not None:
                lookup[int(link_id)] = (int(origin_id), int(origin_slot))
    return lookup


def input_order_for(class_type: str, object_info: dict[str, Any]) -> list[str]:
    info = object_info.get(class_type, {})
    inputs = info.get("input", {})
    ordered: list[str] = []
    for section in ("required", "optional"):
        values = inputs.get(section, {})
        if isinstance(values, dict):
            ordered.extend(values.keys())
    return ordered


def convert_workflow_to_api_prompt(
    workflow: dict[str, Any], object_info: dict[str, Any]
) -> dict[str, Any]:
    links = link_lookup(workflow)
    prompt: dict[str, Any] = {}

    for node in workflow.get("nodes", []):
        if node.get("mode") == 4:
            continue
        node_id = str(node["id"])
        class_type = str(node["type"])
        inputs: dict[str, Any] = {}
        linked_inputs: set[str] = set()
        linked_widget_inputs: set[str] = set()

        for input_def in node.get("inputs", []):
            link_id = input_def.get("link")
            input_name = input_def.get("name")
            if input_name and link_id is not None and int(link_id) in links:
                origin_id, origin_slot = links[int(link_id)]
                inputs[str(input_name)] = [str(origin_id), origin_slot]
                linked_inputs.add(str(input_name))
                if input_def.get("widget"):
                    linked_widget_inputs.add(str(input_name))

        widget_index = 0
        widgets = node.get("widgets_values", [])
        for input_name in input_order_for(class_type, object_info):
            if input_name in linked_inputs or input_name in inputs:
                if input_name in linked_widget_inputs and widget_index < len(widgets):
                    widget_index += 1
                continue
            if widget_index >= len(widgets):
                continue
            inputs[input_name] = widgets[widget_index]
            widget_index += 1

        prompt[node_id] = {"class_type": class_type, "inputs": inputs}

    return prompt


def replace_model_consumers(prompt: dict[str, Any], source_id: str, target_id: str) -> None:
    for node_id, node in prompt.items():
        if node_id == target_id:
            continue
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue
        for key, value in list(inputs.items()):
            if isinstance(value, list) and value == [source_id, 0]:
                inputs[key] = [target_id, 0]


def insert_synth_lora(prompt: dict[str, Any], lora_name: str, lora_scale: float) -> None:
    if not lora_name or lora_scale <= 0:
        return
    next_id = max((int(node_id) for node_id in prompt), default=900000) + 1
    for source_id in ("4922", "4968"):
        if source_id not in prompt:
            continue
        new_id = str(next_id)
        next_id += 1
        replace_model_consumers(prompt, source_id, new_id)
        prompt[new_id] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": [source_id, 0],
                "lora_name": lora_name,
                "strength_model": lora_scale,
            },
        }
        log("lora.inserted", source_id=source_id, node_id=new_id, lora_name=lora_name)


def http_json(path: str, *, body: dict[str, Any] | None = None, timeout: int = 30) -> dict[str, Any]:
    data = None
    headers = {}
    method = "GET"
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["content-type"] = "application/json"
        method = "POST"
    request = urllib.request.Request(
        f"{COMFYUI_BASE_URL}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ComfyUI HTTP {error.code} for {path}: {detail}") from error


def stream_process_output(proc: subprocess.Popen[str]) -> None:
    assert proc.stdout is not None
    for line in proc.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()


def start_comfyui() -> subprocess.Popen[str]:
    cmd = [
        sys.executable,
        "main.py",
        "--listen",
        COMFYUI_HOST,
        "--port",
        str(COMFYUI_PORT),
        "--disable-auto-launch",
    ]
    proc = subprocess.Popen(
        cmd,
        cwd=str(COMFYUI_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    threading.Thread(target=stream_process_output, args=(proc,), daemon=True).start()
    return proc


def wait_for_comfyui(proc: subprocess.Popen[str], timeout_seconds: int = 600) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"ComfyUI exited during startup with code {proc.returncode}")
        try:
            http_json("/system_stats", timeout=5)
            log("comfyui.ready")
            return
        except Exception:
            time.sleep(2)
    raise RuntimeError("Timed out waiting for ComfyUI startup")


def output_path_from_ref(file_ref: dict[str, Any]) -> Path | None:
    filename = file_ref.get("filename")
    if not isinstance(filename, str) or not filename:
        return None
    subfolder = file_ref.get("subfolder")
    type_name = file_ref.get("type")
    base_dir = COMFYUI_DIR / ("output" if type_name in (None, "output") else str(type_name))
    path = base_dir / str(subfolder or "") / filename
    return path if path.exists() and path.suffix.lower() in OUTPUT_EXTENSIONS else None


def newest_output_file() -> Path | None:
    output_dir = COMFYUI_DIR / "output"
    if not output_dir.exists():
        return None
    candidates = [
        path
        for path in output_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in OUTPUT_EXTENSIONS
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda path: path.stat().st_mtime)


def extract_output_file(history_item: dict[str, Any]) -> Path | None:
    outputs = history_item.get("outputs", {})
    if not isinstance(outputs, dict):
        return None
    for output in outputs.values():
        if not isinstance(output, dict):
            continue
        for key in ("videos", "gifs", "images"):
            values = output.get(key)
            if not isinstance(values, list):
                continue
            for file_ref in values:
                if isinstance(file_ref, dict):
                    path = output_path_from_ref(file_ref)
                    if path:
                        return path
    return newest_output_file()


def wait_for_prompt_output(prompt_id: str, proc: subprocess.Popen[str], timeout_seconds: int) -> Path:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"ComfyUI exited before finishing prompt with code {proc.returncode}")
        history = http_json(f"/history/{prompt_id}", timeout=30)
        item = history.get(prompt_id)
        if isinstance(item, dict):
            status = item.get("status", {})
            if isinstance(status, dict) and status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI prompt failed: {json.dumps(status)}")
            output_file = extract_output_file(item)
            if output_file:
                log("prompt.output-ready", path=str(output_file), size_bytes=output_file.stat().st_size)
                return output_file
        time.sleep(5)
    raise RuntimeError(f"Timed out waiting for prompt {prompt_id}")


def upload_output(path: Path, upload_url: str, content_type: str) -> None:
    log("upload.start", path=str(path), size_bytes=path.stat().st_size)
    with path.open("rb") as handle:
        response = requests.put(
            upload_url,
            data=handle,
            headers={"content-type": content_type},
            timeout=1800,
        )
    if response.status_code >= 400:
        raise RuntimeError(f"S3 upload failed ({response.status_code}): {response.text[:500]}")
    log("upload.done", status_code=response.status_code)


def load_settings() -> dict[str, Any]:
    width = env_int("WIDTH", 896)
    height = env_int("HEIGHT", 1280)
    num_frames = env_int("NUM_FRAMES", 241)
    if width % 32 != 0 or height % 32 != 0:
        raise RuntimeError("WIDTH and HEIGHT must be divisible by 32")
    if (num_frames - 1) % 8 != 0:
        raise RuntimeError("NUM_FRAMES must be 8n + 1")
    return {
        "cfg_scale": env_float("CFG_SCALE", 1.0),
        "checkpoint_name": env_required("CHECKPOINT_NAME"),
        "checkpoint_url": env_required("CHECKPOINT_URL"),
        "distilled_lora_name": env_required("DISTILLED_LORA_NAME"),
        "distilled_lora_scale": env_float("DISTILLED_LORA_SCALE", 0.6),
        "distilled_lora_url": env_required("DISTILLED_LORA_URL"),
        "fps": env_int("FPS", 24),
        "height": height,
        "job_id": env_optional("RUNPOD_JOB_ID", str(uuid.uuid4())),
        "lora_name": env_required("LORA_NAME"),
        "lora_scale": env_float("LORA_SCALE", 1.0),
        "lora_url": env_required("LORA_URL"),
        "negative_prompt": env_optional("NEGATIVE_PROMPT"),
        "num_frames": num_frames,
        "output_content_type": env_optional("OUTPUT_CONTENT_TYPE", "video/mp4"),
        "output_upload_url": env_required("OUTPUT_UPLOAD_URL"),
        "prompt": env_required("PROMPT"),
        "seed": env_optional("SEED") or None,
        "steps": env_int("STEPS", 8),
        "text_encoder_name": env_required("TEXT_ENCODER_NAME"),
        "text_encoder_url": env_required("TEXT_ENCODER_URL"),
        "timeout_seconds": env_int("RUNPOD_POD_TIMEOUT_SECONDS", 3600),
        "width": width,
        "workflow_url": env_required("WORKFLOW_URL"),
    }


def prepare_models(settings: dict[str, Any]) -> None:
    hf_token = env_optional("HF_TOKEN") or env_optional("HUGGINGFACE_TOKEN") or None
    civitai_token = env_optional("CIVITAI_API_KEY") or env_optional("CIVITAI_API_TOKEN") or None
    download_file(
        settings["checkpoint_url"],
        COMFYUI_DIR / "models" / "checkpoints" / safe_relative_path(settings["checkpoint_name"]),
        token=hf_token,
    )
    download_file(
        settings["text_encoder_url"],
        COMFYUI_DIR / "models" / "text_encoders" / safe_relative_path(settings["text_encoder_name"]),
        token=hf_token,
    )
    download_file(
        settings["distilled_lora_url"],
        COMFYUI_DIR / "models" / "loras" / safe_relative_path(settings["distilled_lora_name"]),
        token=hf_token,
    )
    lora_token = civitai_token if "civitai" in settings["lora_url"].lower() else None
    download_file(
        settings["lora_url"],
        COMFYUI_DIR / "models" / "loras" / safe_relative_path(settings["lora_name"]),
        token=lora_token,
    )


def run() -> None:
    settings = load_settings()
    log(
        "settings.loaded",
        cfg_scale=settings["cfg_scale"],
        fps=settings["fps"],
        height=settings["height"],
        num_frames=settings["num_frames"],
        prompt_length=len(settings["prompt"]),
        steps=settings["steps"],
        width=settings["width"],
    )

    ensure_placeholder_image(settings["width"], settings["height"])
    prepare_models(settings)

    workflow = json.loads(download_text(settings["workflow_url"]))
    patch_workflow_graph(workflow, settings)

    proc = start_comfyui()
    try:
        wait_for_comfyui(proc)
        object_info = http_json("/object_info", timeout=60)
        prompt = convert_workflow_to_api_prompt(workflow, object_info)
        insert_synth_lora(prompt, settings["lora_name"], settings["lora_scale"])

        payload = {"client_id": settings["job_id"], "prompt": prompt}
        response = http_json("/prompt", body=payload, timeout=120)
        prompt_id = response.get("prompt_id")
        if not isinstance(prompt_id, str) or not prompt_id:
            raise RuntimeError(f"ComfyUI /prompt did not return prompt_id: {response}")
        log("prompt.submitted", prompt_id=prompt_id)

        output_path = wait_for_prompt_output(prompt_id, proc, settings["timeout_seconds"])
        upload_output(
            output_path,
            settings["output_upload_url"],
            settings["output_content_type"],
        )
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    run()
