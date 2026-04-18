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

const ENHANCE_WITH_IMAGE_SYSTEM_PROMPT = `You are an expert prompt engineer for diffusion image and video generation
models. You receive (a) a short scenario brief written by a user and (b) a
reference image that will be the input/source frame for the generation. Your
job is to rewrite the brief into a single concrete, image-grounded production
prompt that describes exactly what should happen on top of THAT specific image.

Hard rules for every rewrite:
- READ the image carefully. Identify the main subject(s): apparent gender,
  approximate age bracket, hair (length/color/texture), notable clothing,
  environment, lighting, time of day, color palette and overall mood.
- PRESERVE the user's intent: the action, scene, style cues from the brief
  must remain. Never replace the subject, never invent additional people,
  never change who/what is in the shot.
- GROUND the rewrite in the image: use the visual details you observed
  ("young woman with long dark hair", "white linen shirt", "warm sunset
  light through the window") instead of generic placeholders.
- For motion/video briefs, also describe how the subject and camera move
  (handheld, dolly-in, static, slow pan), pacing, and what physically reacts
  in the scene (hair, fabric, dust, water).
- Output ONLY the rewritten prompt — single English paragraph, comma-separated
  clauses, no markdown, no code fences, no quotes around the result, no
  numbering, no preamble, no labels like "Prompt:".
- Keep it focused: 50–140 words. Don't pad with empty adjectives.
- SFW only. Refuse and return the original brief unchanged if the image or
  brief is sexual, illegal, or otherwise disallowed.`;

const ENHANCE_WITH_IMAGE_USER_TEMPLATE = (basePrompt: string) =>
	`Look at the attached image. It is the source/input frame for a generation.
Rewrite the following brief into a single production-ready prompt grounded in
what you actually see in the image (subject details, environment, lighting,
mood). Preserve the user's intent and action exactly — only enrich it with
concrete, image-specific detail.

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
	enhancePromptWithImage(prompt: string, imageUrl: string): Promise<string>;
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

	async function callChatCompletions(
		messages: {
			content: string | Record<string, unknown>[];
			role: "system" | "user";
		}[]
	): Promise<string> {
		const response = await fetchImpl(`${XAI_BASE_URL}/chat/completions`, {
			body: JSON.stringify({
				messages,
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
	}

	return {
		enhancePrompt(prompt) {
			const trimmed = prompt.trim();
			if (!trimmed) {
				return Promise.reject(new Error("Cannot enhance an empty prompt"));
			}
			return callChatCompletions([
				{ role: "system", content: STUDIO_SYSTEM_PROMPT },
				{ role: "user", content: ENHANCE_USER_PROMPT_TEMPLATE(trimmed) },
			]);
		},

		enhancePromptWithImage(prompt, imageUrl) {
			const trimmed = prompt.trim();
			if (!trimmed) {
				return Promise.reject(new Error("Cannot enhance an empty prompt"));
			}
			const trimmedUrl = imageUrl.trim();
			if (!trimmedUrl) {
				return Promise.reject(
					new Error("Image URL is required for vision-based enhance")
				);
			}
			return callChatCompletions([
				{ role: "system", content: ENHANCE_WITH_IMAGE_SYSTEM_PROMPT },
				{
					role: "user",
					content: [
						{
							type: "image_url",
							image_url: { url: trimmedUrl, detail: "high" },
						},
						{
							type: "text",
							text: ENHANCE_WITH_IMAGE_USER_TEMPLATE(trimmed),
						},
					],
				},
			]);
		},
	};
}
