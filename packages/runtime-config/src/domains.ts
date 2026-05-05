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
export type PromptEnhanceProvider = z.infer<typeof promptEnhanceProviderSchema>;

export const trainingProviderSchema = z.enum(["fal", "runpod"]);
export type TrainingProvider = z.infer<typeof trainingProviderSchema>;

export const promptEnhanceSettingsSchema = z.object({
	provider: promptEnhanceProviderSchema.default("grok"),
	openrouterModel: z.string().min(1).default("openai/gpt-4o-mini"),
});
export type PromptEnhanceSettings = z.infer<typeof promptEnhanceSettingsSchema>;

export const trainingSettingsSchema = z.object({
	provider: trainingProviderSchema.default("fal"),
});
export type TrainingSettings = z.infer<typeof trainingSettingsSchema>;

export const studioWorkflowSettingsSchema = z.object({
	inactiveWorkflowKeys: z.array(z.string().min(1)).default([]),
});
export type StudioWorkflowSettings = z.infer<
	typeof studioWorkflowSettingsSchema
>;

export interface DomainSpec<T> {
	name: string;
	/** Maps a provider name to the credential keys it requires. */
	providerCredentials: Record<string, readonly CredentialRef[]>;
	schema: z.ZodType<T>;
}

export interface CredentialRef {
	keyName: string;
	provider: string;
}

/**
 * Studio-side prompt enhancement (used by `/api/enhance-prompt` in studio-api).
 * Independent from the persons domain so each surface can pick its own
 * provider — e.g. studio on Qwen 3.5 for fast rewrites, persons on Grok for
 * stricter policy adherence on persona prompts.
 */
export const promptEnhanceStudioDomain: DomainSpec<PromptEnhanceSettings> = {
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
export const promptEnhancePersonsDomain: DomainSpec<PromptEnhanceSettings> = {
	name: "prompt-enhance-persons",
	schema: promptEnhanceSettingsSchema,
	providerCredentials: {
		grok: [{ provider: "xai", keyName: "apiKey" }],
		openrouter: [{ provider: "openrouter", keyName: "apiKey" }],
	},
};

export const trainingDomain: DomainSpec<TrainingSettings> = {
	name: "training",
	schema: trainingSettingsSchema,
	providerCredentials: {
		fal: [{ provider: "fal", keyName: "apiKey" }],
		runpod: [{ provider: "runpod", keyName: "apiKey" }],
	},
};

export const studioWorkflowsDomain: DomainSpec<StudioWorkflowSettings> = {
	name: "studio-workflows",
	schema: studioWorkflowSettingsSchema,
	providerCredentials: {},
};

export const domains = {
	"prompt-enhance-studio": promptEnhanceStudioDomain,
	"prompt-enhance-persons": promptEnhancePersonsDomain,
	"studio-workflows": studioWorkflowsDomain,
	training: trainingDomain,
} as const;

export type DomainName = keyof typeof domains;

export function isDomainName(value: string): value is DomainName {
	return value in domains;
}

/**
 * Full payload returned to clients via `/api/internal/runtime-config/:domain`.
 * Settings are typed per-domain (the API responds with `unknown` and the
 * client narrows via the domain spec); credentials are a flat
 * provider→keyName→value map so clients don't need to know the domain shape
 * to look up a key.
 */
export interface RuntimeConfigSnapshot {
	credentials: Record<string, Record<string, string>>;
	domain: DomainName;
	settings: unknown;
}

/**
 * Public-safe view of credential availability — never exposes the actual
 * secret value. Used by the admin UI to render "configured/not configured"
 * badges and by domain validators to refuse "switch provider X" requests
 * when X has no credentials yet.
 */
export interface CredentialAvailability {
	configured: boolean;
	keyName: string;
	provider: string;
	updatedAt: string | null;
}
