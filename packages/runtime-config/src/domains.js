/**
 * Schema definitions for every runtime-config domain.
 *
 * A "domain" is a logical grouping of settings that one feature consumes —
 * `prompt-enhance` for the studio enhance flow, `training` for LoRA training
 * provider selection, etc. Each domain owns:
 *
 *   - A Zod schema for its non-secret settings (validated on read and write).
 *   - A list of credential keys it depends on (provider + keyName pairs).
 *   - A list of providers it can switch between (used by the admin UI to
 *     disable selection of a provider whose credentials are missing).
 *
 * Adding a new domain = adding an entry here. Nothing else needs to change in
 * the runtime-config layer; admin-api endpoints and the studio client are
 * generic over `DomainName`.
 */
import { z } from "zod";
export const promptEnhanceProviderSchema = z.enum(["grok", "openrouter"]);
export const trainingProviderSchema = z.enum(["fal", "runpod"]);
export const promptEnhanceSettingsSchema = z.object({
	provider: promptEnhanceProviderSchema.default("grok"),
	openrouterModel: z.string().min(1).default("openai/gpt-4o-mini"),
});
export const trainingSettingsSchema = z.object({
	provider: trainingProviderSchema.default("fal"),
});
/**
 * Studio-side prompt enhancement (used by `/api/enhance-prompt` in studio-api).
 * Independent from the persons domain so each surface can pick its own
 * provider — e.g. studio on Qwen 3.5 for fast rewrites, persons on Grok for
 * stricter policy adherence on persona prompts.
 */
export const promptEnhanceStudioDomain = {
	name: "prompt-enhance-studio",
	schema: promptEnhanceSettingsSchema,
	providerCredentials: {
		grok: [{ provider: "xai", keyName: "apiKey" }],
		openrouter: [{ provider: "openrouter", keyName: "apiKey" }],
	},
};
/**
 * Persons-side prompt enhancement (used by `/api/enhance-prompt` and the
 * variant/refine flows in persons-api). Separate from the studio domain so
 * persona prompts can stay on a different model — they have a stricter
 * i2i-source contract that benefits from being tuned independently.
 */
export const promptEnhancePersonsDomain = {
	name: "prompt-enhance-persons",
	schema: promptEnhanceSettingsSchema,
	providerCredentials: {
		grok: [{ provider: "xai", keyName: "apiKey" }],
		openrouter: [{ provider: "openrouter", keyName: "apiKey" }],
	},
};
export const trainingDomain = {
	name: "training",
	schema: trainingSettingsSchema,
	providerCredentials: {
		fal: [{ provider: "fal", keyName: "apiKey" }],
		runpod: [{ provider: "runpod", keyName: "apiKey" }],
	},
};
export const domains = {
	"prompt-enhance-studio": promptEnhanceStudioDomain,
	"prompt-enhance-persons": promptEnhancePersonsDomain,
	training: trainingDomain,
};
export function isDomainName(value) {
	return value in domains;
}
