import { BASE_MODEL_IDS } from "./base-models";
export const LORA_BASE_MODELS = BASE_MODEL_IDS;
export const LORA_VARIANTS = ["high", "low", "both"];
/** Base models whose LoRAs come as separate high/low files. */
export const DUAL_EXPERT_BASE_MODELS = ["wan-2-2"];
export function isDualExpertBaseModel(baseModel) {
	return DUAL_EXPERT_BASE_MODELS.includes(baseModel);
}
