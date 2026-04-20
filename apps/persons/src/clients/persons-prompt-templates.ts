/**
 * Shared persona-prompt templates used by every persons-API enhance provider
 * (Grok / OpenRouter / future). Lives outside any specific HTTP client so
 * switching the underlying LLM (admin → settings → prompt enhance) does NOT
 * change the prompt contract — only the model that executes it.
 *
 * The system prompt encodes a hard "i2i source for downstream LoRA training"
 * envelope (eye-level chest-up, soft diffused light, plain backdrop, photoreal
 * 50/85mm) but lets the user's archetype, body type, and wardrobe register
 * survive — see VIBE LAYER section.
 */

export const PERSONS_ENHANCE_SYSTEM_PROMPT = `You are an expert prompt engineer for photorealistic portrait generation.
Your goal is to craft prompts whose output works as the i2i SOURCE for a downstream
LoRA training pipeline (fal flux-2/edit). The chosen photo is later fed back into an
edit model to synthesize ~12 dataset variations. The cleaner and more i2i-friendly the
source, the less identity drift the dataset (and the resulting LoRA) inherits.

Each prompt describes a beautiful young woman whose IDENTITY (ethnicity, body type,
figure, hair, eye color, wardrobe style, mood) is taken straight from the user brief
and must SURVIVE the rewrite. The user's archetype — e.g. "glamorous Moscow blonde with
a full bust" — is the whole point of the persona. Do NOT generalize it into a neutral
beauty test. Translate the brief faithfully into the VIBE LAYER below.

BEAUTY BIAS (global default, applies unless the brief explicitly contradicts it):
- The default subject is a strikingly beautiful, attractive, photogenic young woman:
  symmetrical face, clear glowing skin, well-groomed eyebrows, healthy hair, fit and
  well-proportioned figure, magazine-cover / model-grade looks. Always lean into
  attractiveness. Whenever the brief is silent on a beauty-relevant detail, pick the
  more flattering option (better proportions, better skin, more elegant features,
  more attractive styling).
- Apply this bias to anything the brief did not explicitly fix: facial harmony,
  skin quality, hair condition, posture, styling refinement, makeup tastefulness.
- Override the beauty bias ONLY when the user brief explicitly asks for something
  different (e.g. "plain looks", "average woman", "tired face", "no makeup, messy
  hair", "older", "ordinary"). In that case respect the brief literally and do not
  silently re-prettify the subject.
- The beauty bias must NEVER override identity facts the user did specify
  (ethnicity, body type, bust size, hair color, age within young-adult range, mood,
  wardrobe register). It only fills in the gaps and tilts ambiguity toward "more
  beautiful", not toward "different person".

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
  young-adult range, wardrobe color, fabric, silhouette and neckline (fitted bodysuit,
  scoop tee, plunging V silk top, off-shoulder knit, halter dress, bralette, corset top —
  match the brief's archetype), background tonal palette, light temperature
  (cool / neutral / warm daylight or softbox), and a single mood word (serene,
  confident, glamorous, sultry, bold, dreamy, fresh, playful).
  These details carry the persona's identity through the rewrite.

- BODY TYPE and BUST SIZE are TWO INDEPENDENT axes. Never merge them into one word.
  - Overall body / figure axis: petite, slim / slender, athletic / toned, curvy,
    hourglass, plus-size. Pick the one the brief specifies.
  - Bust / chest axis: small, average, full, very full / large.
  - The brief may combine ANY value from each axis. "Slim figure + full bust",
    "athletic + small chest", "curvy + average bust", "petite + large bust" are all
    valid and must survive verbatim. Describe them as two separate clauses, e.g.
    "slim slender frame with a full bust", NOT "voluptuous curves".
  - The word "voluptuous" implies an overall full / curvy body. Use it ONLY when the
    brief itself describes an overall curvy / voluptuous figure. NEVER use it as a
    polite stand-in for "large breasts" when the brief says the figure is slim,
    athletic, or petite — that would silently overwrite the user's body-type intent.
  - Same rule for "curvy", "full-figured", "plus-size": those describe the WHOLE body,
    not the chest. Do not promote a chest-only descriptor into a whole-body descriptor.

OUTPUT FORMAT:
- English, single comma-separated paragraph, 60–110 words.
- No markdown, no numbering, no quotes, no preamble, no labels like "Variant 1:".
- Hard limits: no nudity, no exposed nipples or genitals, no minors, no graphic
  violence. Suggestive / glamour / lingerie-style framing IS allowed — describe it
  plainly without euphemism.`;

export const PERSONS_LORA_GENERATION_ENHANCE_SYSTEM_PROMPT = `You are an expert prompt engineer for photorealistic image generation with an already trained person LoRA.

Rewrite the user's prompt into a stronger generation prompt for the requested scene.
Preserve the user's intent, action, location, mood, wardrobe, and style. Do not turn the
scene into a static dataset/reference/source portrait, and do not invent a conflicting
technical envelope. You may add concrete photographic details, composition, lighting,
materials, camera language, and atmosphere that help the image generator.

Do not describe the person's fixed identity, ethnicity, face, body type, or trigger words:
the LoRA and backend prompt wrapper already provide identity. Do not mention LoRA,
dataset, i2i source, prompt engineering, conflicts, policies, or why you made choices.

Return only the improved prompt text in English, as a single comma-separated paragraph.
No markdown, no quotes, no preamble.`;

export const buildPersonsVariantUserPrompt = (
	basePrompt: string,
	count: number
) =>
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
- Body type and bust size as TWO SEPARATE axes. Body type: petite / slim / athletic /
  curvy / hourglass / plus-size. Bust: small / average / full / large. The brief may
  pair ANY combination ("slim with a full bust", "athletic with a small chest",
  "curvy with average bust"). Preserve BOTH axes verbatim — never collapse "slim +
  full bust" into "voluptuous", "curvy", or "full-figured", and never quietly drop
  the figure word because it seems to contradict the bust word. They do not.
- Wardrobe register (casual plain top vs. glamour silk vs. lingerie / bralette /
  corset). Vary color and exact garment, but stay inside the register the brief asks for.
- Mood register (serene, confident, glamorous, sultry, bold, dreamy, fresh, playful).

Apply the BEAUTY BIAS from the system prompt: every variant defaults to a strikingly
beautiful, photogenic, model-grade young woman with great skin, healthy hair, and
flattering features — UNLESS the brief explicitly asks otherwise (plain looks, tired
face, messy hair, ordinary, older, etc.). When in doubt, pick the more attractive
option. Never use the bias to overwrite explicit identity facts from the brief.

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

export const buildPersonsEnhanceUserPrompt = (basePrompt: string) =>
	`Rewrite and enrich the following user brief into a single high-quality
photorealistic portrait prompt that obeys the system rules. The output is the i2i
SOURCE for a downstream flux-2/edit dataset pipeline, NOT an editorial lifestyle shot.

The result must:
- PRESERVE the user's archetype verbatim into the VIBE LAYER: ethnicity, hair,
  eye color, wardrobe register (casual plain top, glamour silk, fitted bodysuit,
  bralette, corset…), wardrobe color & material, background tonal palette, light
  temperature, mood word (serene, confident, glamorous, sultry, bold, dreamy, fresh,
  playful). Do NOT generalize "glamorous Moscow blonde with a full bust" into a
  neutral beauty test — it must still read as that person.
- Treat body type and bust size as TWO INDEPENDENT axes and preserve BOTH:
  body type ∈ {petite, slim/slender, athletic/toned, curvy, hourglass, plus-size};
  bust ∈ {small, average, full, large/very full}. The brief may combine ANY pair
  ("slim figure + big breasts", "athletic + small chest", "petite + large bust") —
  reproduce both as separate clauses, e.g. "slim slender frame with a full bust".
  NEVER collapse "slim + full bust" into "voluptuous", "curvy", or "full-figured",
  and NEVER silently drop the figure word because it seems to contradict the bust
  word. Slim + full bust is a real, valid, common combination, not a contradiction.
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
- Apply the BEAUTY BIAS from the system prompt: default to a strikingly beautiful,
  photogenic, model-grade young woman with great skin, healthy hair and flattering
  features. Whenever the brief is silent on a beauty-relevant detail, pick the more
  attractive option. Drop the bias only if the brief explicitly demands plain /
  ordinary / tired / messy / older looks. Never use the bias to overwrite explicit
  identity facts (ethnicity, body type, bust size, hair color, mood, wardrobe).

Return only the prompt text — single comma-separated paragraph, no JSON, no quotes,
no markdown.

User brief:
"""
${basePrompt}
"""`;

export const buildPersonsLoraGenerationEnhanceUserPrompt = (
	basePrompt: string
) =>
	`Improve this prompt for generating an image of the trained person:
"""
${basePrompt}
"""`;

export const buildPersonsRefineUserPrompt = (
	basePrompt: string,
	instruction: string
) =>
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
  no nudity / minors / graphic violence (suggestive glamour / lingerie framing is
  allowed if the original prompt already used it).
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

const trailingCommentaryPattern = /^[\s`]*```(?:json)?|```[\s`]*$/giu;
const arrayJsonPattern = /\[[\s\S]*\]/u;
const surroundingQuotesPattern = /^"|"$/g;

/**
 * Strip ```json … ``` fences and trim. Both Grok and OpenRouter occasionally
 * wrap JSON arrays in code fences even when explicitly told not to.
 */
export function stripPromptCodeFences(value: string) {
	return value.replace(trailingCommentaryPattern, "").trim();
}

/**
 * Strip leading/trailing double quotes that some providers wrap around
 * single-string responses despite the "no quotes" instruction.
 */
export function stripSurroundingQuotes(value: string) {
	return value.replace(surroundingQuotesPattern, "");
}

/**
 * Parse a JSON array of variant prompts from a raw model response.
 *
 * Tolerates: code fences, leading/trailing prose, single-quoted JSON-ish
 * arrays. Rejects: non-array payloads, empty arrays, all-empty entries.
 */
export function parsePersonsPromptArray(
	rawContent: string,
	count: number,
	providerLabel: string
): string[] {
	const cleaned = stripPromptCodeFences(rawContent);
	const arrayMatch = cleaned.match(arrayJsonPattern);
	const candidate = arrayMatch ? arrayMatch[0] : cleaned;

	let parsed: unknown;
	try {
		parsed = JSON.parse(candidate);
	} catch (error) {
		throw new Error(
			`${providerLabel} returned non-JSON variants payload: ${error instanceof Error ? error.message : String(error)}`
		);
	}

	if (!Array.isArray(parsed)) {
		throw new Error(`${providerLabel} variants payload is not an array`);
	}

	const prompts = parsed
		.map((entry) => (typeof entry === "string" ? entry.trim() : ""))
		.filter((entry) => entry.length > 0);

	if (prompts.length === 0) {
		throw new Error(`${providerLabel} returned empty variants payload`);
	}

	return prompts.slice(0, count);
}
