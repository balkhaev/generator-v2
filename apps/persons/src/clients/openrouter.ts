import type {
	GrokClient,
	GrokExpandPromptOptions,
	GrokRefinePromptOptions,
} from "@/clients/grok";
import {
	buildPersonsEnhanceUserPrompt,
	buildPersonsLoraGenerationEnhanceUserPrompt,
	buildPersonsRefineUserPrompt,
	buildPersonsVariantUserPrompt,
	PERSONS_ENHANCE_SYSTEM_PROMPT,
	PERSONS_LORA_GENERATION_ENHANCE_SYSTEM_PROMPT,
	parsePersonsPromptArray,
	stripPromptCodeFences,
	stripSurroundingQuotes,
} from "@/clients/persons-prompt-templates";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const PROVIDER_LABEL = "OpenRouter";

/**
 * Hard cap for a single chat-completions call. Prompt enhance is interactive,
 * so a stuck upstream surfaces as a 502 to the user instead of hanging the
 * HTTP request forever (Node's fetch has no default response timeout).
 */
const OPENROUTER_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Persona prompts are short rewrites; bound output to keep reasoning models
 * from burning the entire budget on hidden chain-of-thought tokens. The
 * variant template can produce 4×~110-word JSON entries plus brackets, so
 * we leave headroom over the 600-token studio cap.
 */
const OPENROUTER_MAX_TOKENS = 1200;

interface ChatCompletionResponse {
	choices?: Array<{
		finish_reason?: string | null;
		message?: {
			content?: string | null;
		};
	}>;
	provider?: string;
	usage?: {
		completion_tokens?: number;
		completion_tokens_details?: {
			reasoning_tokens?: number;
		};
	};
}

interface PersonsOpenRouterClientOptions {
	apiKey: string;
	/** Optional X-Title for OpenRouter dashboard. */
	appName?: string | null;
	fetchImpl?: typeof fetch;
	/** Optional Referer header for OpenRouter analytics. */
	httpReferer?: string | null;
	model?: string;
}

/** Provider returned 200 with empty content — diagnose finish_reason and any
 *  reasoning-token burn so the operator can pick a different model from admin
 *  → settings → prompt enhance instead of staring at a generic 502. */
function buildEmptyContentMessage(
	model: string,
	payload: ChatCompletionResponse
): string {
	const choice = payload.choices?.[0];
	const finishReason = choice?.finish_reason ?? "unknown";
	const provider = payload.provider ?? "unknown";
	const reasoningTokens =
		payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
	const reasoningHint =
		reasoningTokens > 0
			? " (provider ignored reasoning.enabled=false and burned " +
				`${reasoningTokens} reasoning tokens — try a different provider ` +
				"route or another model in admin → settings → prompt enhance)"
			: "";
	return (
		`${PROVIDER_LABEL} returned empty content (model=${model}, ` +
		`provider=${provider}, finish_reason=${finishReason})${reasoningHint}`
	);
}

export function createPersonsOpenRouterClient(
	options: PersonsOpenRouterClientOptions
): GrokClient {
	const apiKey = options.apiKey.trim();
	if (!apiKey) {
		throw new Error(
			"OPENROUTER_API_KEY is required to create persons OpenRouter client"
		);
	}

	const fetchImpl = options.fetchImpl ?? fetch;
	const model = options.model?.trim() || "openai/gpt-4o-mini";
	const referer = options.httpReferer?.trim();
	const appName = options.appName?.trim();

	async function chat(
		userPrompt: string,
		systemPrompt = PERSONS_ENHANCE_SYSTEM_PROMPT
	): Promise<string> {
		const headers: Record<string, string> = {
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
		};
		if (referer) {
			headers.Referer = referer;
		}
		if (appName) {
			headers["X-Title"] = appName;
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			OPENROUTER_REQUEST_TIMEOUT_MS
		);
		let response: Response;
		try {
			response = await fetchImpl(`${OPENROUTER_BASE_URL}/chat/completions`, {
				body: JSON.stringify({
					max_tokens: OPENROUTER_MAX_TOKENS,
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: userPrompt },
					],
					model,
					// Persona enhance is a short rewrite; never let hidden
					// chain-of-thought eat the entire OPENROUTER_MAX_TOKENS budget
					// (Qwen 3.5, GPT-5, o-series will burn 600+ reasoning tokens
					// and return content=null with finish_reason="length").
					// Non-reasoning models simply ignore this field.
					reasoning: { enabled: false },
					temperature: 0.95,
				}),
				headers,
				method: "POST",
				signal: controller.signal,
			});
		} catch (error) {
			if (controller.signal.aborted) {
				throw new Error(
					`${PROVIDER_LABEL} request timed out after ${OPENROUTER_REQUEST_TIMEOUT_MS}ms`
				);
			}
			throw error;
		} finally {
			clearTimeout(timeoutId);
		}

		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new Error(
				`${PROVIDER_LABEL} request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`
			);
		}

		const payload = (await response.json()) as ChatCompletionResponse;
		const content = payload.choices?.[0]?.message?.content?.trim();
		if (!content) {
			throw new Error(buildEmptyContentMessage(model, payload));
		}
		return content;
	}

	return {
		async enhanceGenerationPrompt(prompt: string) {
			const trimmed = prompt.trim();
			if (!trimmed) {
				throw new Error("Cannot enhance an empty prompt");
			}
			const content = await chat(
				buildPersonsLoraGenerationEnhanceUserPrompt(trimmed),
				PERSONS_LORA_GENERATION_ENHANCE_SYSTEM_PROMPT
			);
			return stripSurroundingQuotes(stripPromptCodeFences(content));
		},
		async enhancePrompt(prompt: string) {
			const trimmed = prompt.trim();
			if (!trimmed) {
				throw new Error("Cannot enhance an empty prompt");
			}
			const content = await chat(buildPersonsEnhanceUserPrompt(trimmed));
			return stripSurroundingQuotes(stripPromptCodeFences(content));
		},
		async expandPrompt({ prompt, count }: GrokExpandPromptOptions) {
			const trimmed = prompt.trim();
			if (!trimmed) {
				throw new Error("Cannot expand an empty prompt");
			}
			const safeCount = Math.max(1, Math.min(8, Math.floor(count)));
			const content = await chat(
				buildPersonsVariantUserPrompt(trimmed, safeCount)
			);
			return parsePersonsPromptArray(content, safeCount, PROVIDER_LABEL);
		},
		async refinePrompt({ basePrompt, instruction }: GrokRefinePromptOptions) {
			const trimmedBase = basePrompt.trim();
			const trimmedInstruction = instruction.trim();
			if (!trimmedBase) {
				throw new Error("Cannot refine an empty base prompt");
			}
			if (!trimmedInstruction) {
				throw new Error("Cannot refine without edit instructions");
			}
			const content = await chat(
				buildPersonsRefineUserPrompt(trimmedBase, trimmedInstruction)
			);
			return stripSurroundingQuotes(stripPromptCodeFences(content));
		},
	};
}
