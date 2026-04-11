import os

CACHE_DIR = "/persistent-storage/.cache/huggingface"
os.environ.setdefault("HF_HOME", CACHE_DIR)
os.environ.setdefault("HUGGINGFACE_HUB_CACHE", f"{CACHE_DIR}/hub")
os.environ.setdefault("TRANSFORMERS_CACHE", CACHE_DIR)
os.environ.setdefault("XDG_CACHE_HOME", "/persistent-storage/.cache")
os.environ.setdefault("TMPDIR", "/persistent-storage/tmp")
os.makedirs("/persistent-storage/tmp", exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)

import base64
import io
from typing import Optional, Union

import torch

pipe = None
pipe_model_id = None


def storage_info():
    import shutil
    usage = shutil.disk_usage("/persistent-storage")
    cache_size = 0
    hub_dir = os.path.join(CACHE_DIR, "hub")
    if os.path.exists(hub_dir):
        for dirpath, _dirnames, filenames in os.walk(hub_dir):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                if os.path.isfile(fp):
                    cache_size += os.path.getsize(fp)
    return {
        "total_gb": round(usage.total / (1024**3), 2),
        "used_gb": round(usage.used / (1024**3), 2),
        "free_gb": round(usage.free / (1024**3), 2),
        "cache_gb": round(cache_size / (1024**3), 2),
    }


def clear_cache(keep_repos: str = ""):
    """Clear hub cache. keep_repos is a comma-separated list of repo slugs to preserve."""
    import shutil
    keep = {r.strip() for r in keep_repos.split(",") if r.strip()} if keep_repos else set()
    hub_dir = os.path.join(CACHE_DIR, "hub")
    if os.path.exists(hub_dir):
        for entry in os.listdir(hub_dir):
            if entry.startswith("models--"):
                if keep and any(k in entry for k in keep):
                    continue
                shutil.rmtree(os.path.join(hub_dir, entry), ignore_errors=True)
            elif entry == ".locks":
                shutil.rmtree(os.path.join(hub_dir, entry), ignore_errors=True)
    tmp_dir = "/persistent-storage/tmp"
    if os.path.exists(tmp_dir):
        shutil.rmtree(tmp_dir, ignore_errors=True)
        os.makedirs(tmp_dir, exist_ok=True)
    global pipe, pipe_model_id
    pipe = None
    pipe_model_id = None
    return storage_info()


def prepare_for_training():
    """Free space for LoRA training by removing distilled checkpoint, keeping base Z-Image components."""
    return clear_cache(keep_repos="Tongyi-MAI--Z-Image")


def _is_single_file_ref(model_id: str) -> bool:
    return ":" in model_id and "/" in model_id.split(":", 1)[0]


def _load_single_file(model_id: str, hf_token: str | None):
    from huggingface_hub import hf_hub_download
    from diffusers import ZImagePipeline, AutoencoderKL
    from transformers import AutoTokenizer, AutoModel

    base_repo = "Tongyi-MAI/Z-Image"

    repo_id, filename = model_id.split(":", 1)
    local_path = hf_hub_download(
        repo_id, filename, token=hf_token, cache_dir=CACHE_DIR,
    )

    text_encoder = AutoModel.from_pretrained(
        base_repo, subfolder="text_encoder",
        torch_dtype=torch.bfloat16, token=hf_token,
    )
    tokenizer = AutoTokenizer.from_pretrained(
        base_repo, subfolder="tokenizer", token=hf_token,
    )
    vae = AutoencoderKL.from_pretrained(
        base_repo, subfolder="vae",
        torch_dtype=torch.bfloat16, token=hf_token,
    )

    return ZImagePipeline.from_single_file(
        local_path,
        text_encoder=text_encoder,
        tokenizer=tokenizer,
        vae=vae,
        torch_dtype=torch.bfloat16,
        token=hf_token,
    )


def _load_pretrained(model_id: str, hf_token: str | None):
    if "z-image" in model_id.lower() or "zimage" in model_id.lower():
        from diffusers import ZImagePipeline
        return ZImagePipeline.from_pretrained(
            model_id, torch_dtype=torch.bfloat16, token=hf_token,
        )

    if "flux" in model_id.lower():
        from diffusers import FluxPipeline
        return FluxPipeline.from_pretrained(
            model_id, torch_dtype=torch.bfloat16, token=hf_token,
        )

    from diffusers import DiffusionPipeline
    return DiffusionPipeline.from_pretrained(
        model_id, torch_dtype=torch.bfloat16, token=hf_token,
    )


def _get_pipeline(model_id: str):
    global pipe, pipe_model_id

    if pipe is not None and pipe_model_id == model_id:
        return pipe

    hf_token = os.getenv("HF_TOKEN")

    if _is_single_file_ref(model_id):
        pipe = _load_single_file(model_id, hf_token)
    else:
        pipe = _load_pretrained(model_id, hf_token)

    pipe.to("cuda")
    pipe_model_id = model_id
    return pipe


def _image_to_data_url(image, fmt: str = "jpeg") -> str:
    buf = io.BytesIO()
    save_fmt = "JPEG" if fmt in ("jpeg", "jpg") else fmt.upper()
    image.save(buf, format=save_fmt)
    b64 = base64.b64encode(buf.getvalue()).decode()
    mime = "image/jpeg" if fmt in ("jpeg", "jpg") else f"image/{fmt}"
    return f"data:{mime};base64,{b64}"


def _decode_image(image_data: str):
    """Decode a base64 data-url or raw base64 string into a PIL Image."""
    from PIL import Image
    if image_data.startswith("data:"):
        _, payload = image_data.split(",", 1)
    else:
        payload = image_data
    return Image.open(io.BytesIO(base64.b64decode(payload))).convert("RGB")


def generate(
    prompt: str,
    model_id: str = "Tongyi-MAI/Z-Image-Turbo",
    width: int = 1024,
    height: int = 1024,
    num_inference_steps: int = 9,
    guidance_scale: Union[int, float] = 0.0,
    num_images: int = 1,
    seed: Optional[int] = None,
    lora_url: Optional[str] = None,
    lora_scale: Union[int, float] = 1.0,
    trigger_word: Optional[str] = None,
    output_format: str = "jpeg",
):
    guidance_scale = float(guidance_scale)
    lora_scale = float(lora_scale)
    pipeline = _get_pipeline(model_id)

    if lora_url:
        pipeline.load_lora_weights(lora_url)
        pipeline.fuse_lora(lora_scale=lora_scale)

    generator = None
    if seed is not None:
        generator = torch.Generator("cuda").manual_seed(seed)

    try:
        result = pipeline(
            prompt=prompt,
            width=width,
            height=height,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            num_images_per_prompt=num_images,
            generator=generator,
        )
    finally:
        if lora_url:
            pipeline.unfuse_lora()
            pipeline.unload_lora_weights()

    images = []
    for img in result.images:
        url = _image_to_data_url(img, output_format)
        images.append({"url": url})

    return {"images": images}


def img2img(
    prompt: str,
    image: str,
    model_id: str = "Tongyi-MAI/Z-Image-Turbo",
    strength: Union[int, float] = 0.55,
    num_inference_steps: int = 20,
    guidance_scale: Union[int, float] = 5.0,
    num_images: int = 1,
    seed: Optional[int] = None,
    output_format: str = "jpeg",
):
    """Image-to-image: re-render `image` guided by `prompt` while preserving identity."""
    from diffusers import AutoPipelineForImage2Image

    strength = float(strength)
    guidance_scale = float(guidance_scale)

    t2i_pipeline = _get_pipeline(model_id)
    i2i_pipeline = AutoPipelineForImage2Image.from_pipe(t2i_pipeline)

    source = _decode_image(image)

    generator = None
    if seed is not None:
        generator = torch.Generator("cuda").manual_seed(seed)

    result = i2i_pipeline(
        prompt=prompt,
        image=source,
        strength=strength,
        num_inference_steps=num_inference_steps,
        guidance_scale=guidance_scale,
        num_images_per_prompt=num_images,
        generator=generator,
    )

    images = []
    for img in result.images:
        url = _image_to_data_url(img, output_format)
        images.append({"url": url})

    return {"images": images}
