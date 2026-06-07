import type { InferenceStatus } from "@/providers/inference";

/**
 * Structured inference telemetry.
 *
 * The project has Grafana but no Prometheus scrape / OTel pipeline wired, so
 * the lowest-friction, zero-infra channel is a single structured log line per
 * lifecycle transition with a stable event name and schema. Loki/Grafana can
 * then aggregate per provider × workflow (success rate, latency, throughput,
 * error class, fallback depth) via LogQL — without a metrics endpoint or
 * scrape config.
 *
 * Query example (LogQL):
 *   {app="generator"} | json | event="generator.metric.inference"
 *     | metric="failed"
 *
 * Keep this emit-only and side-effect free; it must never throw into the
 * execution path.
 */

export const INFERENCE_METRIC_EVENT = "generator.metric.inference";

export type InferenceMetricName =
	| "capacity_retry"
	| "failed"
	| "resubmitted"
	| "submitted"
	| "succeeded";

/**
 * Coarse error buckets so a dashboard can split failures by cause without
 * parsing free-text error summaries. Order matters: first match wins.
 */
export type InferenceErrorClass =
	| "cancelled"
	| "capacity"
	| "dead_slug"
	| "moderation"
	| "persist_failed"
	| "provider_error"
	| "stuck_queue"
	| "timeout"
	| "unknown";

export type InferenceProvider =
	| "civitai"
	| "fal"
	| "replicate"
	| "runpod"
	| "unknown";

export interface InferenceMetricEvent {
	/** Wall-clock since execution was created (terminal events). */
	durationMs?: number;
	/** Coarse failure bucket; only set for `failed`. */
	errorClass?: InferenceErrorClass;
	/** Workflow's expected duration, for latency-vs-baseline dashboards. */
	expectedMs?: number | null;
	metric: InferenceMetricName;
	provider: InferenceProvider;
	/** Time the job sat in the provider queue before this transition. */
	queueWaitMs?: number;
	status?: InferenceStatus;
	workflowKey: string;
}

const PROVIDER_PREFIXES: readonly [string, InferenceProvider][] = [
	["fal-", "fal"],
	["runpod-", "runpod"],
	["replicate-", "replicate"],
	["civitai-", "civitai"],
];

/**
 * Derive the provider from the workflow key prefix. The key is always present
 * on an execution and its prefix is the canonical provider grouping used
 * throughout the workflow registry, so this is more reliable than parsing the
 * provider-encoded endpoint id (which is absent until after submit).
 */
export function deriveProvider(workflowKey: string): InferenceProvider {
	for (const [prefix, provider] of PROVIDER_PREFIXES) {
		if (workflowKey.startsWith(prefix)) {
			return provider;
		}
	}
	return "unknown";
}

const ERROR_CLASS_MARKERS: readonly [RegExp, InferenceErrorClass][] = [
	[/cancelled by operator|cancelled/i, "cancelled"],
	[/failed to persist artifacts/i, "persist_failed"],
	[/stayed queued too long/i, "stuck_queue"],
	[/no capacity|capacity/i, "capacity"],
	[/timed out|timeout/i, "timeout"],
	[
		/no endpoints|is not a valid model|deprecated|request failed: 404/i,
		"dead_slug",
	],
	[/moderation|content (policy|violates)|nsfw|flagged/i, "moderation"],
];

/**
 * Bucket a free-text error summary into a coarse class for dashboards.
 * Returns "provider_error" for a non-empty unmatched summary and "unknown"
 * for an absent one.
 */
export function classifyInferenceError(
	summary: string | null | undefined
): InferenceErrorClass {
	if (!summary) {
		return "unknown";
	}
	for (const [pattern, cls] of ERROR_CLASS_MARKERS) {
		if (pattern.test(summary)) {
			return cls;
		}
	}
	return "provider_error";
}

export type InferenceMetricLogger = Pick<Console, "info">;

/**
 * Emit one structured metric line. Never throws — telemetry must not break the
 * execution path.
 */
export function emitInferenceMetric(
	logger: InferenceMetricLogger,
	event: InferenceMetricEvent
): void {
	try {
		logger.info(INFERENCE_METRIC_EVENT, event);
	} catch {
		// Swallow: a logging failure must never fail an execution.
	}
}
