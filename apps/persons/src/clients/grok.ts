import {
	buildPersonsEnhanceUserPrompt,
	buildPersonsRefineUserPrompt,
	buildPersonsVariantUserPrompt,
	PERSONS_ENHANCE_SYSTEM_PROMPT,
	parsePersonsPromptArray,
	stripPromptCodeFences,
	stripSurroundingQuotes,
} from "@/clients/persons-prompt-templates";

const XAI_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MODEL = "grok-4-fast";
const PROVIDER_LABEL = "Grok";

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

/**
 * Persona prompt-enhance client. Same shape regardless of which LLM provider
 * powers it (Grok / OpenRouter / future) — see {@link createGrokClient} and
 * `createPersonsOpenRouterClient`. Naming kept as `GrokClient` to avoid
 * touching `PersonsService` and every callsite that already depends on it.
 */
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
					{ role: "system", content: PERSONS_ENHANCE_SYSTEM_PROMPT },
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
				`${PROVIDER_LABEL} request failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`
			);
		}

		const payload = (await response.json()) as ChatCompletionResponse;
		const content = payload.choices?.[0]?.message?.content?.trim();
		if (!content) {
			throw new Error(`${PROVIDER_LABEL} response did not contain any content`);
		}

		return content;
	}

	return {
		async enhancePrompt(prompt) {
			const trimmed = prompt.trim();
			if (!trimmed) {
				throw new Error("Cannot enhance an empty prompt");
			}
			const content = await chat(buildPersonsEnhanceUserPrompt(trimmed));
			return stripSurroundingQuotes(stripPromptCodeFences(content));
		},
		async expandPrompt({ prompt, count }) {
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
				buildPersonsRefineUserPrompt(trimmedBase, trimmedInstruction)
			);
			return stripSurroundingQuotes(stripPromptCodeFences(content));
		},
	};
}
