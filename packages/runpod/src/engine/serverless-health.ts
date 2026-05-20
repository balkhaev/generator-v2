import type { ServerlessEndpointHealth } from "../api/serverless";

export type ServerlessHealthSeverity = "info" | "warning" | "critical";

export interface ServerlessHealthFinding {
	code: ServerlessHealthCode;
	message: string;
	recommendation: string;
	severity: ServerlessHealthSeverity;
}

export type ServerlessHealthCode =
	| "no-active-workers"
	| "scale-out-stalled"
	| "throttled-capacity"
	| "unhealthy-workers"
	| "queue-backlog"
	| "no-recent-jobs"
	| "healthy";

export interface ServerlessHealthAssessment {
	findings: ServerlessHealthFinding[];
	healthy: boolean;
	maxSeverity: ServerlessHealthSeverity;
}

const QUEUE_BACKLOG_WARNING_THRESHOLD = 5;

/**
 * Снимает `/health` snapshot и переводит его в actionable findings.
 *
 * Главная цель — поймать «неправильно настроенный endpoint» до того, как
 * пользователь словит cold-start или throttle:
 *
 * - `no-active-workers`: ни один worker не warm. Если endpoint должен
 *   обслуживать realtime трафик — поднять `min workers ≥ 1` в RunPod
 *   console (FlashBoot сократит cold start, но не уберёт его полностью).
 * - `throttled-capacity`: RunPod не может удержать запрошенное число
 *   worker'ов; нужно расширить GPU priority list или дата-центры.
 * - `unhealthy-workers`: worker'ы помечены как unhealthy — почти
 *   гарантированно баг handler'а или OOM на старте. Смотреть RunPod logs.
 * - `scale-out-stalled`: jobs.inQueue > 0, но workers.idle == 0 и
 *   initializing == 0. RunPod не масштабируется; проверить max workers /
 *   billing / capacity.
 * - `queue-backlog`: накопилась очередь, но воркеры есть — может означать,
 *   что handler медленный или `scalerValue` слишком высокий.
 */
export function assessEndpointHealth(
	health: ServerlessEndpointHealth
): ServerlessHealthAssessment {
	const findings: ServerlessHealthFinding[] = [];
	const warmWorkers =
		health.workers.idle + health.workers.initializing + health.workers.ready;

	if (warmWorkers === 0) {
		findings.push({
			code: "no-active-workers",
			message:
				"Endpoint has zero warm/idle workers. Next request will pay full cold-start cost.",
			recommendation:
				"Set `min workers >= 1` (and keep FlashBoot enabled) in the RunPod endpoint configuration. " +
				"For burst-heavy workflows, scaler type = Request count with value 1.",
			severity: "warning",
		});
	}

	if (health.workers.unhealthy > 0) {
		findings.push({
			code: "unhealthy-workers",
			message: `${health.workers.unhealthy} worker(s) reported as unhealthy.`,
			recommendation:
				"Inspect RunPod worker logs — typically caused by handler crash, OOM during initialisation, " +
				"or missing model files on the worker image.",
			severity: "critical",
		});
	}

	if (health.workers.throttled > 0) {
		findings.push({
			code: "throttled-capacity",
			message: `${health.workers.throttled} worker slot(s) throttled by RunPod (no GPU capacity).`,
			recommendation:
				"Widen the GPU priority list (specify 2-3 GPU types) and/or allow more data centers in the endpoint settings.",
			severity: "warning",
		});
	}

	if (
		health.jobs.inQueue > 0 &&
		health.workers.idle === 0 &&
		health.workers.initializing === 0
	) {
		findings.push({
			code: "scale-out-stalled",
			message: `Queue has ${health.jobs.inQueue} job(s) but no worker is initializing.`,
			recommendation:
				"Check `max workers` budget cap and RunPod capacity. If max is already reached, raise it or rely on " +
				"queue depth scaler with a smaller scalerValue to scale out faster.",
			severity: "critical",
		});
	}

	if (
		health.jobs.inQueue >= QUEUE_BACKLOG_WARNING_THRESHOLD &&
		health.workers.idle === 0
	) {
		findings.push({
			code: "queue-backlog",
			message: `Queue depth ${health.jobs.inQueue} jobs with no idle workers — handler may be the bottleneck.`,
			recommendation:
				"Profile the handler, consider concurrent handlers (single worker handling multiple requests), " +
				"or lower scalerValue if using Request count scaler.",
			severity: "warning",
		});
	}

	if (findings.length === 0) {
		findings.push({
			code: "healthy",
			message: "Endpoint configuration looks healthy.",
			recommendation: "No action required.",
			severity: "info",
		});
	}

	const maxSeverity = findings.reduce<ServerlessHealthSeverity>(
		(acc, finding) => {
			if (finding.severity === "critical") {
				return "critical";
			}
			if (finding.severity === "warning" && acc !== "critical") {
				return "warning";
			}
			return acc;
		},
		"info"
	);

	return {
		findings,
		healthy: maxSeverity === "info",
		maxSeverity,
	};
}
