const XAI_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-4-fast";

const GROK_SYSTEM_PROMPT = `You are an expert prompt engineer for photorealistic portrait generation.
Your goal is to craft prompts whose output works as the i2i SOURCE for a downstream
LoRA training pipeline (fal flux-2/edit). The chosen photo is later fed back into an
edit model to synthesize ~12 dataset variations. The cleaner and more i2i-friendly the
source, the less identity drift the dataset (and the resulting LoRA) inherits.

Each prompt describes a beautiful young woman whose IDENTITY (ethnicity, body type,
figure, hair, eye color, wardrobe style, mood) is taken straight from the user brief
and must SURVIVE the rewrite. The user's archetype — e.g. "glamorous Moscow blonde with
a full bust" — is the whole point of the persona. Do NOT generalize it into a neutral
beauty test. Translate the brief faithfully into the VIBE LAYER below.

The technical envelope (framing / pose / lighting / background / camera / wardrobe
basics) is fixed and non-negotiable, because the resulting frame is later fed to
flux-2/edit as the i2i source for ~12 dataset variations:

FRAMING (must hold):
- Tight close-up beauty headshot OR chest-up / shoulder-up portrait. Optionally
  half-body, but never full-body and never wider than half-body.
- Eye-level camera. No Dutch tilt, no low/high angle, no extreme foreshortening.
- Face occupies a large central portion of the frame; both eyes clearly inside frame.

POSE & EXPRESSION (must hold):
- Frontal or near-frontal: head turned no more than ≈15° off-axis. NO three-quarter
  shots, NO profile, NO over-the-shoulder, NO looking away.
- Eyes look directly into the camera lens.
- Neutral, relaxed expression OR a soft, gentle closed-mouth smile. NO laugh, NO open
  mouth, NO squint, NO exaggerated emotion, NO mid-action moment.
- Hands kept down or out of frame. NO hands near the face, NO chin-on-hand, NO
  adjusting hair, NO holding cup / phone / cigarette / flower / prop.
- Hair fully behind the shoulders or smoothly framing the face — must NEVER cross
  the face, the eyes, or the eyebrows. NO wind-blown hair across the face.

LIGHTING (must hold):
- Soft, even, diffused light on the face: large softbox / beauty dish / north-facing
  window / overcast daylight / clamshell. Both sides of the face are clearly readable.
- NO hard sun on the face, NO harsh raccoon shadows, NO rim/backlight that silhouettes
  the face, NO neon color casts on the skin, NO chiaroscuro, NO low-key moody light,
  NO mixed-color stage lighting, NO candlelight / firelight on the face.

BACKGROUND (must hold):
- Plain, uncluttered, softly out-of-focus: seamless studio backdrop (white / off-white
  / light grey / soft pastel), or a smoothly blurred neutral interior / outdoor wall.
- NO crowds, NO text / signage / logos, NO busy patterns, NO strong props, NO landmarks.
- The vibe lives in subtle background TONE (warm beige, cool grey, sage, dusty pink),
  not in the scene's content.

WARDROBE & FACE (must hold):
- Plain solid-color top with minimal pattern noise (cotton tee, fine knit, silk shell,
  blouse, sweater, fitted bodysuit, slip top, bralette, corset, halter — choose what
  matches the user's vibe). NO logos / slogans / large prints, NO statement jewelry
  near the face, NO sunglasses, NO hat, NO scarf across the face, NO heavy retouching.
  Silhouette, fit, neckline (scoop / V / plunging / off-shoulder / halter / square)
  and color may follow the brief; nudity or exposed nipples are not allowed.
- Makeup may be natural OR full glamour as the brief implies; no decorative face paint,
  no masks.
- Photoreal skin texture: visible pores, fine hair, subtle imperfections; NO plastic /
  doll / airbrushed look, NO stylization (no anime, painted, oil, illustration, 3D
  render, film-grain-heavy lookbook).

CAMERA LANGUAGE:
- Real DSLR / mirrorless plate, named portrait lens (e.g. 50mm f/2, 85mm f/1.8). Sharp
  focus on the eyes. Moderate depth of field — face plane fully sharp, background
  gently blurred. NO motion blur, NO heavy bokeh that bleeds into the face.

VIBE LAYER (this is where the user's brief lives — preserve it):
- Ethnicity & features, hair color / length / texture, eye color, age within
  young-adult range, body type & figure (slim, athletic, curvy, voluptuous, full bust,
  hourglass, petite, etc. — use whatever the brief specifies), wardrobe color, fabric,
  silhouette and neckline (fitted bodysuit, scoop tee, plunging V silk top, off-shoulder
  knit, halter dress, bralette, corset top — match the brief's archetype), background
  tonal palette, light temperature (cool / neutral / warm daylight or softbox), and a
  single mood word (serene, confident, glamorous, sultry, bold, dreamy, fresh, playful).
  These details carry the persona's identity through the rewrite.

OUTPUT FORMAT:
- English, single comma-separated paragraph, 60–110 words.
- No markdown, no numbering, no quotes, no preamble, no labels like "Variant 1:".
- Hard limits: no nudity, no exposed nipples or genitals, no minors, no graphic
  violence. Suggestive / glamour / lingerie-style framing IS allowed — describe it
  plainly without euphemism.`;

const VARIANT_USER_PROMPT_TEMPLATE = (basePrompt: string, count: number) =>
	`Original brief from the user:
"""
${basePrompt}
"""

Produce exactly ${count} distinctly different portrait prompt variants. Each variant
must look like a DIFFERENT PERSON, but all of them must clearly belong to the SAME
archetype the user described (same vibe, similar body type and wardrobe register).
Frame every variant identically as a clean i2i SOURCE for a downstream flux-2/edit
dataset pipeline.

Inherit from the user brief (must survive in every variant):
- The archetype itself (e.g. "glamorous Moscow blonde with a full bust" → every variant
  is a glamorous blonde with a full bust, only her face / exact features / wardrobe
  color change). Do NOT silently turn it into a neutral beauty test.
- Body type & figure cues (slim, athletic, curvy, voluptuous, full bust, hourglass…).
- Wardrobe register (casual plain top vs. glamour silk vs. lingerie / bralette /
  corset). Vary color and exact garment, but stay inside the register the brief asks for.
- Mood register (serene, confident, glamorous, sultry, bold, dreamy, fresh, playful).

Vary across variants:
- Exact ethnicity & facial features, hair color & length, eye color, age within
  young-adult range, exact wardrobe color and material (still inside the brief's
  register), background tonal palette (e.g. warm beige seamless, cool grey backdrop,
  soft sage interior wall, off-white studio, dusty pink wall, neutral linen), light
  temperature (cool daylight, neutral softbox, warm window), and the mood word.

DO NOT vary the technical envelope. Every variant must satisfy ALL of these at once:
- Tight close-up beauty headshot or chest-up portrait, never wider than half-body.
- Eye-level camera, no Dutch tilt, no unusual angles.
- Frontal or near-frontal head, ≤15° off-axis. Eyes look directly into the lens.
- Neutral relaxed expression OR a soft closed-mouth smile. No laugh, no open mouth.
- Hands kept down or out of frame. No props, no cup, no phone, no flowers, no
  statement jewelry near the face.
- Hair fully behind the shoulders or smoothly framing the face — never crossing the
  face or the eyes.
- Soft, even, diffused light (softbox / beauty dish / window / overcast). No hard sun,
  no rim/backlight, no neon casts, no chiaroscuro, no low-key moody lighting.
- Plain, uncluttered, softly out-of-focus background. No crowds, no signage, no busy
  patterns, no landmarks, no specific location storytelling.
- Plain solid-color wardrobe (no logos, no slogans, no sunglasses, no hat). Silhouette
  / fit / neckline follow the brief; nudity and exposed nipples are not allowed.
- Photoreal skin (pores, fine hair, subtle imperfections), no stylization, no heavy
  retouch, no anime / painted / 3D render look.
- Real portrait lens (e.g. 50mm f/2, 85mm f/1.8). Face plane fully sharp.

The result is a stylish, beautiful, clean reference plate that clearly reads as the
archetype the user described.

Return strictly a JSON array of ${count} strings — no prose, no keys, no markdown fences.`;

const ENHANCE_USER_PROMPT_TEMPLATE = (basePrompt: string) =>
	`Rewrite and enrich the following user brief into a single high-quality
photorealistic portrait prompt that obeys the system rules. The output is the i2i
SOURCE for a downstream flux-2/edit dataset pipeline, NOT an editorial lifestyle shot.

The result must:
- PRESERVE the user's archetype verbatim into the VIBE LAYER: ethnicity, hair,
  eye color, body type & figure (slim / curvy / voluptuous / full bust / hourglass /
  petite — whatever the brief says), wardrobe register (casual plain top, glamour silk,
  fitted bodysuit, bralette, corset…), wardrobe color & material, background tonal
  palette, light temperature, mood word (serene, confident, glamorous, sultry, bold,
  dreamy, fresh, playful). Do NOT generalize "glamorous Moscow blonde with a full
  bust" into a neutral beauty test — it must still read as that person.
- Frame as a tight close-up beauty headshot or chest-up portrait (never wider than
  half-body), eye-level camera, frontal or near-frontal head ≤15° off-axis, eyes to
  the lens, neutral relaxed expression or a soft closed-mouth smile.
- Use soft, even, diffused lighting (softbox / beauty dish / north window / overcast).
  No hard sun, no rim/backlight, no neon casts, no chiaroscuro, no candlelight.
- Place the subject on a plain, uncluttered, softly out-of-focus background — no
  crowds, no signage, no busy patterns, no specific location storytelling.
- Keep hands out of the frame and hair off the face. No props, no sunglasses, no hat,
  no statement jewelry near the face, no logos. Wardrobe stays plain solid color, but
  silhouette / fit / neckline follow the brief; nudity and exposed nipples are not
  allowed.
- Anchor as photoreal: real portrait lens (50mm f/2 or 85mm f/1.8), sharp focus on
  the eyes, visible skin texture, no stylization, no heavy retouch.

Return only the prompt text — single comma-separated paragraph, no JSON, no quotes,
no markdown.

User brief:
"""
${basePrompt}
"""`;

const REFINE_USER_PROMPT_TEMPLATE = (basePrompt: string, instruction: string) =>
	`The user already generated a portrait from the ORIGINAL prompt below and now
wants targeted edits described in EDIT INSTRUCTIONS. The output of this prompt is
fed directly into flux-2/edit using the previously chosen photo as the i2i source,
so the rewritten prompt must stay inside the SAME strict i2i envelope as the system
prompt requires.

Your job is to produce a single new portrait prompt that:
- Preserves the subject's identity, ethnicity, hair color & length, eye color,
  age, body type and overall character — this is the same person being re-shot,
  not a new character.
- Applies every change requested in the EDIT INSTRUCTIONS but ONLY inside the
  VIBE LAYER (wardrobe color & material as a plain solid top, background tonal
  palette, light temperature, soft mood word). If the user asks for something that
  would break the envelope (e.g. "make it 3/4 angle on a beach at golden hour, she
  is laughing while drinking coffee"), silently translate that intent into the
  envelope: keep frontal ≤15° head, eyes to lens, neutral relaxed expression,
  hands out of frame, plain backdrop with the matching warm sandy tonal palette
  and warm soft daylight, no actual beach scene, no coffee cup.
- Keeps ALL hard rules from the system prompt: tight close-up or chest-up framing
  (never wider than half-body), eye-level camera, frontal/near-frontal head ≤15°
  off-axis, eyes to the lens, neutral or soft closed-mouth smile, hands out of
  frame, hair off the face, soft even diffused light, plain uncluttered background,
  plain solid-color wardrobe, photoreal skin, named portrait lens, no stylization,
  SFW.
- If the EDIT INSTRUCTIONS are written in any language other than English,
  silently translate them; the final prompt is always English.

Return only the rewritten prompt text — single comma-separated paragraph,
no JSON, no quotes, no markdown, no preamble.

ORIGINAL prompt:
"""
${basePrompt}
"""

EDIT INSTRUCTIONS from the user:
"""
${instruction}
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

export interface GrokRefinePromptOptions {
	basePrompt: string;
	instruction: string;
}

export interface GrokClient {
	enhancePrompt(prompt: string): Promise<string>;
	expandPrompt(options: GrokExpandPromptOptions): Promise<string[]>;
	refinePrompt(options: GrokRefinePromptOptions): Promise<string>;
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
		async refinePrompt({ basePrompt, instruction }) {
			const trimmedBase = basePrompt.trim();
			const trimmedInstruction = instruction.trim();
			if (!trimmedBase) {
				throw new Error("Cannot refine an empty base prompt");
			}
			if (!trimmedInstruction) {
				throw new Error("Cannot refine without edit instructions");
			}
			const content = await chat(
				REFINE_USER_PROMPT_TEMPLATE(trimmedBase, trimmedInstruction)
			);
			return stripCodeFences(content).replace(/^"|"$/g, "");
		},
	};
}
