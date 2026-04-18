import type { PromptEnhanceClient } from "@/clients/prompt-enhance-client";
import {
	STUDIO_TEXT_ENHANCE_SYSTEM_PROMPT,
	STUDIO_TEXT_ENHANCE_USER_TEMPLATE,
	STUDIO_VISION_ENHANCE_SYSTEM_PROMPT,
	STUDIO_VISION_ENHANCE_USER_TEMPLATE,
} from "@/clients/prompt-enhance-templates";
import { tryInlineImageForVision } from "@/clients/vision-input-image";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Hard cap for a single chat-completions call. Prompt enhance is interactive,
 * so a stuck upstream must surface as a 502 to the user instead of hanging the
 * HTTP request forever (Node's fetch has no default response timeout).
 */
const OPENROUTER_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Enhance is a short-form rewrite, never a long generation. Bounding the
 * output also prevents a model from sitting in a stream loop and exhausting
 * our request budget.
 */
const OPENROUTER_MAX_TOKENS = 600;

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

interface StudioOpenRouterClientOptions {
	apiKey: string;
	/** Shown as X-Title (optional). */
	appName?: string | null;
	fetchImpl?: typeof fetch;
	/** e.g. https://your-app.example — optional OpenRouter header. */
	httpReferer?: string | null;
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

/**
 * Most common cause in practice: a reasoning model (e.g. qwen/qwen3.5-9b)
 * burns the entire OPENROUTER_MAX_TOKENS budget on hidden chain-of-thought
 * and returns finish_reason="length" with content=null. Surface that
 * diagnostically so the operator can pick a different model in the admin UI
 * instead of seeing an opaque 502.
 */
function buildEmptyContentMessage(
	model: string,
	payload: ChatCompletionResponse
): string {
	const choice = payload.choices?.[0];
	const finishReason = choice?.finish_reason ?? "unknown";
	const provider = payload.provider ?? "unknown";
	const reasoningTokens =
		payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
	const completionTokens = payload.usage?.completion_tokens ?? 0;
	const exhaustedReasoning =
		reasoningTokens > 0 && completionTokens >= OPENROUTER_MAX_TOKENS;
	const reasoningHint = exhaustedReasoning
		? ` Model "${model}" appears to be a reasoning model and exhausted ` +
			`the ${OPENROUTER_MAX_TOKENS}-token budget on hidden reasoning ` +
			`(reasoning_tokens=${reasoningTokens}). Pick a non-reasoning ` +
			"model in admin → settings → prompt enhance."
		: "";
	return (
		`OpenRouter returned empty content (model=${model}, ` +
		`provider=${provider}, finish_reason=${finishReason}).${reasoningHint}`
	);
}

export function createStudioOpenRouterClient(
	options: StudioOpenRouterClientOptions
): PromptEnhanceClient {
	const apiKey = options.apiKey.trim();
	if (!apiKey) {
		throw new Error("OPENROUTER_API_KEY is required for OpenRouter client");
	}

	const fetchImpl = options.fetchImpl ?? fetch;
	const model = options.model?.trim() || "openai/gpt-4o-mini";
	const referer = options.httpReferer?.trim();
	const appName = options.appName?.trim();

	async function callChatCompletions(
		messages: {
			content: string | Record<string, unknown>[];
			role: "system" | "user";
		}[]
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
					messages,
					model,
					temperature: 0.85,
				}),
				headers,
				method: "POST",
				signal: controller.signal,
			});
		} catch (error) {
			if (controller.signal.aborted) {
				throw new Error(
					`OpenRouter request timed out after ${OPENROUTER_REQUEST_TIMEOUT_MS}ms`
				);
			}
			throw error;
		} finally {
			clearTimeout(timeoutId);
		}

		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new Error(
				`OpenRouter request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`
			);
		}

		const payload = (await response.json()) as ChatCompletionResponse;
		const choice = payload.choices?.[0];
		const content = choice?.message?.content?.trim();
		if (!content) {
			throw new Error(buildEmptyContentMessage(model, payload));
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
				{ role: "system", content: STUDIO_TEXT_ENHANCE_SYSTEM_PROMPT },
				{ role: "user", content: STUDIO_TEXT_ENHANCE_USER_TEMPLATE(trimmed) },
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
				{ role: "system", content: STUDIO_VISION_ENHANCE_SYSTEM_PROMPT },
				{
					role: "user",
					content: [
						{
							type: "image_url",
							image_url: { detail: "low", url: imageForModel },
						},
						{
							type: "text",
							text: STUDIO_VISION_ENHANCE_USER_TEMPLATE(trimmed),
						},
					],
				},
			]);
		},
	};
}
