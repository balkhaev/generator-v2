import type { PromptEnhanceClient } from "@/clients/prompt-enhance-client";
import {
	STUDIO_TEXT_ENHANCE_SYSTEM_PROMPT,
	STUDIO_TEXT_ENHANCE_USER_TEMPLATE,
	STUDIO_VISION_ENHANCE_SYSTEM_PROMPT,
	STUDIO_VISION_ENHANCE_USER_TEMPLATE,
} from "@/clients/prompt-enhance-templates";
import { tryInlineImageForVision } from "@/clients/vision-input-image";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

interface ChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string | null;
		};
	}>;
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

		const response = await fetchImpl(
			`${OPENROUTER_BASE_URL}/chat/completions`,
			{
				body: JSON.stringify({
					messages,
					model,
					temperature: 0.85,
				}),
				headers,
				method: "POST",
			}
		);

		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			throw new Error(
				`OpenRouter request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`
			);
		}

		const payload = (await response.json()) as ChatCompletionResponse;
		const content = payload.choices?.[0]?.message?.content?.trim();
		if (!content) {
			throw new Error("OpenRouter response did not contain any content");
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
