import {
	isActivePersonLoraTrainingStatus,
	type PersonLoraTrainingMeta,
	type PersonRecord,
	readPersonLoraTrainingMeta,
} from "@generator/contracts/persons";
import { type IdempotencyLock, withIdempotency } from "@generator/queue";

import type { PersonsApiClient } from "@/clients/persons-api";
import type { FalZibLoraTrainingRunner } from "@/providers/fal-zib-lora-training";
import type { RunpodPodLoraTrainingRunner } from "@/providers/runpod-pod-lora-training";

/**
 * Number of milliseconds without any training event after which we consider a
 * polling-phase training run abandoned and try to resume it. Tuned to be
 * comfortably larger than the fal polling interval (30s) plus one network
 * round-trip's worth of jitter, but small enough that a deploy-induced gap is
 * caught on the very next worker boot.
 */
const STALENESS_THRESHOLD_MS = 3 * 60 * 1000;

const DEFAULT_REFERENCE_IMAGE_TARGET_COUNT = 20;

export interface TrainingRecoveryDeps {
	client: PersonsApiClient;
	logger?: Pick<Console, "error" | "info" | "warn">;
	now?: () => number;
	recoveryLock: IdempotencyLock;
	runner: Pick<FalZibLoraTrainingRunner, "resumeFromProviderJob">;
	runpodPodRunner?: Pick<
		RunpodPodLoraTrainingRunner,
		"prepareDataset" | "resumeFromProviderJob"
	> | null;
	stalenessThresholdMs?: number;
}

export interface TrainingRecoverySummary {
	attempted: number;
	failed: number;
	recovered: number;
	skipped: number;
}

type RecoveryProvider = "fal" | "runpod-pod";

interface RecoveryCandidate {
	datasetUrl: string | null;
	debugCorrelationId?: string;
	genderHint: string | null;
	lastEventAt: string;
	loraS3Key: string | null;
	outputName: string;
	personId: string;
	personSlug: string;
	provider: RecoveryProvider;
	providerJobId: string;
	referenceImageCount: number;
	referenceImageTargetCount: number;
	referenceImageUrls: string[];
	trainingRunId: string;
	trainingStartedAt: string;
	trainingSteps: number;
	triggerWord: string;
}

/**
 * Recovery candidate for the dataset-prep stage (status `generating` /
 * `awaiting-approval`, phase `generating-references`). Distinct from
 * `RecoveryCandidate` because at this point there's no providerJobId yet —
 * we just need to re-invoke `prepareDataset` so the runner finishes
 * generating the remaining variants up to `referenceImageTargetCount`.
 */
interface PrepRecoveryCandidate {
	debugCorrelationId?: string;
	description: string;
	lastEventAt: string;
	outputName: string | null;
	personId: string;
	personName: string;
	personSlug: string;
	referencePhotoUrl: string;
	trainingRunId: string;
	triggerWord: string | null;
}

function readDebugString(
	debug: Record<string, unknown> | undefined,
	key: string
): string | null {
	if (!debug) {
		return null;
	}
	const value = debug[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function resumableProvider(
	training: PersonLoraTrainingMeta
): RecoveryProvider | null {
	if (training.provider === "fal") {
		return "fal";
	}
	if (training.provider === "runpod-pod") {
		return "runpod-pod";
	}
	return null;
}

function isResumableTraining(
	training: PersonLoraTrainingMeta
): RecoveryProvider | null {
	const provider = resumableProvider(training);
	if (!provider) {
		return null;
	}
	if (!isActivePersonLoraTrainingStatus(training.status)) {
		return null;
	}
	if (training.status !== "training" && training.status !== "publishing") {
		return null;
	}
	if (training.phase === "cancelled" || training.cancelledAt) {
		return null;
	}
	return provider;
}

interface ResumableFields {
	outputName: string;
	providerJobId: string;
	trainingRunId: string;
	trainingStartedAt: string;
	trainingSteps: number;
	triggerWord: string;
}

function extractResumableFields(
	training: PersonLoraTrainingMeta
): ResumableFields | null {
	const providerJobId = training.providerJobId ?? null;
	const trainingRunId = training.trainingRunId ?? null;
	const triggerWord = training.triggerWord ?? null;
	const outputName = training.outputName ?? null;
	const trainingStartedAt = training.trainingStartedAt ?? null;
	const trainingSteps = training.trainingSteps ?? null;

	if (
		!(
			providerJobId &&
			trainingRunId &&
			triggerWord &&
			outputName &&
			trainingStartedAt &&
			typeof trainingSteps === "number" &&
			trainingSteps > 0
		)
	) {
		return null;
	}

	return {
		outputName,
		providerJobId,
		trainingRunId,
		trainingStartedAt,
		trainingSteps,
		triggerWord,
	};
}

function isStaleEnough(
	lastEventAt: string,
	nowMs: number,
	stalenessMs: number
): boolean {
	const lastEventMs = Date.parse(lastEventAt);
	if (!Number.isFinite(lastEventMs)) {
		return false;
	}
	return nowMs - lastEventMs >= stalenessMs;
}

/**
 * Detect a stalled dataset-prep run on the runpod-pod runner. We only resume
 * the main `generating-references` phase here; mid-flight refills
 * (`refilling-references`) are intentionally skipped because we'd lose the
 * original `requestNonce`/variantId context and might double-publish a
 * regenerated photo. The operator can re-trigger a refill from the UI by
 * deleting the offending photo again.
 */
function pickPrepRecoveryCandidate(
	person: PersonRecord,
	training: PersonLoraTrainingMeta,
	nowMs: number,
	stalenessMs: number
): PrepRecoveryCandidate | null {
	if (training.provider !== "runpod-pod") {
		return null;
	}
	if (training.status !== "generating") {
		return null;
	}
	if (training.phase !== "generating-references") {
		return null;
	}
	if (training.cancelledAt) {
		return null;
	}
	const trainingRunId = training.trainingRunId ?? null;
	if (!trainingRunId) {
		return null;
	}
	const referencePhotoUrl = person.referencePhotoUrl;
	if (!referencePhotoUrl) {
		return null;
	}
	const lastEventAt = training.lastEventAt ?? training.requestedAt ?? null;
	if (!(lastEventAt && isStaleEnough(lastEventAt, nowMs, stalenessMs))) {
		return null;
	}

	return {
		debugCorrelationId:
			typeof training.debugCorrelationId === "string"
				? training.debugCorrelationId
				: undefined,
		description: person.description,
		lastEventAt,
		outputName: training.outputName ?? null,
		personId: person.id,
		personName: person.name,
		personSlug: person.slug,
		referencePhotoUrl,
		trainingRunId,
		triggerWord: training.triggerWord ?? null,
	};
}

function pickRecoveryCandidate(
	person: PersonRecord,
	training: PersonLoraTrainingMeta,
	nowMs: number,
	stalenessMs: number
): RecoveryCandidate | null {
	const provider = isResumableTraining(training);
	if (!provider) {
		return null;
	}

	const fields = extractResumableFields(training);
	if (!fields) {
		return null;
	}

	const lastEventAt = training.lastEventAt ?? fields.trainingStartedAt;
	if (!isStaleEnough(lastEventAt, nowMs, stalenessMs)) {
		return null;
	}

	const debug =
		training.debug && typeof training.debug === "object"
			? (training.debug as Record<string, unknown>)
			: undefined;

	return {
		datasetUrl: training.datasetUrl ?? null,
		debugCorrelationId:
			typeof training.debugCorrelationId === "string"
				? training.debugCorrelationId
				: undefined,
		genderHint: readDebugString(debug, "genderHint"),
		lastEventAt,
		loraS3Key: readDebugString(debug, "loraS3Key"),
		outputName: fields.outputName,
		personId: person.id,
		personSlug: person.slug,
		provider,
		providerJobId: fields.providerJobId,
		referenceImageCount: training.referenceImageCount ?? 0,
		referenceImageTargetCount:
			training.referenceImageTargetCount ??
			DEFAULT_REFERENCE_IMAGE_TARGET_COUNT,
		referenceImageUrls: Array.isArray(training.referenceImageUrls)
			? training.referenceImageUrls
			: [],
		trainingRunId: fields.trainingRunId,
		trainingStartedAt: fields.trainingStartedAt,
		trainingSteps: fields.trainingSteps,
		triggerWord: fields.triggerWord,
	};
}

async function tryResumePrep(
	candidate: PrepRecoveryCandidate,
	deps: TrainingRecoveryDeps,
	summary: TrainingRecoverySummary,
	logger: NonNullable<TrainingRecoveryDeps["logger"]>
): Promise<void> {
	const runner = deps.runpodPodRunner;
	if (!runner) {
		summary.skipped += 1;
		logger.warn("admin.recovery.prep-skipped", {
			personId: candidate.personId,
			reason: "runpod-pod runner not configured",
			trainingRunId: candidate.trainingRunId,
		});
		return;
	}

	summary.attempted += 1;
	try {
		const outcome = await withIdempotency(
			deps.recoveryLock,
			`prep:${candidate.trainingRunId}`,
			async () => {
				logger.info("admin.recovery.prep-resume-start", {
					lastEventAt: candidate.lastEventAt,
					personId: candidate.personId,
					personSlug: candidate.personSlug,
					trainingRunId: candidate.trainingRunId,
				});
				await runner.prepareDataset({
					debugCorrelationId: candidate.debugCorrelationId,
					description: candidate.description,
					mode: "prep-only",
					outputName: candidate.outputName ?? undefined,
					personId: candidate.personId,
					personName: candidate.personName,
					personSlug: candidate.personSlug,
					referencePhotoUrl: candidate.referencePhotoUrl,
					trainingRunId: candidate.trainingRunId,
					triggerWord: candidate.triggerWord ?? undefined,
				});
			}
		);

		if (outcome.acquired) {
			summary.recovered += 1;
			logger.info("admin.recovery.prep-resume-completed", {
				personId: candidate.personId,
				trainingRunId: candidate.trainingRunId,
			});
		} else {
			summary.skipped += 1;
			logger.info("admin.recovery.prep-resume-skipped", {
				personId: candidate.personId,
				reason: "another worker holds recovery lock",
				trainingRunId: candidate.trainingRunId,
			});
		}
	} catch (error) {
		summary.failed += 1;
		logger.error("admin.recovery.prep-resume-failed", {
			message: error instanceof Error ? error.message : "unknown",
			personId: candidate.personId,
			trainingRunId: candidate.trainingRunId,
		});
	}
}

/**
 * Scan all persons via persons-api and resume any fal training that has been
 * silent for longer than `stalenessThresholdMs`. Designed to run at admin
 * worker startup so a crash/redeploy cannot strand a fal job that has already
 * finished server-side.
 *
 * Concurrency safety:
 *   - Each candidate is gated by an idempotency lock keyed on `trainingRunId`,
 *     so multiple worker replicas booting at once will only resume each run
 *     once.
 *   - `applyLoraTrainingEvent` on the persons side ignores callbacks whose
 *     `trainingRunId` no longer matches the current run, so a recovery racing
 *     against a manually-triggered retrain will not corrupt state.
 */
export async function recoverInterruptedTrainings(
	deps: TrainingRecoveryDeps
): Promise<TrainingRecoverySummary> {
	const logger = deps.logger ?? console;
	const nowMs = deps.now?.() ?? Date.now();
	const stalenessMs = deps.stalenessThresholdMs ?? STALENESS_THRESHOLD_MS;

	const summary: TrainingRecoverySummary = {
		attempted: 0,
		failed: 0,
		recovered: 0,
		skipped: 0,
	};

	let persons: PersonRecord[];
	try {
		persons = await deps.client.listPersons();
	} catch (error) {
		logger.warn("admin.recovery.list-persons-failed", {
			message: error instanceof Error ? error.message : "unknown",
		});
		return summary;
	}

	for (const person of persons) {
		const training = readPersonLoraTrainingMeta(person);
		if (!training) {
			continue;
		}

		const prepCandidate = pickPrepRecoveryCandidate(
			person,
			training,
			nowMs,
			stalenessMs
		);
		if (prepCandidate) {
			await tryResumePrep(prepCandidate, deps, summary, logger);
			continue;
		}

		const candidate = pickRecoveryCandidate(
			person,
			training,
			nowMs,
			stalenessMs
		);
		if (!candidate) {
			continue;
		}
		await tryResumeProviderJob(candidate, deps, summary, logger);
	}

	logger.info("admin.recovery.summary", summary);
	return summary;
}

async function tryResumeProviderJob(
	candidate: RecoveryCandidate,
	deps: TrainingRecoveryDeps,
	summary: TrainingRecoverySummary,
	logger: NonNullable<TrainingRecoveryDeps["logger"]>
): Promise<void> {
	if (candidate.provider === "runpod-pod" && !deps.runpodPodRunner) {
		summary.skipped += 1;
		logger.warn("admin.recovery.resume-skipped", {
			personId: candidate.personId,
			reason: "runpod-pod runner not configured",
			trainingRunId: candidate.trainingRunId,
		});
		return;
	}

	summary.attempted += 1;
	try {
		const outcome = await withIdempotency(
			deps.recoveryLock,
			candidate.trainingRunId,
			async () => {
				logger.info("admin.recovery.resume-start", {
					lastEventAt: candidate.lastEventAt,
					personId: candidate.personId,
					personSlug: candidate.personSlug,
					provider: candidate.provider,
					providerJobId: candidate.providerJobId,
					trainingRunId: candidate.trainingRunId,
				});
				if (candidate.provider === "runpod-pod") {
					const runner = deps.runpodPodRunner;
					if (!runner) {
						throw new Error(
							"runpod-pod runner is not configured; recovery cannot proceed"
						);
					}
					await runner.resumeFromProviderJob({
						debugCorrelationId: candidate.debugCorrelationId,
						loraS3Key: candidate.loraS3Key ?? undefined,
						outputName: candidate.outputName,
						personId: candidate.personId,
						personSlug: candidate.personSlug,
						providerJobId: candidate.providerJobId,
						referenceImageCount: candidate.referenceImageCount,
						referenceImageTargetCount: candidate.referenceImageTargetCount,
						referenceImageUrls: candidate.referenceImageUrls,
						trainingRunId: candidate.trainingRunId,
						trainingStartedAt: candidate.trainingStartedAt,
						trainingSteps: candidate.trainingSteps,
						triggerWord: candidate.triggerWord,
					});
					return;
				}
				await deps.runner.resumeFromProviderJob({
					datasetUrl: candidate.datasetUrl,
					debugCorrelationId: candidate.debugCorrelationId,
					genderHint: candidate.genderHint,
					outputName: candidate.outputName,
					personId: candidate.personId,
					personSlug: candidate.personSlug,
					providerJobId: candidate.providerJobId,
					referenceImageCount: candidate.referenceImageCount,
					referenceImageTargetCount: candidate.referenceImageTargetCount,
					referenceImageUrls: candidate.referenceImageUrls,
					trainingRunId: candidate.trainingRunId,
					trainingStartedAt: candidate.trainingStartedAt,
					trainingSteps: candidate.trainingSteps,
					triggerWord: candidate.triggerWord,
				});
			}
		);

		if (outcome.acquired) {
			summary.recovered += 1;
			logger.info("admin.recovery.resume-completed", {
				personId: candidate.personId,
				trainingRunId: candidate.trainingRunId,
			});
		} else {
			summary.skipped += 1;
			logger.info("admin.recovery.resume-skipped", {
				personId: candidate.personId,
				reason: "another worker holds recovery lock",
				trainingRunId: candidate.trainingRunId,
			});
		}
	} catch (error) {
		summary.failed += 1;
		logger.error("admin.recovery.resume-failed", {
			message: error instanceof Error ? error.message : "unknown",
			personId: candidate.personId,
			trainingRunId: candidate.trainingRunId,
		});
	}
}
