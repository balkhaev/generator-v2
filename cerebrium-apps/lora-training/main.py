import os

CACHE_DIR = "/persistent-storage/.cache/huggingface"
os.environ.setdefault("HF_HOME", CACHE_DIR)
os.environ.setdefault("HUGGINGFACE_HUB_CACHE", f"{CACHE_DIR}/hub")
os.environ.setdefault("TRANSFORMERS_CACHE", CACHE_DIR)
os.environ.setdefault("XDG_CACHE_HOME", "/persistent-storage/.cache")
os.environ.setdefault("TMPDIR", "/persistent-storage/tmp")
os.makedirs("/persistent-storage/tmp", exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)

import shutil
import subprocess
import tempfile
import zipfile
from typing import Optional, Union


def _download_file(url: str, dest: str):
    import urllib.request
    urllib.request.urlretrieve(url, dest)


def _upload_weights(weights_path: str, trigger_word: str) -> str:
    import uuid
    import urllib.request
    import json

    filename = f"lora-{trigger_word}-{uuid.uuid4().hex[:8]}.safetensors"

    public_base = os.getenv("CEREBRIUM_PUBLIC_STORAGE_URL")
    if public_base:
        storage_dir = os.getenv(
            "CEREBRIUM_STORAGE_DIR", "/persistent-storage/lora-weights"
        )
        os.makedirs(storage_dir, exist_ok=True)
        dest = os.path.join(storage_dir, filename)
        shutil.copy2(weights_path, dest)
        return f"{public_base.rstrip('/')}/lora-weights/{filename}"

    fal_key = os.getenv("FAL_KEY")
    if not fal_key:
        raise RuntimeError(
            "FAL_KEY or CEREBRIUM_PUBLIC_STORAGE_URL required for weights upload"
        )

    init_req = urllib.request.Request(
        "https://rest.alpha.fal.ai/storage/upload/initiate",
        data=json.dumps({
            "file_name": filename,
            "content_type": "application/octet-stream",
        }).encode(),
        headers={
            "Authorization": f"Key {fal_key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(init_req) as resp:
        init_data = json.loads(resp.read())

    file_url = init_data["file_url"]
    upload_url = init_data["upload_url"]

    with open(weights_path, "rb") as f:
        weights_data = f.read()

    upload_req = urllib.request.Request(
        upload_url,
        data=weights_data,
        method="PUT",
        headers={"Content-Type": "application/octet-stream"},
    )
    urllib.request.urlopen(upload_req)

    return file_url


def _find_safetensors(output_dir: str) -> str:
    for root, _dirs, files in os.walk(output_dir):
        for f in sorted(files):
            if f.endswith(".safetensors"):
                return os.path.join(root, f)
    raise FileNotFoundError(f"No .safetensors file found in {output_dir}")


_diffusers_upgraded = False

def _ensure_diffusers_dev():
    global _diffusers_upgraded
    if _diffusers_upgraded:
        return
    import diffusers
    if "dev" not in diffusers.__version__:
        print(f"Upgrading diffusers from {diffusers.__version__} to dev...")
        subprocess.run(
            ["pip", "install", "--no-deps",
             "git+https://github.com/huggingface/diffusers.git"],
            check=True,
        )
    _diffusers_upgraded = True


def _ensure_training_script() -> str:
    script_dir = "/persistent-storage/diffusers-scripts"
    script_path = os.path.join(
        script_dir, "examples", "dreambooth", "train_dreambooth_lora_z_image.py"
    )

    _ensure_diffusers_dev()

    if os.path.exists(script_path):
        return script_path

    if os.path.exists(script_dir):
        shutil.rmtree(script_dir, ignore_errors=True)

    subprocess.run(
        ["git", "clone", "--depth=1", "--filter=blob:none", "--sparse",
         "https://github.com/huggingface/diffusers.git", script_dir],
        check=True,
    )
    subprocess.run(
        ["git", "sparse-checkout", "set", "examples/dreambooth"],
        cwd=script_dir, check=True,
    )

    req_file = os.path.join(
        script_dir, "examples", "dreambooth", "requirements_z_image.txt"
    )
    if os.path.exists(req_file):
        subprocess.run(
            ["pip", "install", "-r", req_file],
            check=True,
        )

    if not os.path.exists(script_path):
        raise FileNotFoundError(
            f"train_dreambooth_lora_z_image.py not found at {script_path}. "
            "This script may not exist in the diffusers repository yet."
        )

    return script_path


import json as _json
import threading

RESULTS_DIR = "/persistent-storage/training-results"
os.makedirs(RESULTS_DIR, exist_ok=True)


def _save_result(job_id: str, status: str, data: dict):
    result_path = os.path.join(RESULTS_DIR, f"{job_id}.json")
    with open(result_path, "w") as f:
        _json.dump({"status": status, **data}, f)


def get_training_status(job_id: str):
    result_path = os.path.join(RESULTS_DIR, f"{job_id}.json")
    if not os.path.exists(result_path):
        return {"status": "running"}
    with open(result_path) as f:
        return _json.load(f)


def _training_thread(job_id: str, cmd: list, work_dir: str, output_dir: str,
                     trigger_word: str, steps: int):
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        print(result.stdout[-3000:] if len(result.stdout) > 3000 else result.stdout)

        if result.returncode != 0:
            print(result.stderr[-3000:] if len(result.stderr) > 3000 else result.stderr)
            error_msg = f"Training failed (exit {result.returncode}): {result.stderr[-2000:]}"
            _save_result(job_id, "failed", {"error": error_msg})
            return

        weights_path = _find_safetensors(output_dir)
        lora_url = _upload_weights(weights_path, trigger_word)
        shutil.rmtree(work_dir, ignore_errors=True)
        _save_result(job_id, "completed", {
            "lora_url": lora_url, "steps": steps, "trigger_word": trigger_word,
        })
    except Exception as exc:
        _save_result(job_id, "failed", {"error": str(exc)})


def train(
    dataset_url: str,
    job_id: str = "",
    steps: Union[int, float] = 2000,
    trigger_word: str = "subject",
    learning_rate: Union[int, float] = 1e-4,
    default_caption: str = "a photo of subject, portrait",
    resolution: Union[int, float] = 1024,
    train_batch_size: Union[int, float] = 1,
    gradient_accumulation_steps: Union[int, float] = 4,
    model_id: Optional[str] = None,
    lora_rank: Union[int, float] = 16,
    guidance_scale: Union[int, float] = 0.0,
):
    steps = int(steps)
    learning_rate = float(learning_rate)
    resolution = int(resolution)
    train_batch_size = int(train_batch_size)
    gradient_accumulation_steps = int(gradient_accumulation_steps)
    lora_rank = int(lora_rank)
    guidance_scale = float(guidance_scale)

    if not job_id:
        import uuid
        job_id = uuid.uuid4().hex

    model_id = model_id or os.getenv(
        "BASE_MODEL_ID", "Tongyi-MAI/Z-Image-Turbo"
    )

    os.makedirs("/persistent-storage/tmp", exist_ok=True)
    work_dir = tempfile.mkdtemp(prefix="lora-train-")
    dataset_dir = os.path.join(work_dir, "dataset")
    output_dir = os.path.join(work_dir, "output")
    os.makedirs(dataset_dir)
    os.makedirs(output_dir)

    zip_path = os.path.join(work_dir, "dataset.zip")
    _download_file(dataset_url, zip_path)

    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(dataset_dir)

    for f in os.listdir(dataset_dir):
        if f.endswith(".txt"):
            os.remove(os.path.join(dataset_dir, f))

    script_path = _ensure_training_script()

    cmd = [
        "accelerate", "launch", script_path,
        f"--pretrained_model_name_or_path={model_id}",
        f"--instance_data_dir={dataset_dir}",
        f"--output_dir={output_dir}",
        f"--instance_prompt=a photo of {trigger_word}",
        f"--resolution={resolution}",
        f"--train_batch_size={train_batch_size}",
        f"--gradient_accumulation_steps={gradient_accumulation_steps}",
        f"--learning_rate={learning_rate}",
        f"--max_train_steps={steps}",
        f"--rank={lora_rank}",
        f"--guidance_scale={guidance_scale}",
        "--mixed_precision=bf16",
        "--gradient_checkpointing",
        "--cache_latents",
        "--use_8bit_adam",
        "--optimizer=adamW",
        "--lr_scheduler=constant",
        "--lr_warmup_steps=100",
    ]

    hf_token = os.getenv("HF_TOKEN")
    if hf_token:
        os.environ["HF_TOKEN"] = hf_token

    print(f"Launching training in background thread: {' '.join(cmd)}")

    thread = threading.Thread(
        target=_training_thread,
        args=(job_id, cmd, work_dir, output_dir, trigger_word, steps),
    )
    thread.start()

    return {"job_id": job_id, "status": "started", "steps": steps}
