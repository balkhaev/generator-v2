import { db } from "@generator/db";
import { asc, eq, inArray } from "@generator/db/operators";
import {
	runpodNetworkVolume,
	runpodPodTemplate,
	runpodPodTemplateVolume,
} from "@generator/db/schema/runpod";
import {
	type AnyWorkflowDefinition,
	createFluxDevDetailerServerlessWorkflow,
	createFluxDevImageServerlessWorkflow,
	createFooocusSdxlWorkflow,
	createLtx23VideoServerlessWorkflow,
	createLtx23VideoWorkflow,
	createTtsServerlessWorkflow,
	createWanVideoServerlessWorkflow,
} from "@generator/runpod";

type Db = typeof db;

interface VolumeRow {
	gpuTypeIds: string[];
	id: string;
	name: string;
	priority: number;
	runpodVolumeId: string;
}

interface LoadedTemplate {
	cloudType: string | null;
	containerDiskInGb: number | null;
	gpuTypeIds: string[];
	id: string;
	imageName: string | null;
	keepAliveMs: number | null;
	mode: "pod" | "serverless";
	name: string;
	runpodEndpointId: string | null;
	runpodTemplateId: string | null;
	timeoutMs: number | null;
	volumeInGb: number | null;
	volumes: VolumeRow[];
	workflowKey: string;
}

/**
 * Generator на старте сборки `RunpodService` читает реестр admin-managed
 * RunPod template'ов из БД и собирает массив `AnyWorkflowDefinition` для
 * `createRunpodService`. Если БД пуста — fallback на env-defaults
 * (см. `buildEnvDefaultWorkflows`), чтобы deploy без БД-сидов не сломался.
 *
 * Текущая семантика registry:
 * - Один enabled template на `workflow_key` → instance id = workflow_key
 *   (например, единственный LTX template регистрируется как
 *   `ltx-2-3-video`, и Studio payload с `__runpodWorkflow="ltx-2-3-video"`
 *   работает без изменений на стороне Studio).
 * - Несколько enabled template'ов на тот же `workflow_key` — берём первый
 *   по `created_at asc`; остальные логируем и пропускаем. Per-scenario
 *   маршрутизация — отдельная итерация.
 */
/** PostgreSQL "undefined_table" — generator стартовал до db-migrate. */
const PG_UNDEFINED_TABLE_CODE = "42P01";

function isMissingTableError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const candidate = error as { cause?: unknown; code?: unknown };
	if (candidate.code === PG_UNDEFINED_TABLE_CODE) {
		return true;
	}
	if (candidate.cause) {
		return isMissingTableError(candidate.cause);
	}
	return false;
}

export async function loadRunpodWorkflowsFromDb(
	options: { database?: Db; logger?: Pick<Console, "info" | "warn"> } = {}
): Promise<AnyWorkflowDefinition[]> {
	const database = options.database ?? db;
	const logger = options.logger ?? console;

	let templates: LoadedTemplate[];
	try {
		templates = await loadEnabledTemplates(database);
	} catch (error) {
		if (isMissingTableError(error)) {
			logger.warn?.("generator.runpod.loader.skipped.migration-pending", {
				message: "runpod tables are missing — falling back to env-defaults",
			});
			return [];
		}
		throw error;
	}
	if (templates.length === 0) {
		return [];
	}

	const firstPerKey = pickFirstPerWorkflowKey(templates, logger);
	const workflows: AnyWorkflowDefinition[] = [];
	for (const tpl of firstPerKey) {
		const workflow = buildWorkflowFromTemplate(tpl, logger);
		if (workflow) {
			workflows.push(workflow);
		}
		// Детейлер сидится «бесплатно» поверх flux-template: тот же endpoint и
		// модель, отдельный граф (img2img upscale+detail). Отдельного template
		// в БД не требует.
		if (tpl.workflowKey === "flux-dev-image") {
			const detailer = buildFluxDevDetailerServerlessWorkflow(tpl, logger);
			if (detailer) {
				workflows.push(detailer);
			}
		}
	}
	return workflows;
}

async function loadEnabledTemplates(database: Db): Promise<LoadedTemplate[]> {
	const rows = await database
		.select()
		.from(runpodPodTemplate)
		.where(eq(runpodPodTemplate.enabled, "true"))
		.orderBy(asc(runpodPodTemplate.createdAt));
	if (rows.length === 0) {
		return [];
	}
	const volumesByTemplate = await loadVolumesByTemplate(
		database,
		rows.map((row) => row.id)
	);
	return rows.map((row) => ({
		cloudType: row.cloudType,
		containerDiskInGb: row.containerDiskInGb,
		gpuTypeIds: row.gpuTypeIds,
		id: row.id,
		imageName: row.imageName,
		keepAliveMs: row.keepAliveMs,
		mode: row.mode as "pod" | "serverless",
		name: row.name,
		runpodEndpointId: row.runpodEndpointId,
		runpodTemplateId: row.runpodTemplateId,
		timeoutMs: row.timeoutMs,
		volumeInGb: row.volumeInGb,
		volumes: volumesByTemplate.get(row.id) ?? [],
		workflowKey: row.workflowKey,
	}));
}

async function loadVolumesByTemplate(
	database: Db,
	templateIds: string[]
): Promise<Map<string, VolumeRow[]>> {
	if (templateIds.length === 0) {
		return new Map();
	}
	const rows = await database
		.select({
			gpuTypeIds: runpodNetworkVolume.gpuTypeIds,
			id: runpodNetworkVolume.id,
			name: runpodNetworkVolume.name,
			podTemplateId: runpodPodTemplateVolume.podTemplateId,
			priority: runpodPodTemplateVolume.priority,
			runpodVolumeId: runpodNetworkVolume.runpodVolumeId,
		})
		.from(runpodPodTemplateVolume)
		.innerJoin(
			runpodNetworkVolume,
			eq(runpodNetworkVolume.id, runpodPodTemplateVolume.volumeId)
		)
		.where(inArray(runpodPodTemplateVolume.podTemplateId, templateIds))
		.orderBy(asc(runpodPodTemplateVolume.priority));
	const grouped = new Map<string, VolumeRow[]>();
	for (const row of rows) {
		const entry: VolumeRow = {
			gpuTypeIds: row.gpuTypeIds,
			id: row.id,
			name: row.name,
			priority: row.priority,
			runpodVolumeId: row.runpodVolumeId,
		};
		const bucket = grouped.get(row.podTemplateId);
		if (bucket) {
			bucket.push(entry);
		} else {
			grouped.set(row.podTemplateId, [entry]);
		}
	}
	return grouped;
}

function pickFirstPerWorkflowKey(
	templates: LoadedTemplate[],
	logger: Pick<Console, "info" | "warn">
): LoadedTemplate[] {
	const byKey = new Map<string, LoadedTemplate>();
	for (const tpl of templates) {
		const existing = byKey.get(tpl.workflowKey);
		if (existing) {
			logger.warn?.("runpod.template-loader.duplicate-workflow-key", {
				ignoredTemplateId: tpl.id,
				usedTemplateId: existing.id,
				workflowKey: tpl.workflowKey,
			});
			continue;
		}
		byKey.set(tpl.workflowKey, tpl);
	}
	return Array.from(byKey.values());
}

function buildWorkflowFromTemplate(
	tpl: LoadedTemplate,
	logger: Pick<Console, "info" | "warn">
): AnyWorkflowDefinition | null {
	if (tpl.workflowKey === "fooocus-sdxl") {
		return buildFooocusWorkflow(tpl, logger);
	}
	if (tpl.workflowKey === "ltx-2-3-video") {
		return buildLtx23Workflow(tpl, logger);
	}
	if (tpl.workflowKey === "wan-2-2-video") {
		return buildWan22ServerlessWorkflow(tpl, logger);
	}
	if (tpl.workflowKey === "flux-dev-image") {
		return buildFluxDevImageServerlessWorkflow(tpl, logger);
	}
	if (tpl.workflowKey === "tts-voxcpm" || tpl.workflowKey === "tts-higgs") {
		return buildTtsServerlessWorkflow(tpl, logger);
	}
	logger.warn?.("runpod.template-loader.unknown-workflow-key", {
		templateId: tpl.id,
		workflowKey: tpl.workflowKey,
	});
	return null;
}

function buildFooocusWorkflow(
	tpl: LoadedTemplate,
	logger: Pick<Console, "info" | "warn">
): AnyWorkflowDefinition | null {
	if (tpl.mode !== "serverless") {
		logger.warn?.("runpod.template-loader.fooocus-not-serverless", {
			mode: tpl.mode,
			templateId: tpl.id,
		});
		return null;
	}
	if (!tpl.runpodEndpointId) {
		logger.warn?.("runpod.template-loader.fooocus-missing-endpoint", {
			templateId: tpl.id,
		});
		return null;
	}
	return createFooocusSdxlWorkflow({
		enableWarmup:
			process.env.RUNPOD_FOOOCUS_ENABLE_WARMUP?.toLowerCase() === "true",
		endpointId: tpl.runpodEndpointId,
		id: "fooocus-sdxl",
		webhookUrl: process.env.RUNPOD_FOOOCUS_WEBHOOK_URL?.trim() || undefined,
	});
}

function buildLtx23Workflow(
	tpl: LoadedTemplate,
	logger: Pick<Console, "info" | "warn">
): AnyWorkflowDefinition | null {
	if (tpl.mode === "serverless") {
		return buildLtx23ServerlessWorkflow(tpl, logger);
	}
	if (!tpl.runpodTemplateId) {
		logger.warn?.("runpod.template-loader.ltx-missing-template", {
			templateId: tpl.id,
		});
		return null;
	}
	if (tpl.volumes.length === 0) {
		logger.warn?.("runpod.template-loader.ltx-missing-volumes", {
			templateId: tpl.id,
		});
		return null;
	}
	return createLtx23VideoWorkflow({
		id: "ltx-2-3-video",
		pod: {
			cloudType: tpl.cloudType === "COMMUNITY" ? "COMMUNITY" : "SECURE",
			containerDiskInGb: tpl.containerDiskInGb ?? 15,
			imageName: tpl.imageName ?? "ls250824/run-comfyui-ltx:28042026",
			keepAliveMs: tpl.keepAliveMs ?? 10 * 60 * 1000,
			namePrefix: "ltx23",
			networkVolumes: tpl.volumes.map((vol) => ({
				gpuTypeIds: vol.gpuTypeIds,
				label: vol.name,
				networkVolumeId: vol.runpodVolumeId,
			})),
			templateId: tpl.runpodTemplateId,
			timeoutMs: tpl.timeoutMs ?? 60 * 60 * 1000,
			volumeInGb: tpl.volumeInGb ?? 90,
		},
	});
}

function buildLtx23ServerlessWorkflow(
	tpl: LoadedTemplate,
	logger: Pick<Console, "info" | "warn">
): AnyWorkflowDefinition | null {
	if (!tpl.runpodEndpointId) {
		logger.warn?.("runpod.template-loader.ltx-serverless-missing-endpoint", {
			templateId: tpl.id,
		});
		return null;
	}
	return createLtx23VideoServerlessWorkflow({
		baseModelFilename:
			process.env.RUNPOD_LTX23_SERVERLESS_BASE_MODEL?.trim() || undefined,
		distillLoraFilename:
			process.env.RUNPOD_LTX23_SERVERLESS_DISTILL_LORA?.trim() || undefined,
		// Второй (spatial upscale) pass включён по умолчанию — нужен апскейлер
		// на volume (seed-ltx-aux-models.ts). Выключить аварийно:
		// RUNPOD_LTX23_DISABLE_SPATIAL_UPSCALE=true.
		enableSpatialUpscale:
			process.env.RUNPOD_LTX23_DISABLE_SPATIAL_UPSCALE !== "true",
		enableWarmup: process.env.RUNPOD_LTX23_ENABLE_WARMUP !== "false",
		endpointId: tpl.runpodEndpointId,
		id: "ltx-2-3-video",
		webhookUrl: process.env.RUNPOD_LTX23_WEBHOOK_URL?.trim() || undefined,
	});
}

function buildWan22ServerlessWorkflow(
	tpl: LoadedTemplate,
	logger: Pick<Console, "info" | "warn">
): AnyWorkflowDefinition | null {
	if (tpl.mode !== "serverless") {
		logger.warn?.("runpod.template-loader.wan-not-serverless", {
			mode: tpl.mode,
			templateId: tpl.id,
		});
		return null;
	}
	if (!tpl.runpodEndpointId) {
		logger.warn?.("runpod.template-loader.wan-serverless-missing-endpoint", {
			templateId: tpl.id,
		});
		return null;
	}
	return createWanVideoServerlessWorkflow({
		accelLoraHighFilename:
			process.env.RUNPOD_WAN22_ACCEL_LORA_HIGH?.trim() || undefined,
		accelLoraLowFilename:
			process.env.RUNPOD_WAN22_ACCEL_LORA_LOW?.trim() || undefined,
		enableWarmup: process.env.RUNPOD_WAN22_ENABLE_WARMUP !== "false",
		endpointId: tpl.runpodEndpointId,
		highNoiseModelFilename:
			process.env.RUNPOD_WAN22_HIGH_NOISE_MODEL?.trim() || undefined,
		id: "wan-2-2-video",
		lowNoiseModelFilename:
			process.env.RUNPOD_WAN22_LOW_NOISE_MODEL?.trim() || undefined,
		textEncoderFilename:
			process.env.RUNPOD_WAN22_TEXT_ENCODER?.trim() || undefined,
		vaeFilename: process.env.RUNPOD_WAN22_VAE?.trim() || undefined,
		webhookUrl: process.env.RUNPOD_WAN22_WEBHOOK_URL?.trim() || undefined,
	});
}

function buildFluxDevImageServerlessWorkflow(
	tpl: LoadedTemplate,
	logger: Pick<Console, "info" | "warn">
): AnyWorkflowDefinition | null {
	if (tpl.mode !== "serverless") {
		logger.warn?.("runpod.template-loader.flux-not-serverless", {
			mode: tpl.mode,
			templateId: tpl.id,
		});
		return null;
	}
	if (!tpl.runpodEndpointId) {
		logger.warn?.("runpod.template-loader.flux-serverless-missing-endpoint", {
			templateId: tpl.id,
		});
		return null;
	}
	return createFluxDevImageServerlessWorkflow({
		checkpointFilename:
			process.env.RUNPOD_FLUX_DEV_CHECKPOINT?.trim() || undefined,
		enableWarmup: process.env.RUNPOD_FLUX_DEV_ENABLE_WARMUP === "true",
		endpointId: tpl.runpodEndpointId,
		id: "flux-dev-image",
		webhookUrl: process.env.RUNPOD_FLUX_DEV_WEBHOOK_URL?.trim() || undefined,
	});
}

function buildTtsServerlessWorkflow(
	tpl: LoadedTemplate,
	logger: Pick<Console, "info" | "warn">
): AnyWorkflowDefinition | null {
	if (tpl.mode !== "serverless") {
		logger.warn?.("runpod.template-loader.tts-not-serverless", {
			mode: tpl.mode,
			templateId: tpl.id,
		});
		return null;
	}
	if (!tpl.runpodEndpointId) {
		logger.warn?.("runpod.template-loader.tts-serverless-missing-endpoint", {
			templateId: tpl.id,
		});
		return null;
	}
	return createTtsServerlessWorkflow({
		endpointId: tpl.runpodEndpointId,
		id: tpl.workflowKey,
		webhookUrl: process.env.RUNPOD_TTS_WEBHOOK_URL?.trim() || undefined,
	});
}

function buildFluxDevDetailerServerlessWorkflow(
	tpl: LoadedTemplate,
	logger: Pick<Console, "info" | "warn">
): AnyWorkflowDefinition | null {
	if (tpl.mode !== "serverless" || !tpl.runpodEndpointId) {
		logger.warn?.("runpod.template-loader.detailer-skipped", {
			mode: tpl.mode,
			templateId: tpl.id,
		});
		return null;
	}
	return createFluxDevDetailerServerlessWorkflow({
		checkpointFilename:
			process.env.RUNPOD_FLUX_DEV_CHECKPOINT?.trim() || undefined,
		endpointId: tpl.runpodEndpointId,
		id: "flux-dev-detailer",
		webhookUrl: process.env.RUNPOD_FLUX_DEV_WEBHOOK_URL?.trim() || undefined,
	});
}
