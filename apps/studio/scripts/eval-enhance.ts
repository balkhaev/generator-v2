/**
 * Prompt-enhance evaluation harness.
 *
 * Turns "find the optimal model" from a vibe into a reproducible measurement.
 * For each (fixture × model) it runs the *real* studio enhance templates
 * against OpenRouter, scores the output with the same validator production
 * uses (analyzeEnhancedOutput), and prints a per-model scorecard: how often a
 * model returns a clean prompt vs refuses / dumps reasoning / returns junk,
 * plus latency.
 *
 * Content safety: this script reads its test cases from an EXTERNAL file
 * (ENHANCE_EVAL_FIXTURES) that is gitignored. No explicit prompts or image
 * URLs are committed to the repository.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... \
 *   ENHANCE_EVAL_FIXTURES=./scripts/fixtures-enhance.json \
 *   ENHANCE_EVAL_MODELS="x-ai/grok-4.20,mistralai/mistral-medium-3.1" \
 *   bun run apps/studio/scripts/eval-enhance.ts
 *
 * Fixture file shape (see fixtures-enhance.example.json):
 *   [{ "brief": "…", "imageUrl": "https://… (optional)" }]
 */

import { readFileSync } from "node:fs";

import {
	analyzeEnhancedOutput,
	type EnhanceRejectReason,
} from "../src/clients/prompt-enhance-output";
import {
	STUDIO_TEXT_ENHANCE_SYSTEM_PROMPT,
	STUDIO_TEXT_ENHANCE_USER_TEMPLATE,
	STUDIO_VISION_ENHANCE_SYSTEM_PROMPT,
	STUDIO_VISION_ENHANCE_USER_TEMPLATE,
} from "../src/clients/prompt-enhance-templates";
import { tryInlineImageForVision } from "../src/clients/vision-input-image";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_MAX_TOKENS = 600;
const REQUEST_TIMEOUT_MS = 60_000;

const DEFAULT_MODELS = [
	"x-ai/grok-4.20",
	"mistralai/mistral-medium-3.1",
	"qwen/qwen3-vl-235b-a22b-instruct",
];

type Outcome = EnhanceRejectReason | "http_error" | "ok";

interface Fixture {
	brief: string;
	imageUrl?: string;
}

interface AttemptResult {
	durationMs: number;
	outcome: Outcome;
}

interface ModelScore {
	durations: number[];
	model: string;
	outcomes: Record<Outcome, number>;
	total: number;
}

function requireEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required`);
	}
	return value;
}

function loadFixtures(path: string): Fixture[] {
	const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error("Fixture file must be a JSON array");
	}
	return parsed.map((entry, index) => {
		if (
			typeof entry !== "object" ||
			entry === null ||
			typeof (entry as Fixture).brief !== "string"
		) {
			throw new Error(`Fixture #${index} must have a string "brief"`);
		}
		return entry as Fixture;
	});
}

async function buildMessages(
	fixture: Fixture
): Promise<{ content: unknown; role: "system" | "user" }[]> {
	const brief = fixture.brief.trim();
	if (!fixture.imageUrl) {
		return [
			{ content: STUDIO_TEXT_ENHANCE_SYSTEM_PROMPT, role: "system" },
			{ content: STUDIO_TEXT_ENHANCE_USER_TEMPLATE(brief), role: "user" },
		];
	}
	const imageForModel = await tryInlineImageForVision(fixture.imageUrl, fetch);
	return [
		{ content: STUDIO_VISION_ENHANCE_SYSTEM_PROMPT, role: "system" },
		{
			content: [
				{ image_url: { detail: "low", url: imageForModel }, type: "image_url" },
				{ text: STUDIO_VISION_ENHANCE_USER_TEMPLATE(brief), type: "text" },
			],
			role: "user",
		},
	];
}

async function runOne(
	apiKey: string,
	model: string,
	fixture: Fixture
): Promise<AttemptResult> {
	const messages = await buildMessages(fixture);
	const startedAt = Date.now();
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
			body: JSON.stringify({
				max_tokens: OPENROUTER_MAX_TOKENS,
				messages,
				model,
				reasoning: { enabled: false },
				temperature: 0.35,
			}),
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
			},
			method: "POST",
			signal: controller.signal,
		});
		const durationMs = Date.now() - startedAt;
		if (!response.ok) {
			return { durationMs, outcome: "http_error" };
		}
		const payload = (await response.json()) as {
			choices?: { message?: { content?: string | null } }[];
		};
		const content = payload.choices?.[0]?.message?.content ?? "";
		const analysis = analyzeEnhancedOutput(content);
		return {
			durationMs,
			outcome: analysis.ok ? "ok" : analysis.reason,
		};
	} catch {
		return { durationMs: Date.now() - startedAt, outcome: "http_error" };
	} finally {
		clearTimeout(timeoutId);
	}
}

function emptyOutcomes(): Record<Outcome, number> {
	return {
		empty: 0,
		http_error: 0,
		ok: 0,
		reasoning_dump: 0,
		refusal: 0,
		too_short: 0,
	};
}

function median(values: number[]): number {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const hi = sorted[mid] ?? 0;
	if (sorted.length % 2 !== 0) {
		return hi;
	}
	const lo = sorted[mid - 1] ?? 0;
	return Math.round((lo + hi) / 2);
}

function printScorecard(scores: ModelScore[]): void {
	const rows = scores
		.map((score) => {
			const pass = ((score.outcomes.ok / score.total) * 100).toFixed(0);
			return {
				model: score.model,
				ok: score.outcomes.ok,
				pass: `${pass}%`,
				refusal: score.outcomes.refusal,
				dump: score.outcomes.reasoning_dump,
				short: score.outcomes.too_short,
				empty: score.outcomes.empty,
				http: score.outcomes.http_error,
				medianMs: median(score.durations),
			};
		})
		.sort((a, b) => Number.parseInt(b.pass, 10) - Number.parseInt(a.pass, 10));
	console.table(rows);
}

async function main(): Promise<void> {
	const apiKey = requireEnv("OPENROUTER_API_KEY");
	const fixtures = loadFixtures(requireEnv("ENHANCE_EVAL_FIXTURES"));
	const models = (process.env.ENHANCE_EVAL_MODELS?.trim() || "")
		.split(",")
		.map((m) => m.trim())
		.filter(Boolean);
	const modelList = models.length > 0 ? models : DEFAULT_MODELS;
	const repeat = Math.max(1, Number(process.env.ENHANCE_EVAL_REPEAT ?? "1"));

	const scores: ModelScore[] = [];
	for (const model of modelList) {
		const score: ModelScore = {
			durations: [],
			model,
			outcomes: emptyOutcomes(),
			total: 0,
		};
		for (const fixture of fixtures) {
			for (let i = 0; i < repeat; i++) {
				const result = await runOne(apiKey, model, fixture);
				score.outcomes[result.outcome] += 1;
				score.durations.push(result.durationMs);
				score.total += 1;
				console.error(
					`[${model}] ${result.outcome} (${result.durationMs}ms): ${fixture.brief.slice(0, 48)}`
				);
			}
		}
		scores.push(score);
	}
	printScorecard(scores);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
