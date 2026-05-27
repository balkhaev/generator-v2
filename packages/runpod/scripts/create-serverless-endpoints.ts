/* biome-ignore-all lint/suspicious/noConsole: setup script reports human-readable timeline */
// Marker export to force TS to treat this file as an ES module.
export {};

/**
 * Идемпотентно создаёт RunPod template + serverless endpoint для
 * LTX 2.3 / Sulphur-2 video inference, с multi-region failover через
 * `networkVolumeIds` (один endpoint покрывает все 10 наших LTX volumes
 * в 10 разных DC'ах).
 *
 * После создания опционально регистрирует получившийся endpoint в нашу
 * admin DB как `runpod_pod_template` с mode=serverless и привязкой к
 * существующим `runpod_network_volume`'ам (которые предполагаются уже
 * проseed'ленными в admin DB; если нет — сначала запусти миграции).
 *
 * Env:
 *   RUNPOD_API_KEY=rpa_xxx
 *   RUNPOD_LTX23_SERVERLESS_IMAGE=<docker-hub-user>/worker-ltx-comfyui:<tag>
 *   ADMIN_API_BASE_URL=https://admin.example.com   (опц., для auto-register)
 *   ADMIN_API_TOKEN=...                            (опц., bearer для admin API)
 *
 *   # Поведение
 *   WORKERS_MAX=5
 *   WORKERS_MIN=0
 *   IDLE_TIMEOUT_SEC=120
 *   EXEC_TIMEOUT_MS=900000
 *   GPU_PRIORITY="NVIDIA RTX A5000,NVIDIA GeForce RTX 4090,NVIDIA RTX A4500,NVIDIA RTX A4000,NVIDIA L4"
 *
 * Запуск:
 *   RUNPOD_API_KEY=rpa_xxx \
 *   RUNPOD_LTX23_SERVERLESS_IMAGE=balkhaev/worker-ltx-comfyui:v1 \
 *   bun run packages/runpod/scripts/create-serverless-endpoints.ts
 *
 * Идемпотентно по имени template'а и endpoint'а: если с таким же name уже
 * существует, переиспользуется (или обновляется через PATCH).
 */

const RUNPOD_BASE_URL = "https://rest.runpod.io/v1";

const TEMPLATE_NAME = "ltx-2-3-video-serverless";
const ENDPOINT_NAME = "ltx-2-3-video-serverless";
const DEFAULT_WORKERS_MAX = 5;
const DEFAULT_WORKERS_MIN = 0;
const DEFAULT_IDLE_TIMEOUT_SEC = 120;
const DEFAULT_EXEC_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_CONTAINER_DISK_GB = 20;
const DEFAULT_GPU_PRIORITY = [
	"NVIDIA RTX A5000",
	"NVIDIA GeForce RTX 4090",
	"NVIDIA RTX A4500",
	"NVIDIA RTX A4000",
	"NVIDIA L4",
];

/** RunPod serverless REST API rejects DC ids outside this enum (2026-05). */
const SERVERLESS_SUPPORTED_DATACENTERS = new Set([
	"EU-RO-1",
	"CA-MTL-1",
	"EU-SE-1",
	"US-IL-1",
	"EUR-IS-1",
	"EU-CZ-1",
	"US-TX-3",
	"EUR-IS-2",
	"US-KS-2",
	"US-GA-2",
	"US-WA-1",
	"US-TX-1",
	"CA-MTL-3",
	"EU-NL-1",
	"US-TX-4",
	"US-CA-2",
	"US-NC-1",
	"OC-AU-1",
	"US-DE-1",
	"EUR-IS-3",
	"CA-MTL-2",
	"AP-JP-1",
	"EUR-NO-1",
	"EU-FR-1",
	"US-KS-3",
	"US-GA-1",
	"AP-IN-1",
	"US-MD-1",
]);

function filterServerlessVolumes(volumes: VolumeInfo[]): VolumeInfo[] {
	const supported = volumes.filter((volume) =>
		SERVERLESS_SUPPORTED_DATACENTERS.has(volume.dataCenterId)
	);
	const skipped = volumes.filter(
		(volume) => !SERVERLESS_SUPPORTED_DATACENTERS.has(volume.dataCenterId)
	);
	if (skipped.length > 0) {
		log("volumes.skipped.unsupported-datacenter", {
			count: skipped.length,
			volumes: skipped.map((volume) => ({
				dataCenterId: volume.dataCenterId,
				id: volume.id,
				name: volume.name,
			})),
		});
	}
	if (supported.length === 0) {
		throw new Error("No ltx23 volumes in serverless-supported datacenters");
	}
	return supported;
}

interface RunpodApiCtx {
	apiKey: string;
}

interface VolumeInfo {
	dataCenterId: string;
	id: string;
	name: string;
}

interface TemplateInfo {
	containerDiskInGb?: number;
	id: string;
	imageName?: string;
	name?: string;
}

interface EndpointInfo {
	id: string;
	name?: string;
	templateId?: string;
}

function ts(): string {
	return new Date().toISOString().slice(11, 19);
}

function log(event: string, fields: unknown = {}): void {
	console.log(`[${ts()}] ${event}`, fields);
}

async function runpodRequest(
	ctx: RunpodApiCtx,
	method: "GET" | "POST" | "DELETE" | "PATCH",
	path: string,
	body?: unknown
): Promise<Response> {
	return await fetch(`${RUNPOD_BASE_URL}${path}`, {
		body: body === undefined ? undefined : JSON.stringify(body),
		headers: {
			authorization: `Bearer ${ctx.apiKey}`,
			"content-type": "application/json",
		},
		method,
	});
}

async function listVolumes(ctx: RunpodApiCtx): Promise<VolumeInfo[]> {
	const response = await runpodRequest(ctx, "GET", "/networkvolumes");
	if (!response.ok) {
		throw new Error(
			`GET /networkvolumes failed (${response.status}): ${await response.text()}`
		);
	}
	const body = (await response.json()) as VolumeInfo[];
	return body.filter((v) => v.name.startsWith("ltx23-"));
}

async function listTemplates(ctx: RunpodApiCtx): Promise<TemplateInfo[]> {
	const response = await runpodRequest(ctx, "GET", "/templates");
	if (!response.ok) {
		throw new Error(
			`GET /templates failed (${response.status}): ${await response.text()}`
		);
	}
	const body = await response.json();
	return Array.isArray(body)
		? (body as TemplateInfo[])
		: ((body as { data?: TemplateInfo[] }).data ?? []);
}

async function listEndpoints(ctx: RunpodApiCtx): Promise<EndpointInfo[]> {
	const response = await runpodRequest(ctx, "GET", "/endpoints");
	if (!response.ok) {
		throw new Error(
			`GET /endpoints failed (${response.status}): ${await response.text()}`
		);
	}
	const body = await response.json();
	return Array.isArray(body)
		? (body as EndpointInfo[])
		: ((body as { data?: EndpointInfo[] }).data ?? []);
}

async function ensureTemplate(
	ctx: RunpodApiCtx,
	imageName: string
): Promise<TemplateInfo> {
	const existing = (await listTemplates(ctx)).find(
		(t) => t.name === TEMPLATE_NAME
	);
	if (existing) {
		log("template.exists", { id: existing.id, name: existing.name });
		if (existing.imageName !== imageName && existing.id) {
			const patch = await runpodRequest(
				ctx,
				"POST",
				`/templates/${existing.id}/update`,
				{
					containerDiskInGb: DEFAULT_CONTAINER_DISK_GB,
					imageName,
				}
			);
			if (!patch.ok) {
				throw new Error(
					`update template failed (${patch.status}): ${await patch.text()}`
				);
			}
			log("template.updated.image", {
				from: existing.imageName,
				to: imageName,
			});
		}
		return existing;
	}
	const response = await runpodRequest(ctx, "POST", "/templates", {
		category: "NVIDIA",
		containerDiskInGb: DEFAULT_CONTAINER_DISK_GB,
		dockerEntrypoint: [],
		dockerStartCmd: [],
		env: buildTemplateEnv(),
		imageName,
		isServerless: true,
		name: TEMPLATE_NAME,
		readme: "Custom worker-comfyui for LTX 2.3 / Sulphur-2 inference.",
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`POST /templates failed (${response.status}): ${text}`);
	}
	const tpl = JSON.parse(text) as TemplateInfo;
	log("template.created", { id: tpl.id, name: tpl.name });
	return tpl;
}

function buildTemplateEnv(): Record<string, string> {
	// REFRESH_WORKER intentionally omitted (defaults to false in worker-comfyui):
	// keeping a warm pod across jobs is critical for sub-second latency.
	// NETWORK_VOLUME_DEBUG is opt-in via env; otherwise it spams logs and
	// slows down boot.
	const env: Record<string, string> = {};
	const region = process.env.S3_REGION ?? process.env.AWS_REGION;
	if (region) {
		// runpod-python rp_upload constructs presigned URLs via boto3, which
		// signs with us-east-1 unless AWS_REGION/AWS_DEFAULT_REGION is set.
		// Hetzner Object Storage rejects mismatched-region signatures.
		env.AWS_REGION = region;
		env.AWS_DEFAULT_REGION = region;
	}
	if (process.env.NETWORK_VOLUME_DEBUG === "true") {
		env.NETWORK_VOLUME_DEBUG = "true";
	}
	const civitai = process.env.CIVITAI_API_KEY;
	if (civitai) {
		env.CIVITAI_API_KEY = civitai;
	}
	const hf = process.env.HF_TOKEN;
	if (hf) {
		env.HF_TOKEN = hf;
	}
	const bucketEndpoint = process.env.BUCKET_ENDPOINT_URL;
	if (bucketEndpoint) {
		env.BUCKET_ENDPOINT_URL = bucketEndpoint;
	}
	const bucketKey = process.env.BUCKET_ACCESS_KEY_ID;
	if (bucketKey) {
		env.BUCKET_ACCESS_KEY_ID = bucketKey;
	}
	const bucketSecret = process.env.BUCKET_SECRET_ACCESS_KEY;
	if (bucketSecret) {
		env.BUCKET_SECRET_ACCESS_KEY = bucketSecret;
	}
	const bucketName = process.env.BUCKET_NAME;
	if (bucketName) {
		env.BUCKET_NAME = bucketName;
	}
	return env;
}

async function ensureEndpoint(
	ctx: RunpodApiCtx,
	templateId: string,
	volumes: VolumeInfo[]
): Promise<EndpointInfo> {
	const serverlessVolumes = filterServerlessVolumes(volumes);
	const existing = (await listEndpoints(ctx)).find(
		(e) => e.name === ENDPOINT_NAME
	);
	const gpuPriority =
		process.env.GPU_PRIORITY?.split(",")
			.map((s) => s.trim())
			.filter(Boolean) ?? DEFAULT_GPU_PRIORITY;
	const dataCenterIds = Array.from(
		new Set(serverlessVolumes.map((v) => v.dataCenterId))
	);
	const allVolumeIds = serverlessVolumes.map((v) => v.id);
	const payload = {
		executionTimeoutMs: Number(
			process.env.EXEC_TIMEOUT_MS ?? DEFAULT_EXEC_TIMEOUT_MS
		),
		flashboot: true,
		gpuCount: 1,
		gpuTypeIds: gpuPriority,
		idleTimeout: Number(
			process.env.IDLE_TIMEOUT_SEC ?? DEFAULT_IDLE_TIMEOUT_SEC
		),
		name: ENDPOINT_NAME,
		// RunPod REST create rejects `networkVolumeIds[]` (GraphQL expects
		// objects) but accepts singular `networkVolumeId`. Multi-volume attach
		// works via POST /endpoints/{id}/update with string ids.
		networkVolumeId: allVolumeIds[0],
		scalerType: "QUEUE_DELAY" as const,
		scalerValue: 4,
		templateId,
		workersMax: Number(process.env.WORKERS_MAX ?? DEFAULT_WORKERS_MAX),
		workersMin: Number(process.env.WORKERS_MIN ?? DEFAULT_WORKERS_MIN),
	};
	if (existing) {
		log("endpoint.exists", { id: existing.id, name: existing.name });
		const patch = await runpodRequest(
			ctx,
			"POST",
			`/endpoints/${existing.id}/update`,
			{
				dataCenterIds,
				executionTimeoutMs: payload.executionTimeoutMs,
				flashboot: true,
				gpuTypeIds: gpuPriority,
				idleTimeout: payload.idleTimeout,
				networkVolumeIds: allVolumeIds,
				scalerType: payload.scalerType,
				scalerValue: payload.scalerValue,
				templateId,
				workersMax: payload.workersMax,
				workersMin: payload.workersMin,
			}
		);
		if (!patch.ok) {
			throw new Error(
				`update endpoint failed (${patch.status}): ${await patch.text()}`
			);
		}
		log("endpoint.updated", {
			id: existing.id,
			volumeCount: allVolumeIds.length,
		});
		return existing;
	}
	const response = await runpodRequest(ctx, "POST", "/endpoints", payload);
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`POST /endpoints failed (${response.status}): ${text}`);
	}
	const ep = JSON.parse(text) as EndpointInfo;
	if (allVolumeIds.length > 1) {
		const attach = await runpodRequest(
			ctx,
			"POST",
			`/endpoints/${ep.id}/update`,
			{
				dataCenterIds,
				networkVolumeIds: allVolumeIds,
			}
		);
		if (!attach.ok) {
			throw new Error(
				`attach volumes failed (${attach.status}): ${await attach.text()}`
			);
		}
		log("endpoint.volumes.attached", {
			count: allVolumeIds.length,
			dataCenterIds,
			id: ep.id,
		});
	}
	log("endpoint.created", { id: ep.id });
	return ep;
}

interface PrintAdminInstructionsArgs {
	endpointId: string;
	imageName: string;
	templateId: string;
	volumes: VolumeInfo[];
}

/**
 * `volumes` admin payload требует **admin-DB** UUID'ов (не RunPod IDs).
 * Получить их — `GET /api/admin/runpod/volumes`. Если admin DB ещё не
 * заполнен (volumes отсутствуют), `seedRunpodTemplatesFromEnv` создаёт их
 * при старте generator-api из env, либо их можно добавить вручную через
 * UI `/runpod → Volumes`. После этого выполни POST с приведённым ниже
 * payload'ом.
 */
function printAdminInstructions(args: PrintAdminInstructionsArgs): void {
	const samplePayload = {
		cloudType: "SECURE",
		containerDiskInGb: DEFAULT_CONTAINER_DISK_GB,
		description: `Serverless LTX 2.3 / Sulphur-2 endpoint ${args.endpointId}`,
		enabled: true,
		gpuTypeIds:
			process.env.GPU_PRIORITY?.split(",").map((s) => s.trim()) ??
			DEFAULT_GPU_PRIORITY,
		imageName: args.imageName,
		keepAliveMs: 0,
		mode: "serverless",
		name: "LTX 2.3 / Sulphur-2 serverless",
		runpodEndpointId: args.endpointId,
		runpodTemplateId: args.templateId,
		timeoutMs: DEFAULT_EXEC_TIMEOUT_MS,
		// volumes: после fetch admin DB UUIDs из GET /api/admin/runpod/volumes
		// нужно собрать массив {volumeId: <adminDbUuid>, priority: <int>}
		volumes: args.volumes.map((v, idx) => ({
			_runpodVolumeId: v.id,
			_runpodVolumeName: v.name,
			priority: idx,
			volumeId: "<replace-with-admin-db-uuid>",
		})),
		volumeInGb: 100,
		workflowKey: "ltx-2-3-video",
	};
	console.log("\n[admin.register-instructions]");
	console.log(
		"1. GET admin volumes: curl -H 'Authorization: Bearer <token>' \\"
	);
	console.log("     <ADMIN_API_BASE>/api/admin/runpod/volumes | jq");
	console.log(
		"2. Map runpodVolumeId → id (admin DB UUID) for each ltx23-* entry."
	);
	console.log(
		"3. POST /api/admin/runpod/pod-templates with the following payload\n   (replace `<replace-with-admin-db-uuid>` and strip _runpod* helpers):\n"
	);
	console.log(JSON.stringify(samplePayload, null, 2));
}

function requireEnv(key: string): string {
	const value = process.env[key];
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}

async function main(): Promise<void> {
	const ctx: RunpodApiCtx = { apiKey: requireEnv("RUNPOD_API_KEY") };
	const imageName = requireEnv("RUNPOD_LTX23_SERVERLESS_IMAGE");

	const volumes = await listVolumes(ctx);
	log("volumes.discovered", {
		count: volumes.length,
		dataCenters: Array.from(new Set(volumes.map((v) => v.dataCenterId))),
	});
	if (volumes.length === 0) {
		throw new Error("No ltx23-* volumes found");
	}

	const template = await ensureTemplate(ctx, imageName);
	const endpoint = await ensureEndpoint(ctx, template.id, volumes);

	log("done", {
		endpointId: endpoint.id,
		nextStep: "register in admin DB via UI (/runpod) or set ADMIN_API_*",
		templateId: template.id,
	});

	printAdminInstructions({
		endpointId: endpoint.id,
		imageName,
		templateId: template.id,
		volumes,
	});
}

main().catch((error) => {
	console.error(`[${ts()}] create.fatal`, error);
	process.exitCode = 1;
});
