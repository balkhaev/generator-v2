import type { PromptEnhanceClient } from "@/clients/prompt-enhance-client";
import { cleanPromptOutput } from "@/clients/prompt-enhance-output";
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

/**
 * When the primary vision model refuses a brief (xAI/Grok in particular
 * moderates the *input image* and can refuse on one frame while happily
 * rewriting the next), retry the same messages against these permissive
 * vision-capable models before giving up to text-only enhance. Empirically
 * (NSFW image-to-video briefs) Mistral and Qwen-VL comply where Grok refuses.
 * Order matters: cheapest/most-reliable first. The primary model is always
 * tried first and de-duplicated out of this list.
 */
const DEFAULT_VISION_FALLBACK_MODELS = [
	"x-ai/grok-4.20",
	"mistralai/mistral-medium-3.1",
	"qwen/qwen3-vl-235b-a22b-instruct",
] as const;

/**
 * A vision call failure worth retrying on the NEXT model rather than bubbling
 * up: content-policy refusals, empty-content cutoffs, and dead/!routable model
 * slugs. A genuine network/timeout error is not in here — it rethrows so the
 * route can surface it.
 */
const RETRIABLE_VISION_ERROR_MARKERS = [
	"moderation",
	"refus",
	"empty content",
	"returned analysis",
	"no endpoints",
	"deprecated",
	"is not a valid model",
	"404",
	"policy",
	"content violates",
] as const;

function isRetriableVisionError(error: unknown): boolean {
	const message = (
		error instanceof Error ? error.message : String(error)
	).toLowerCase();
	return RETRIABLE_VISION_ERROR_MARKERS.some((marker) =>
		message.includes(marker)
	);
}

function buildVisionModelChain(primary: string): string[] {
	const chain: string[] = [primary];
	for (const fallback of DEFAULT_VISION_FALLBACK_MODELS) {
		if (!chain.includes(fallback)) {
			chain.push(fallback);
		}
	}
	return chain;
}

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

/**
 * Diagnose 200-with-empty-content responses. Even with reasoning disabled
 * (see callChatCompletions) some providers can still return null content on
 * length cutoffs, refusals, or routing failures — surface enough context to
 * debug from logs without re-running the request.
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
	const reasoningHint =
		reasoningTokens > 0
			? " (provider ignored reasoning.enabled=false and burned " +
				`${reasoningTokens} reasoning tokens — try a different provider ` +
				"route or another model in admin → settings → prompt enhance)"
			: "";
	return (
		`OpenRouter returned empty content (model=${model}, ` +
		`provider=${provider}, finish_reason=${finishReason})${reasoningHint}`
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
		}[],
		modelOverride?: string
	): Promise<string> {
		const activeModel = modelOverride?.trim() || model;
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
					model: activeModel,
					// Prompt-enhance is a short rewrite; we never want hidden
					// chain-of-thought eating the entire OPENROUTER_MAX_TOKENS
					// budget (Qwen3.5, GPT-5, o-series and friends will happily
					// burn 600+ reasoning tokens and return content=null with
					// finish_reason="length"). Non-reasoning models simply
					// ignore this field.
					reasoning: { enabled: false },
					temperature: 0.35,
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
			throw new Error(buildEmptyContentMessage(activeModel, payload));
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
			const messages = [
				{
					role: "system" as const,
					content: STUDIO_VISION_ENHANCE_SYSTEM_PROMPT,
				},
				{
					role: "user" as const,
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
			];

			// Walk the vision model chain: the configured model first, then
			// permissive fallbacks. A refusal / empty-content / dead-slug failure
			// retries on the next model; the last error bubbles up so the route
			// can fall back to text-only enhance.
			const chain = buildVisionModelChain(model);
			let lastError: unknown;
			for (const candidate of chain) {
				try {
					return await callChatCompletions(messages, candidate);
				} catch (error) {
					if (!isRetriableVisionError(error)) {
						throw error;
					}
					lastError = error;
				}
			}
			throw lastError instanceof Error
				? lastError
				: new Error("Vision prompt enhance failed across all fallback models");
		},
	};
}
