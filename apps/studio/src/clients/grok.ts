import type { PromptEnhanceClient } from "@/clients/prompt-enhance-client";
import {
	STUDIO_TEXT_ENHANCE_SYSTEM_PROMPT,
	STUDIO_TEXT_ENHANCE_USER_TEMPLATE,
	STUDIO_VISION_ENHANCE_SYSTEM_PROMPT,
	STUDIO_VISION_ENHANCE_USER_TEMPLATE,
} from "@/clients/prompt-enhance-templates";
import { tryInlineImageForVision } from "@/clients/vision-input-image";

const XAI_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-4-fast";

/** Mirrors the OpenRouter client cap; see notes there for rationale. */
const GROK_REQUEST_TIMEOUT_MS = 60_000;
const GROK_MAX_TOKENS = 600;

interface ChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string | null;
		};
	}>;
}

export type StudioGrokClient = PromptEnhanceClient;

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
		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			GROK_REQUEST_TIMEOUT_MS
		);
		let response: Response;
		try {
			response = await fetchImpl(`${XAI_BASE_URL}/chat/completions`, {
				body: JSON.stringify({
					max_tokens: GROK_MAX_TOKENS,
					messages,
					model,
					temperature: 0.85,
				}),
				headers: {
					authorization: `Bearer ${apiKey}`,
					"content-type": "application/json",
				},
				method: "POST",
				signal: controller.signal,
			});
		} catch (error) {
			if (controller.signal.aborted) {
				throw new Error(
					`Grok request timed out after ${GROK_REQUEST_TIMEOUT_MS}ms`
				);
			}
			throw error;
		} finally {
			clearTimeout(timeoutId);
		}

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
