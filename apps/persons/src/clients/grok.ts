const XAI_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-4-fast";

const GROK_SYSTEM_PROMPT = `You are an expert prompt engineer for photorealistic portrait generation.
Your goal is to craft prompts that generate stunningly beautiful, captivating young women
who carry a distinct personal VIBE — the kind of photo that immediately tells you who she
is and what world she lives in. Think editorial portraits, candid lifestyle shots, off-duty
model snapshots, character-driven cinematic frames. Never generic. Always assume the subject
is a woman unless the user explicitly demands otherwise.

Hard rules for every prompt:
- Subject: a beautiful young woman with a clearly defined VIBE / archetype expressed through
  styling, setting, posture, expression, environment, props and lighting — not just her face.
- Composition is portrait or upper-body or environmental portrait, but NEVER a flat, dead-on
  passport-style shot looking straight into the camera. Prefer three-quarter angles, profile
  hints, candid mid-action moments, glancing aside, looking down, over the shoulder, slightly
  off-center framing, natural body language. The pose itself should convey mood.
- Photoreal anchoring: real camera, named lens (e.g. 50mm f/1.4, 85mm f/1.8, 35mm), realistic
  skin texture (pores, subtle imperfections, fine hair), believable lighting (golden hour,
  overcast soft light, neon spill, window light, harsh midday, candlelight, etc.).
- Specific evocative details: ethnicity, hair color & style, eye color, wardrobe with material
  and texture, accessories, exact location with sensory cues, time of day, atmosphere, color
  palette, and the emotional undertone she radiates.
- Output only the prompt: English, single comma-separated paragraph, no markdown, no numbering,
  no quotes, no preamble, no explanations, no labels like "Variant 1:".
- SFW only. Never sexual, nude, underage, violent, or disallowed content.
- Length 60–110 words so the vibe comes through richly.`;

const VARIANT_USER_PROMPT_TEMPLATE = (basePrompt: string, count: number) =>
	`Original brief from the user:
"""
${basePrompt}
"""

Produce exactly ${count} distinctly different portrait prompt variants. Each variant must
deliver a clearly DIFFERENT VIBE / archetype / world — like ${count} separate characters
photographed for ${count} different magazine stories. Examples of vibes (do not copy these,
invent fresh ones that fit the brief): ethereal indie artist in a sunlit studio, edgy
downtown skater at dusk, cozy bookshop romantic on a rainy afternoon, sun-bleached coastal
traveler, neon-drenched nightlife muse, equestrian countryside daydreamer, minimalist
Scandinavian morning, vintage 70s film vibe, cyber-tinted tech editorial, etc.

For each variant vary deliberately: archetype, ethnicity & features, hair, wardrobe with
texture, setting, time of day, lighting, color palette, lens, mood, body language and what
she's doing in the frame. NONE of the variants may be a plain head-on portrait staring into
the lens — every shot must feel candid, cinematic or editorial, with the pose and environment
telling the story.

Keep them all clearly portrait-oriented (face & upper body must read clearly) and equally
attractive and photoreal.

Return strictly a JSON array of ${count} strings — no prose, no keys, no markdown fences.`;

const ENHANCE_USER_PROMPT_TEMPLATE = (basePrompt: string) =>
	`Rewrite and enrich the following user brief into a single high-quality
photorealistic portrait prompt following the system rules. The result must give
the woman a distinct VIBE / archetype that comes through her wardrobe, setting,
lighting, body language and what she's doing in the frame — NOT a flat dead-on
passport shot. Use a candid, editorial or cinematic composition (three-quarter,
glancing aside, mid-action, off-center, etc.) while keeping it clearly portrait
oriented (face & upper body visible).

Return only the prompt text — no JSON, no quotes, no markdown.

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
