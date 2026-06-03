/** Имя safetensors на volume/в графе ComfyUI для Civitai LoRA (LoraLoaderModelOnly). */
export function civitaiLoraSafetensorsFilename(
	modelId: number,
	versionId: number
): string {
	return `civitai-${modelId}-${versionId}.safetensors`;
}

/** LTX 2.3 «Synth Pussy» — дефолтная Civitai LoRA для сценария LTX Synth Pussy. */
export const LTX_SYNTH_PUSSY_LORA_MODEL_ID = 2_509_189;
export const LTX_SYNTH_PUSSY_LORA_VERSION_ID = 2_820_451;
export const LTX_SYNTH_PUSSY_LORA_FILENAME = civitaiLoraSafetensorsFilename(
	LTX_SYNTH_PUSSY_LORA_MODEL_ID,
	LTX_SYNTH_PUSSY_LORA_VERSION_ID
);
