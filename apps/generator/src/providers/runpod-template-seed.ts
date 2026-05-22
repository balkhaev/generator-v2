import { db } from "@generator/db";
import {
	runpodNetworkVolume,
	runpodPodTemplate,
	runpodPodTemplateVolume,
} from "@generator/db/schema/runpod";
import { count } from "drizzle-orm";

type Db = typeof db;

interface SeedSummary {
	createdTemplates: string[];
	createdVolumes: string[];
}

interface VolumeEnvEntry {
	gpus: string[];
	id: string;
	label?: string;
}

function parseVolumesEnv(raw: string | undefined): VolumeEnvEntry[] {
	if (!raw?.trim()) {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) {
		return [];
	}
	const out: VolumeEnvEntry[] = [];
	for (const entry of parsed) {
		const candidate = entry as Partial<VolumeEnvEntry>;
		if (
			typeof candidate.id === "string" &&
			Array.isArray(candidate.gpus) &&
			candidate.gpus.length > 0
		) {
			out.push({
				gpus: candidate.gpus,
				id: candidate.id,
				label:
					typeof candidate.label === "string" ? candidate.label : undefined,
			});
		}
	}
	return out;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInt(
	value: string | undefined,
	fallback: number
): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function generateId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

/**
 * PostgreSQL "undefined_table" SQLSTATE. Возникает когда generator стартует
 * раньше чем db-migrate накатил миграцию 0016 (например после redeploy
 * под нагрузкой, когда параллельные билды лезут в общий runner). Trat'им
 * это как ожидаемое состояние: generator работает поверх env-defaults
 * до следующего restart, чтобы upgrade order не блокировал прод.
 */
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

async function seedFooocusTemplate(
	database: Db,
	summary: SeedSummary,
	fooocusEndpointId: string
): Promise<void> {
	const id = generateId("runpod_tpl");
	const inserted = await database
		.insert(runpodPodTemplate)
		.values({
			defaultEnv: {},
			description: "Seeded from RUNPOD_FOOOCUS_ENDPOINT_ID env",
			enabled: "true",
			gpuTypeIds: [],
			id,
			mode: "serverless",
			name: "Fooocus SDXL (env-seeded)",
			runpodEndpointId: fooocusEndpointId,
			workflowKey: "fooocus-sdxl",
		})
		.onConflictDoNothing({ target: runpodPodTemplate.name })
		.returning({ id: runpodPodTemplate.id });
	if (inserted[0]) {
		summary.createdTemplates.push(inserted[0].id);
	}
}

async function seedLtxPodTemplate(
	database: Db,
	logger: Pick<Console, "info" | "warn">,
	summary: SeedSummary,
	ltxTemplateId: string,
	ltxVolumes: VolumeEnvEntry[]
): Promise<boolean> {
	const podTemplateId = generateId("runpod_tpl");
	const inserted = await database
		.insert(runpodPodTemplate)
		.values({
			cloudType:
				process.env.RUNPOD_LTX23_POD_CLOUD_TYPE === "COMMUNITY"
					? "COMMUNITY"
					: "SECURE",
			containerDiskInGb: readPositiveInt(
				process.env.RUNPOD_LTX23_POD_CONTAINER_DISK_GB,
				15
			),
			defaultEnv: {},
			description: "Seeded from RUNPOD_LTX23_POD_* env",
			enabled: "true",
			gpuTypeIds: [],
			id: podTemplateId,
			imageName:
				process.env.RUNPOD_LTX23_POD_IMAGE_NAME?.trim() ||
				"ls250824/run-comfyui-ltx:28042026",
			keepAliveMs: readNonNegativeInt(
				process.env.RUNPOD_LTX23_POD_KEEP_ALIVE_MS,
				10 * 60 * 1000
			),
			mode: "pod",
			name: "LTX 2.3 video (env-seeded)",
			runpodTemplateId: ltxTemplateId,
			timeoutMs: readPositiveInt(
				process.env.RUNPOD_LTX23_POD_TIMEOUT_MS,
				60 * 60 * 1000
			),
			volumeInGb: readPositiveInt(process.env.RUNPOD_LTX23_POD_VOLUME_GB, 90),
			workflowKey: "ltx-2-3-video",
		})
		.onConflictDoNothing({ target: runpodPodTemplate.name })
		.returning({ id: runpodPodTemplate.id });
	if (!inserted[0]) {
		logger.warn?.("generator.runpod.seed.ltx-template-already-exists", {
			name: "LTX 2.3 video (env-seeded)",
		});
		return false;
	}
	const resolvedPodTemplateId = inserted[0].id;
	summary.createdTemplates.push(resolvedPodTemplateId);

	const volumeIds: string[] = [];
	for (const [index, entry] of ltxVolumes.entries()) {
		const id = generateId("runpod_vol");
		await database.insert(runpodNetworkVolume).values({
			datacenter: "unknown",
			description: "Seeded from RUNPOD_LTX23_POD_NETWORK_VOLUMES env",
			gpuTypeIds: entry.gpus,
			id,
			name:
				entry.label?.trim() ||
				`LTX volume ${index + 1} (${entry.id.slice(0, 8)})`,
			runpodVolumeId: entry.id,
			sizeGb: 0,
		});
		summary.createdVolumes.push(id);
		volumeIds.push(id);
	}
	await database.insert(runpodPodTemplateVolume).values(
		volumeIds.map((volumeId, index) => ({
			podTemplateId: resolvedPodTemplateId,
			priority: index,
			volumeId,
		}))
	);
	return true;
}

/**
 * One-shot seed admin-managed RunPod templates с env-конфига если БД пуста.
 *
 * Идемпотентен: если в `runpod_pod_template` уже есть хотя бы одна запись —
 * сразу выходим. Это значит что после первого старта с env админка
 * становится source-of-truth, и удаление env-переменных не сломает кластер.
 *
 * Запускать на старте generator-процесса перед `loadRunpodWorkflowsFromDb`.
 */
export async function seedRunpodTemplatesFromEnv(
	options: { database?: Db; logger?: Pick<Console, "info" | "warn"> } = {}
): Promise<SeedSummary | null> {
	const database = options.database ?? db;
	const logger = options.logger ?? console;

	let templateCount = 0;
	try {
		const rows = await database
			.select({ templateCount: count() })
			.from(runpodPodTemplate);
		templateCount = rows[0]?.templateCount ?? 0;
	} catch (error) {
		if (isMissingTableError(error)) {
			logger.warn?.("generator.runpod.seed.skipped.migration-pending", {
				message: "runpod_pod_template table is missing — skipping seed",
			});
			return null;
		}
		throw error;
	}

	if (templateCount > 0) {
		return null;
	}

	const summary: SeedSummary = {
		createdTemplates: [],
		createdVolumes: [],
	};

	const fooocusEndpointId = process.env.RUNPOD_FOOOCUS_ENDPOINT_ID?.trim();
	if (fooocusEndpointId) {
		await seedFooocusTemplate(database, summary, fooocusEndpointId);
	}

	const ltxTemplateId =
		process.env.RUNPOD_LTX23_POD_TEMPLATE_ID?.trim() || "p4f6rm9tb4";
	const ltxVolumes = parseVolumesEnv(
		process.env.RUNPOD_LTX23_POD_NETWORK_VOLUMES
	);
	if (ltxTemplateId && ltxVolumes.length > 0) {
		const seeded = await seedLtxPodTemplate(
			database,
			logger,
			summary,
			ltxTemplateId,
			ltxVolumes
		);
		if (!seeded && summary.createdTemplates.length === 0) {
			return null;
		}
	}

	if (summary.createdTemplates.length === 0) {
		return null;
	}
	logger.info?.("generator.runpod.seed.completed", summary);
	return summary;
}
