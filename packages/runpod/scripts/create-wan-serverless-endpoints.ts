/* biome-ignore-all lint/suspicious/noConsole: setup script reports human-readable timeline */
export {};

/**
 * Идемпотентно создаёт RunPod template + serverless endpoint для Wan 2.2 I2V.
 * Переиспользует образ `worker-ltx-comfyui` (ComfyUI core + VHS).
 *
 * Network volumes: только `wan22-*` (отдельные от LTX — ~35 GB Wan weights).
 * Создай volumes в RunPod console (100 GB, нужные DC) или передай
 * `RUNPOD_WAN22_VOLUME_IDS=id1,id2` для явного списка.
 *
 * Env:
 *   RUNPOD_API_KEY=rpa_xxx
 *   RUNPOD_WAN22_SERVERLESS_IMAGE=<hub>/worker-ltx-comfyui:<tag>
 *     (fallback: RUNPOD_LTX23_SERVERLESS_IMAGE)
 *
 * Запуск:
 *   bun run packages/runpod/scripts/create-wan-serverless-endpoints.ts
 */

const RUNPOD_BASE_URL = "https://rest.runpod.io/v1";
const TEMPLATE_NAME = "wan-2-2-video-serverless";
const ENDPOINT_NAME = "wan-2-2-video-serverless";
const DEFAULT_WORKERS_MAX = 5;
const DEFAULT_WORKERS_MIN = 1;
const DEFAULT_IDLE_TIMEOUT_SEC = 300;
const DEFAULT_EXEC_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_CONTAINER_DISK_GB = 20;
const DEFAULT_GPU_PRIORITY = [
	"NVIDIA RTX A5000",
	"NVIDIA GeForce RTX 4090",
	"NVIDIA RTX A4500",
	"NVIDIA RTX A4000",
	"NVIDIA L4",
];

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
	method: "GET" | "POST" | "PATCH",
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

function filterServerlessVolumes(volumes: VolumeInfo[]): VolumeInfo[] {
	const supported = volumes.filter((volume) =>
		SERVERLESS_SUPPORTED_DATACENTERS.has(volume.dataCenterId)
	);
	if (supported.length === 0) {
		throw new Error("No wan22 volumes in serverless-supported datacenters");
	}
	return supported;
}

async function listVolumes(ctx: RunpodApiCtx): Promise<VolumeInfo[]> {
	const explicit = process.env.RUNPOD_WAN22_VOLUME_IDS?.trim();
	if (explicit) {
		const ids = explicit
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		const response = await runpodRequest(ctx, "GET", "/networkvolumes");
		if (!response.ok) {
			throw new Error(
				`GET /networkvolumes failed (${response.status}): ${await response.text()}`
			);
		}
		const body = (await response.json()) as VolumeInfo[];
		const picked = body.filter((v) => ids.includes(v.id));
		if (picked.length !== ids.length) {
			throw new Error(
				`RUNPOD_WAN22_VOLUME_IDS: found ${picked.length}/${ids.length} volumes`
			);
		}
		return picked;
	}
	const response = await runpodRequest(ctx, "GET", "/networkvolumes");
	if (!response.ok) {
		throw new Error(
			`GET /networkvolumes failed (${response.status}): ${await response.text()}`
		);
	}
	const body = (await response.json()) as VolumeInfo[];
	return body.filter((v) => v.name.startsWith("wan22-"));
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
				{ containerDiskInGb: DEFAULT_CONTAINER_DISK_GB, imageName }
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
		return { ...existing, imageName };
	}
	const response = await runpodRequest(ctx, "POST", "/templates", {
		containerDiskInGb: DEFAULT_CONTAINER_DISK_GB,
		imageName,
		isServerless: true,
		name: TEMPLATE_NAME,
	});
	if (!response.ok) {
		throw new Error(
			`POST /templates failed (${response.status}): ${await response.text()}`
		);
	}
	const created = (await response.json()) as TemplateInfo;
	log("template.created", { id: created.id });
	return created;
}

async function ensureEndpoint(
	ctx: RunpodApiCtx,
	templateId: string,
	volumes: VolumeInfo[]
): Promise<EndpointInfo> {
	const workersMax = Number(process.env.WORKERS_MAX ?? DEFAULT_WORKERS_MAX);
	const workersMin = Number(process.env.WORKERS_MIN ?? DEFAULT_WORKERS_MIN);
	const idleTimeout = Number(
		process.env.IDLE_TIMEOUT_SEC ?? DEFAULT_IDLE_TIMEOUT_SEC
	);
	const gpuPriority =
		process.env.GPU_PRIORITY?.split(",").map((s) => s.trim()) ??
		DEFAULT_GPU_PRIORITY;
	const dataCenterIds = Array.from(new Set(volumes.map((v) => v.dataCenterId)));
	const networkVolumeIds = volumes.map((v) => v.id);
	const executionTimeoutMs = Number(
		process.env.EXEC_TIMEOUT_MS ?? DEFAULT_EXEC_TIMEOUT_MS
	);

	const existing = (await listEndpoints(ctx)).find(
		(e) => e.name === ENDPOINT_NAME
	);
	if (existing) {
		// Multi-volume attach works via POST /endpoints/{id}/update (plural ids).
		const response = await runpodRequest(
			ctx,
			"POST",
			`/endpoints/${existing.id}/update`,
			{
				dataCenterIds,
				executionTimeoutMs,
				flashboot: true,
				gpuTypeIds: gpuPriority,
				idleTimeout,
				networkVolumeIds,
				scalerType: "QUEUE_DELAY",
				scalerValue: 4,
				templateId,
				workersMax,
				workersMin,
			}
		);
		if (!response.ok) {
			throw new Error(
				`update endpoint failed (${response.status}): ${await response.text()}`
			);
		}
		log("endpoint.updated", { id: existing.id });
		return { id: existing.id, name: ENDPOINT_NAME, templateId };
	}
	// RunPod REST create rejects `networkVolumeIds[]` (GraphQL expects objects)
	// but accepts singular `networkVolumeId`. Extra volumes attach via update.
	const response = await runpodRequest(ctx, "POST", "/endpoints", {
		executionTimeoutMs,
		flashboot: true,
		gpuCount: 1,
		gpuTypeIds: gpuPriority,
		idleTimeout,
		name: ENDPOINT_NAME,
		networkVolumeId: networkVolumeIds[0],
		scalerType: "QUEUE_DELAY",
		scalerValue: 4,
		templateId,
		workersMax,
		workersMin,
	});
	if (!response.ok) {
		throw new Error(
			`POST /endpoints failed (${response.status}): ${await response.text()}`
		);
	}
	const created = (await response.json()) as EndpointInfo;
	if (networkVolumeIds.length > 1) {
		await runpodRequest(ctx, "POST", `/endpoints/${created.id}/update`, {
			dataCenterIds,
			networkVolumeIds,
		});
	}
	log("endpoint.created", { id: created.id });
	return created;
}

function requireEnv(key: string): string {
	const value = process.env[key];
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}

function resolveImageName(): string {
	return (
		process.env.RUNPOD_WAN22_SERVERLESS_IMAGE?.trim() ||
		process.env.RUNPOD_LTX23_SERVERLESS_IMAGE?.trim() ||
		""
	);
}

async function main(): Promise<void> {
	const ctx: RunpodApiCtx = { apiKey: requireEnv("RUNPOD_API_KEY") };
	const imageName = resolveImageName();
	if (!imageName) {
		throw new Error(
			"RUNPOD_WAN22_SERVERLESS_IMAGE or RUNPOD_LTX23_SERVERLESS_IMAGE is required"
		);
	}

	const volumes = filterServerlessVolumes(await listVolumes(ctx));
	log("volumes.discovered", {
		count: volumes.length,
		dataCenters: Array.from(new Set(volumes.map((v) => v.dataCenterId))),
		names: volumes.map((v) => v.name),
	});

	const template = await ensureTemplate(ctx, imageName);
	const endpoint = await ensureEndpoint(ctx, template.id, volumes);

	const adminPayload = {
		cloudType: "SECURE",
		containerDiskInGb: DEFAULT_CONTAINER_DISK_GB,
		description: `Wan 2.2 I2V serverless ${endpoint.id}`,
		enabled: true,
		gpuTypeIds: DEFAULT_GPU_PRIORITY,
		imageName,
		keepAliveMs: 0,
		mode: "serverless",
		name: "Wan 2.2 I2V serverless",
		runpodEndpointId: endpoint.id,
		runpodTemplateId: template.id,
		timeoutMs: DEFAULT_EXEC_TIMEOUT_MS,
		volumes: volumes.map((v, idx) => ({
			_runpodVolumeId: v.id,
			_runpodVolumeName: v.name,
			priority: idx,
			volumeId: "<replace-with-admin-db-uuid>",
		})),
		volumeInGb: 100,
		workflowKey: "wan-2-2-video",
	};

	console.log("\n[admin.register-instructions]");
	console.log("POST /api/admin/runpod/pod-templates with payload:\n");
	console.log(JSON.stringify(adminPayload, null, 2));
	console.log("\n[env.generator]");
	console.log(`RUNPOD_WAN22_SERVERLESS_ENDPOINT_ID=${endpoint.id}`);
	console.log(`RUNPOD_WAN22_SERVERLESS_TEMPLATE_ID=${template.id}`);
	log("done", { endpointId: endpoint.id, templateId: template.id });
}

main().catch((error) => {
	console.error(`[${ts()}] create-wan.fatal`, error);
	process.exitCode = 1;
});
