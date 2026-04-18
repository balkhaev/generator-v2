const XAI_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-4-fast";
const IPV4_HOST_PATTERN = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;

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

const ENHANCE_WITH_IMAGE_SYSTEM_PROMPT = `You rewrite short diffusion-model
briefs (image/video) into one polished English prompt.

You receive: (1) a user brief and (2) a reference frame that will be the
generation input.

Rules:
- Observe the frame: main subject, outfit, setting, lighting, palette, mood.
  Use neutral, factual wording (avoid demographic guesses).
- Keep the user's requested action, motion, and style; do not change creative
  intent. Do not add people or objects beyond the brief and what is visible.
- For motion, mention camera and subject motion when the brief implies video.
- Output a single paragraph, comma-separated phrases, 50–130 words, plain
  text only: no markdown, no code fences, no numbered lists, no leading label.`;

const ENHANCE_WITH_IMAGE_USER_TEMPLATE = (basePrompt: string) =>
	`Using the attached reference frame, rewrite this brief into one detailed
generation prompt that ties the action to what is visible in the frame.

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

function isBlockedImageFetchHostname(hostname: string): boolean {
	const h = hostname.toLowerCase();
	if (h === "localhost" || h.endsWith(".localhost")) {
		return true;
	}
	if (h === "0.0.0.0" || h === "[::1]" || h === "::1") {
		return true;
	}
	const ipv4 = IPV4_HOST_PATTERN.exec(h);
	if (ipv4) {
		const a = Number(ipv4[1]);
		const b = Number(ipv4[2]);
		if (a === 0 || a === 127 || a === 10) {
			return true;
		}
		if (a === 169 && b === 254) {
			return true;
		}
		if (a === 192 && b === 168) {
			return true;
		}
		if (a === 172 && b >= 16 && b <= 31) {
			return true;
		}
	}
	return false;
}

/** Only fetch remote images over HTTPS to avoid SSRF; skip private hosts. */
function canFetchImageAsInlineData(url: string): boolean {
	try {
		const u = new URL(url);
		if (u.protocol !== "https:") {
			return false;
		}
		return !isBlockedImageFetchHostname(u.hostname);
	} catch {
		return false;
	}
}

const MAX_VISION_IMAGE_BYTES = 6 * 1024 * 1024;
const VISION_IMAGE_FETCH_MS = 15_000;

async function tryInlineImageForVision(
	imageUrl: string,
	fetchImpl: typeof fetch
): Promise<string> {
	const trimmed = imageUrl.trim();
	if (trimmed.startsWith("data:image/")) {
		return trimmed;
	}
	if (!canFetchImageAsInlineData(trimmed)) {
		return trimmed;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), VISION_IMAGE_FETCH_MS);
	try {
		const response = await fetchImpl(trimmed, {
			headers: { accept: "image/*,*/*" },
			method: "GET",
			redirect: "follow",
			signal: controller.signal,
		});
		if (!response.ok) {
			return trimmed;
		}
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength === 0 || buffer.byteLength > MAX_VISION_IMAGE_BYTES) {
			return trimmed;
		}
		const rawType = response.headers.get("content-type")?.split(";")[0]?.trim();
		const mime = rawType?.startsWith("image/") ? rawType : "image/jpeg";
		const base64 = Buffer.from(buffer).toString("base64");
		return `data:${mime};base64,${base64}`;
	} catch {
		return trimmed;
	} finally {
		clearTimeout(timeoutId);
	}
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

		async enhancePromptWithImage(prompt, imageUrl) {
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
			const imageForModel = await tryInlineImageForVision(
				trimmedUrl,
				fetchImpl
			);
			return callChatCompletions([
				{ role: "system", content: ENHANCE_WITH_IMAGE_SYSTEM_PROMPT },
				{
					role: "user",
					content: [
						{
							type: "image_url",
							image_url: { detail: "low", url: imageForModel },
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
