# RunPod Fooocus SDXL inference endpoint

This is the runtime counterpart for the `runpod-fooocus-sdxl` workflow.
The app talks to a queue-based RunPod Serverless endpoint through
`apps/generator/src/providers/runpod.ts`; the endpoint implementation is
intentionally custom because the legacy `fast-fooocus-sdxl` surface exposed
embeddings, not native SDXL LoRA loading.

## Generator environment

Set these on generator-api and generator-worker:

```bash
RUNPOD_API_KEY=rpa_xxx
RUNPOD_FOOOCUS_ENDPOINT_ID=your-runpod-serverless-endpoint
```

`RUNPOD_API_BASE_URL` defaults to `https://api.runpod.ai/v2`.

## Input contract

RunPod wraps the request as `{ "input": ... }`. The worker should read this
shape:

```json
{
  "api_name": "txt2img",
  "prompt": "studio portrait of ohwx_person",
  "negative_prompt": "blur, watermark",
  "base_model_name": "juggernautXL_version6Rundiffusion.safetensors",
  "advanced_params": {
    "overwrite_step": 30
  },
  "aspect_ratios_selection": "896*1152",
  "image_size": "portrait_4_3",
  "image_number": 1,
  "num_inference_steps": 30,
  "guidance_scale": 4,
  "num_images": 1,
  "output_format": "jpeg",
  "enable_refiner": true,
  "refiner_model_name": "sd_xl_refiner_1.0_0.9vae.safetensors",
  "refiner_switch": 0.5,
  "enable_safety_checker": false,
  "require_base64": true,
  "seed": 42,
  "loras": [
    {
      "model_name": "person.safetensors",
      "url": "https://assets.example.com/loras/person.safetensors",
      "weight": 0.9
    }
  ],
  "loras_custom_urls": "https://assets.example.com/loras/person.safetensors,0.9"
}
```

`base_model_name` defaults in the app to
`juggernautXL_version6Rundiffusion.safetensors`, matching Fooocus-API-LORA's
documented v6 default. `loras` may be empty. `loras_custom_urls` mirrors the
Replicate/Cog contract from Fooocus-API-LORA: `url,weight;url2,weight`.

For each LoRA, the worker should:

1. Download `url` into `repositories/Fooocus/models/loras`.
2. Save it as `model_name` when provided; otherwise use a stable generated
   `.safetensors` name.
3. Call Fooocus with `api_name: "txt2img"` and native fields:
   `aspect_ratios_selection`, `image_number`, `image_seed`, and
   `loras: [{ "model_name": "...", "weight": ... }]`. Use
   `advanced_params.overwrite_step` for the requested step count.
4. Keep `enable_safety_checker` disabled. If `enable_refiner` is false, pass
   `refiner_model_name: "None"`.

## Output contract

The generator artifact extractor accepts URLs anywhere in the output. Prefer one
of these simple shapes:

```json
{
  "images": [{ "url": "https://assets.example.com/out.png" }]
}
```

or:

```json
{
  "image_urls": ["https://assets.example.com/out.png"]
}
```

RunPod `/run` and `/status` are polled by generator-worker; terminal statuses
are normalized into the existing execution lifecycle.
If the worker returns Fooocus-style `{ "base64": "..." }` items, the RunPod
provider adds `data:image/png;base64,...` URLs before artifact extraction.
