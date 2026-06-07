/**
 * Validate and normalize the raw text a model returns for prompt-enhance.
 *
 * The contract we want from the model is narrow: a single scene/motion prompt,
 * one paragraph, comma-separated clauses, no markdown, no first-person
 * narration, no refusal. Models violate this in three recurring ways:
 *
 *   1. Content-policy refusals returned as a 200 body ("I cannot generate…").
 *   2. Chain-of-thought / reasoning dumps (bold step headers, bullet lists,
 *      "Per the system instructions…") when a reasoning model ignores
 *      reasoning.enabled=false.
 *   3. A benign one-line preamble ("Here is the enhanced prompt:") in front of
 *      an otherwise-clean prompt.
 *
 * Rather than maintain an ever-growing blacklist of refusal phrases (a losing
 * whack-a-mole — every new model phrasing is a new prod leak), we validate a
 * positive contract: detect the structural shape of refusals/dumps, recover
 * from the benign preamble case, and reject anything that still doesn't look
 * like a prompt. Each rejection carries a machine-readable `reason` so callers
 * can log telemetry and decide whether to retry on the next model.
 */

const surroundingQuotePattern = /^["'`]+|["'`]+$/g;
const codeFencePattern = /^[\s`]*```(?:[a-z]+)?|```[\s`]*$/giu;
const whitespacePattern = /\s+/g;

/** Markdown bold "header:" tokens never appear in a real comma-prompt. */
const boldHeaderPattern = /\*\*[^*\n]{1,48}?:?\s*\*\*/u;
/** Bullet or numbered list items at line start (reasoning-dump structure). */
const listItemPattern = /^[ \t]*(?:[-*•]|\d+[.)])\s+\S/u;

/**
 * First-person narration / meta phrasing. A genuine scene prompt is written in
 * the third person about the subject; first-person modal verbs ("I will write",
 * "Let me", "Per the system instructions") only show up when the model talks
 * about its own process instead of producing the prompt.
 */
const narrationPatterns = [
	/\bper the system (?:instructions|rules|prompt)\b/iu,
	/\bi (?:will|must|need to|am going to|should|can)\s+(?:construct|build|draft|write|create|now|proceed|combine|expand|ensure|preserve|describe|use)\b/iu,
	/\bthe (?:prompt|brief|user brief|user'?s brief)\s+(?:provided|you (?:provided|gave)|is in|describes|requests?)\b/iu,
	/\bwait,?\s+the instructions?\b/iu,
	/\blet'?s (?:re-?read|ensure|check|combine|expand|refine)\b/iu,
	/\bi will write the prompt\b/iu,
	/\baction impossible\b/iu,
	/\bhard intent rules\b/iu,
	/(^|\n)\s*\**\s*(?:conflict|decision|resolution|correction|refining for constraints)\s*:?/iu,
] as const;

/**
 * Content-policy refusals. Kept anchored to refusal phrasing so legitimate
 * comma-separated scene prompts never trip them.
 */
const refusalPatterns = [
	/\bi\s+(?:cannot|can'?t|can\s?not|won'?t|will\s+not)\s+(?:generate|create|write|produce|assist|help|provide|fulfil|fulfill|comply|continue|describe)/iu,
	/\bi'?m\s+(?:sorry|unable|not\s+able)\b/iu,
	/\bi\s+am\s+(?:sorry|unable|not\s+able)\b/iu,
	/\bi\s+can,?\s+however\b/iu,
	/\bas\s+an\s+ai\b/iu,
	/\bsexually\s+explicit\s+content\b/iu,
	/\bagainst\s+my\s+(?:guidelines|programming|policy)\b/iu,
	/\b(?:violates|against)\s+(?:the\s+)?(?:content|usage)\s+(?:policy|policies|guidelines)\b/iu,
] as const;

/**
 * Benign single-line preambles a model prepends to an otherwise-clean prompt.
 * We strip these (and any following blank lines) rather than rejecting, to
 * avoid a wasted fallback round-trip on the happy-ish path.
 */
const benignPreamblePattern =
	/^\s*(?:here(?:'?s| is)(?: the)?(?: enhanced| final| rewritten)?(?: prompt)?|(?:enhanced|final|rewritten|output)?\s*prompt)\s*[:\-—]\s*/iu;

export type EnhanceRejectReason =
	| "empty"
	| "refusal"
	| "reasoning_dump"
	| "too_short";

/**
 * Typed error so callers can branch on the reason (telemetry + retry policy)
 * instead of string-matching the message. The message keeps the legacy
 * substrings ("refused by the model", "returned analysis") so existing
 * fallback predicates and tests keep working.
 */
export class EnhanceOutputError extends Error {
	readonly reason: EnhanceRejectReason;

	constructor(reason: EnhanceRejectReason, message: string) {
		super(message);
		this.name = "EnhanceOutputError";
		this.reason = reason;
	}
}

function isRefusal(value: string): boolean {
	return refusalPatterns.some((pattern) => pattern.test(value));
}

/**
 * A reasoning/analysis dump is structural, not lexical: markdown bold headers,
 * multi-line bullet/numbered lists, or first-person narration about the task.
 * Any one of these means the body is the model thinking out loud, not a prompt.
 */
function isReasoningDump(value: string): boolean {
	if (boldHeaderPattern.test(value)) {
		return true;
	}
	if (narrationPatterns.some((pattern) => pattern.test(value))) {
		return true;
	}
	const listLines = value
		.split("\n")
		.filter((line) => listItemPattern.test(line));
	return listLines.length >= 2;
}

function stripBenignPreamble(value: string): string {
	const firstBreak = value.indexOf("\n");
	// Only treat a single leading line as a preamble; a multi-line block in
	// front of the prompt is a reasoning dump and was already rejected above.
	const head = firstBreak === -1 ? value : value.slice(0, firstBreak);
	if (!benignPreamblePattern.test(head)) {
		return value;
	}
	if (firstBreak === -1) {
		return value.replace(benignPreamblePattern, "");
	}
	const rest = value.slice(firstBreak + 1).trim();
	// "Final prompt:" on its own line followed by the real prompt.
	return rest.length > 0 ? rest : value.replace(benignPreamblePattern, "");
}

function normalize(value: string): string {
	return value
		.replace(codeFencePattern, "")
		.trim()
		.replace(surroundingQuotePattern, "")
		.trim()
		.replace(whitespacePattern, " ");
}

const MIN_PROMPT_WORDS = 3;

/**
 * Analyze raw model output without throwing. Returns either the cleaned prompt
 * or a structured rejection reason — useful for telemetry and the eval harness
 * where we want to score outcomes rather than catch exceptions.
 */
export function analyzeEnhancedOutput(
	value: string
):
	| { ok: true; prompt: string }
	| { ok: false; reason: EnhanceRejectReason; message: string } {
	const raw = value.trim();
	if (!raw) {
		return {
			ok: false,
			reason: "empty",
			message: "Prompt enhance returned empty output",
		};
	}
	if (isRefusal(raw)) {
		return {
			ok: false,
			reason: "refusal",
			message: "Prompt enhance was refused by the model (content moderation)",
		};
	}
	if (isReasoningDump(raw)) {
		return {
			ok: false,
			reason: "reasoning_dump",
			message: "Prompt enhance returned analysis instead of a rewritten prompt",
		};
	}
	const recovered = stripBenignPreamble(raw);
	const cleaned = normalize(recovered);
	if (cleaned.split(" ").filter(Boolean).length < MIN_PROMPT_WORDS) {
		return {
			ok: false,
			reason: "too_short",
			message: "Prompt enhance returned a degenerate prompt (too short)",
		};
	}
	return { ok: true, prompt: cleaned };
}

export function cleanPromptOutput(value: string): string {
	const result = analyzeEnhancedOutput(value);
	if (result.ok) {
		return result.prompt;
	}
	throw new EnhanceOutputError(result.reason, result.message);
}
