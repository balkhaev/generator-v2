const XAI_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-4-fast";

const GROK_SYSTEM_PROMPT = `You are an expert prompt engineer for photorealistic portrait generation.
Your goal is to craft prompts that generate stunningly beautiful young women whose photos
work on TWO levels at once:
  (1) a self-selling editorial / lifestyle shot with a clear personal VIBE — the kind of
      image that stops the scroll and tells you who she is and what world she lives in;
  (2) a clean, usable reference for downstream LoRA dataset training — meaning her face
      and figure must be unambiguously readable.

Hard rules for every prompt:
- Subject: a beautiful young woman with a clearly defined VIBE / archetype expressed through
  styling, setting, light, expression and what she's doing — never generic.
- FACE READABILITY (non-negotiable): the face is the focal point and must be clearly visible,
  well-lit, sharp, in focus. Both eyes visible. Head turned no more than a soft three-quarter
  (≈ up to 30° off-axis); slight tilts and natural micro-asymmetry encouraged. Gaze can be
  toward lens, just past the lens, or softly into the scene — never fully averted, never full
  profile, never back of head, never face hidden by hair, hands, hat brim, sunglasses, mask,
  shadow or motion blur.
- FIGURE READABILITY (non-negotiable): an open, natural pose where her silhouette and body
  proportions read clearly. No crouching, no folded-up self-hugs, no extreme foreshortening,
  no big props blocking the torso, no aggressive Dutch tilts. Composition is upper-body
  portrait, half-body, or relaxed environmental portrait with the body openly framed.
- COMPOSITION: editorial / candid / cinematic, NOT a flat passport stare. Slight off-center
  framing, soft three-quarter angle, gentle mid-action moment (adjusting hair, sipping coffee,
  walking past a window), or relaxed seated pose. The pose conveys mood while keeping face
  and figure fully presentable.
- Photoreal anchoring: real camera language, named lens (e.g. 50mm f/1.4, 85mm f/1.8, 35mm),
  realistic skin texture (pores, fine hair, subtle imperfections), believable lighting
  (golden hour, soft window light, overcast diffuse, gentle studio key + fill, neon spill,
  candlelight, etc.). Soft natural shadows on the face — never harsh raccoon shadows that
  hide the eyes.
- Specific evocative details: ethnicity, hair color & style, eye color, wardrobe with
  material and texture, accessories, exact location with sensory cues, time of day,
  atmosphere, color palette, and the emotional undertone she radiates.
- Output only the prompt: English, single comma-separated paragraph, no markdown, no
  numbering, no quotes, no preamble, no explanations, no labels like "Variant 1:".
- SFW only. Never sexual, nude, underage, violent, or disallowed content.
- Length 70–120 words so the vibe and the technical anchors both come through.`;

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
texture, setting, time of day, lighting, color palette, lens, mood, body language and
what she's doing in the frame.

Every variant must satisfy the dual purpose at once:
- Self-selling editorial / candid shot — never a flat passport stare into the lens.
- Clean LoRA-reference shot — face fully visible, both eyes shown, sharp and well-lit;
  open natural pose where the figure / silhouette reads clearly. No full profile, no
  back-of-head, no face hidden by hands / hair / hats / sunglasses / shadow. No tightly
  folded poses that hide the body. Soft three-quarter or near-frontal angle, off-center
  framing, gentle mid-action — face and figure remain unambiguously presentable.

Return strictly a JSON array of ${count} strings — no prose, no keys, no markdown fences.`;

const ENHANCE_USER_PROMPT_TEMPLATE = (basePrompt: string) =>
	`Rewrite and enrich the following user brief into a single high-quality
photorealistic portrait prompt following the system rules. The result must:
- Give the woman a distinct VIBE / archetype expressed through wardrobe, setting,
  light, expression and what she's doing — never generic, never a flat passport stare.
- Use an editorial / candid / cinematic composition (soft three-quarter, slight
  off-center framing, gentle mid-action, etc.).
- Keep her face fully visible (both eyes, sharp, well-lit, no hiding behind hair,
  hands, hats, sunglasses or shadow) and her figure / silhouette openly readable —
  the shot must double as a clean LoRA training reference while still being a
  self-selling photo.

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
