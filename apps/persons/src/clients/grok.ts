const XAI_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-4-fast";

const GROK_SYSTEM_PROMPT = `You are an expert prompt engineer for photorealistic portrait generation.
Your single goal is to craft prompts that generate stunningly beautiful, captivating,
and visually interesting young women — the kind that look like real high-end models,
influencers, or fashion-magazine subjects. Always assume the subject is a woman unless
the user explicitly demands otherwise.

Hard rules for every prompt you produce:
- Subject is a beautiful young woman, naturally photogenic, attractive face, expressive eyes.
- Always anchor the image in photorealism: full-body or portrait photography, real camera,
  natural skin texture (pores, subtle imperfections), natural lighting or studio lighting,
  shallow depth of field when appropriate.
- Add specific, varied, evocative details: ethnicity / hair color / hair style / eye color,
  outfit, setting, mood, lighting, camera (e.g. 85mm portrait lens, Hasselblad, film grain).
- Keep prompts in English, single comma-separated paragraph, no markdown, no numbering,
  no quotes, no preamble, no explanations.
- Never produce sexual, nude, underage, violent, or disallowed content. Tasteful and SFW.
- Length 40–90 words.`;

const VARIANT_USER_PROMPT_TEMPLATE = (basePrompt: string, count: number) =>
	`Original brief from the user:
"""
${basePrompt}
"""

Produce exactly ${count} distinctly different prompt variants for the SAME woman concept,
each emphasising different attributes (ethnicity, hair color/style, outfit, setting, mood,
lighting, lens). Keep the core idea recognisable across variants but make each visually
unique so they read as 4 different reference photos of equally attractive women.

Return strictly a JSON array of ${count} strings — no prose, no keys, no markdown fences.`;

const ENHANCE_USER_PROMPT_TEMPLATE = (basePrompt: string) =>
	`Rewrite and enrich the following user brief into a single high-quality
photorealistic prompt following the system rules. Return only the prompt text,
no JSON, no quotes, no markdown.

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

export interface GrokExpandPromptOptions {
	count: number;
	prompt: string;
}

export interface GrokClient {
	enhancePrompt(prompt: string): Promise<string>;
	expandPrompt(options: GrokExpandPromptOptions): Promise<string[]>;
}

interface GrokClientOptions {
	apiKey: string;
	fetchImpl?: typeof fetch;
	model?: string;
}

const trailingCommentaryPattern = /^[\s`]*```(?:json)?|```[\s`]*$/giu;
const arrayJsonPattern = /\[[\s\S]*\]/u;

function stripCodeFences(value: string) {
	return value.replace(trailingCommentaryPattern, "").trim();
}

function parsePromptArray(rawContent: string, count: number): string[] {
	const cleaned = stripCodeFences(rawContent);
	const arrayMatch = cleaned.match(arrayJsonPattern);
	const candidate = arrayMatch ? arrayMatch[0] : cleaned;

	let parsed: unknown;
	try {
		parsed = JSON.parse(candidate);
	} catch (error) {
		throw new Error(
			`Grok returned non-JSON variants payload: ${error instanceof Error ? error.message : String(error)}`
		);
	}

	if (!Array.isArray(parsed)) {
		throw new Error("Grok variants payload is not an array");
	}

	const prompts = parsed
		.map((entry) => (typeof entry === "string" ? entry.trim() : ""))
		.filter((entry) => entry.length > 0);

	if (prompts.length === 0) {
		throw new Error("Grok returned empty variants payload");
	}

	return prompts.slice(0, count);
}

export function createGrokClient(options: GrokClientOptions): GrokClient {
	const apiKey = options.apiKey.trim();
	if (!apiKey) {
		throw new Error("XAI_API_KEY is required to create Grok client");
	}

	const fetchImpl = options.fetchImpl ?? fetch;
	const model = options.model ?? DEFAULT_MODEL;

	async function chat(userPrompt: string): Promise<string> {
		const response = await fetchImpl(`${XAI_BASE_URL}/chat/completions`, {
			body: JSON.stringify({
				messages: [
					{ role: "system", content: GROK_SYSTEM_PROMPT },
					{ role: "user", content: userPrompt },
				],
				model,
				temperature: 0.95,
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

		return content;
	}

	return {
		async enhancePrompt(prompt) {
			const trimmed = prompt.trim();
			if (!trimmed) {
				throw new Error("Cannot enhance an empty prompt");
			}
			const content = await chat(ENHANCE_USER_PROMPT_TEMPLATE(trimmed));
			return stripCodeFences(content).replace(/^"|"$/g, "");
		},
		async expandPrompt({ prompt, count }) {
			const trimmed = prompt.trim();
			if (!trimmed) {
				throw new Error("Cannot expand an empty prompt");
			}
			const safeCount = Math.max(1, Math.min(8, Math.floor(count)));
			const content = await chat(
				VARIANT_USER_PROMPT_TEMPLATE(trimmed, safeCount)
			);
			return parsePromptArray(content, safeCount);
		},
	};
}
