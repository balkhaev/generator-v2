const XAI_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-4-fast";

const STUDIO_SYSTEM_PROMPT = `You are an expert prompt engineer for diffusion image and video generation
models (Flux, SDXL, Wan, Veo, Kling and similar). Your job is to take a short or
rough user brief and rewrite it into a single high-quality generation prompt.

Hard rules for every rewrite:
- PRESERVE the user's intent: subject, action, scene, style cues. Never change
  who/what is in the shot. Never invent new characters or replace the subject.
- Add concrete, evocative detail where the brief is vague: composition, camera,
  lens (e.g. 35mm f/1.8, 85mm f/1.4), lighting, color palette, materials and
  textures, mood, atmosphere, time of day, environment.
- Photoreal, illustration, anime, 3D — match whatever style the user implies. Do
  NOT force photoreal if the user clearly wants a different aesthetic.
- For video briefs, also describe motion: camera movement (dolly, pan, handheld,
  static), subject motion, pacing.
- Output ONLY the rewritten prompt — single English paragraph, comma-separated
  clauses, no markdown, no code fences, no quotes around the result, no
  numbering, no preamble, no labels like "Prompt:".
- Keep the rewrite focused: 40–110 words. Don't pad with empty adjectives.
- SFW only. Refuse and return the original prompt unchanged if the brief is
  sexual, illegal, or otherwise disallowed.`;

const ENHANCE_USER_PROMPT_TEMPLATE = (basePrompt: string) =>
	`Rewrite the following generation brief into a single production-ready prompt
following the system rules. Preserve the user's subject and intent exactly —
only enrich detail, composition, lighting, camera and atmosphere.

Return only the rewritten prompt text. No quotes, no JSON, no markdown.

User brief:
"""
${basePrompt}
"""`;

interface ChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string | null;
		};
	}>;
}

export interface StudioGrokClient {
	enhancePrompt(prompt: string): Promise<string>;
}

interface StudioGrokClientOptions {
	apiKey: string;
	fetchImpl?: typeof fetch;
	model?: string;
}

const surroundingQuotePattern = /^["'`]+|["'`]+$/g;
const codeFencePattern = /^[\s`]*```(?:[a-z]+)?|```[\s`]*$/giu;

function cleanPromptOutput(value: string) {
	return value
		.replace(codeFencePattern, "")
		.trim()
		.replace(surroundingQuotePattern, "")
		.trim();
}

export function createStudioGrokClient(
	options: StudioGrokClientOptions
): StudioGrokClient {
	const apiKey = options.apiKey.trim();
	if (!apiKey) {
		throw new Error("XAI_API_KEY is required to create studio Grok client");
	}

	const fetchImpl = options.fetchImpl ?? fetch;
	const model = options.model ?? DEFAULT_MODEL;

	return {
		async enhancePrompt(prompt) {
			const trimmed = prompt.trim();
			if (!trimmed) {
				throw new Error("Cannot enhance an empty prompt");
			}

			const response = await fetchImpl(`${XAI_BASE_URL}/chat/completions`, {
				body: JSON.stringify({
					messages: [
						{ role: "system", content: STUDIO_SYSTEM_PROMPT },
						{ role: "user", content: ENHANCE_USER_PROMPT_TEMPLATE(trimmed) },
					],
					model,
					temperature: 0.85,
				}),
				headers: {
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
				},
				method: "POST",
			});

			if (!response.ok) {
				const detail = await response.text().catch(() => "");
				throw new Error(
					`Grok request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`
				);
			}

			const payload = (await response.json()) as ChatCompletionResponse;
			const content = payload.choices?.[0]?.message?.content?.trim();
			if (!content) {
				throw new Error("Grok response did not contain any content");
			}

			return cleanPromptOutput(content);
		},
	};
}
