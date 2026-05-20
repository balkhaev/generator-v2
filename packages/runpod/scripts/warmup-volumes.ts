/* biome-ignore-all lint/suspicious/noConsole: warm-up script reports human-readable timeline */
/**
 * Warm-up RunPod network volumes for ltx-2-3-video.
 *
 * Параллельно создаёт по 1 pod на каждый volume из RUNPOD_LTX23_POD_NETWORK_VOLUMES,
 * ждёт пока ComfyUI ответит на 8188 (это значит provisioning script скачал
 * ~40 ГБ моделей на NFS volume), terminate. Модели остаются на volume
 * навсегда → следующие холодные старты не качают, сразу ComfyUI boot ~2-3 мин.
 *
 * Capacity-aware: при `no capacity` ждёт 60s и retry, до VOLUME_CAPACITY_TIMEOUT_MS.
 * Skip-aware: если на volume уже есть pod (например, активная генерация), skip.
 *
 * Запуск:
 *   RUNPOD_API_KEY=rpa_xxx \
 *   RUNPOD_LTX23_POD_NETWORK_VOLUMES='[{...}]' \
 *   bun run packages/runpod/scripts/warmup-volumes.ts
 */

interface VolumeEntry {
	gpus: string[];
	id: string;
	label?: string;
}

interface WarmupResult {
	elapsedMs: number;
	error?: string;
	gpuTypeId?: string;
	podId?: string;
	status: "ready" | "skipped-active-pod" | "no-capacity" | "timeout" | "error";
	volume: VolumeEntry;
}

const RUNPOD_BASE_URL = "https://rest.runpod.io/v1";
const COMFY_PROXY_HOST = (podId: string) =>
	`https://${podId}-8188.proxy.runpod.net`;
const _COMFY_USERNAME = "agent";

const VOLUME_CAPACITY_TIMEOUT_MS = 30 * 60 * 1000;
const VOLUME_CAPACITY_RETRY_MS = 60 * 1000;
const COMFY_READY_TIMEOUT_MS = 35 * 60 * 1000;
const COMFY_READY_POLL_MS = 10 * 1000;
const STUB_PROMPT = "warmup";
const STUB_INPUT_IMAGE_URL =
	"https://raw.githubusercontent.com/Lightricks/LTX-Video/main/assets/cat.png";

const NO_CAPACITY_PATTERN =
	/no instances|does not have the resources|no resources|out of stock|no available|capacity|could not find any pods with required specifications/iu;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function ts(): string {
	return new Date().toISOString().slice(11, 19);
}

function log(label: string, event: string, fields: unknown = {}): void {
	console.log(`[${ts()}] [${label}] ${event}`, fields);
}

function isNoCapacity(message: string): boolean {
	return NO_CAPACITY_PATTERN.test(message);
}

function randomPassword(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(16)))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function buildStubInputJsonB64(): string {
	const json = JSON.stringify({
		cfgScale: 1,
		fps: 24,
		height: 512,
		inputImageUrl: STUB_INPUT_IMAGE_URL,
		numFrames: 25,
		prompt: STUB_PROMPT,
		steps: 1,
		width: 512,
	});
	return Buffer.from(json, "utf8").toString("base64");
}

interface RunpodApiCtx {
	apiKey: string;
	civitaiApiKey?: string;
	cloudType: "SECURE" | "COMMUNITY";
	containerDiskInGb: number;
	imageName: string;
	templateId: string;
	volumeInGb: number;
}

async function runpodRequest(
	ctx: RunpodApiCtx,
	method: "GET" | "POST" | "DELETE",
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

async function listPods(ctx: RunpodApiCtx): Promise<
	{
		id: string;
		name?: string;
		networkVolumeId?: string;
		desiredStatus?: string;
	}[]
> {
	const response = await runpodRequest(ctx, "GET", "/pods");
	if (!response.ok) {
		throw new Error(
			`list /pods failed (${response.status}): ${await response.text()}`
		);
	}
	const body = (await response.json()) as unknown;
	const raw = Array.isArray(body)
		? body
		: ((body as { data?: unknown[] }).data ?? []);
	return raw as {
		id: string;
		name?: string;
		networkVolumeId?: string;
		desiredStatus?: string;
	}[];
}

async function createWarmupPod(
	ctx: RunpodApiCtx,
	volume: VolumeEntry,
	gpuTypeId: string,
	password: string
): Promise<{ id: string }> {
	const env: Record<string, string> = {
		INFERENCE_INPUT_JSON_B64: buildStubInputJsonB64(),
		INFERENCE_NETWORK_VOLUME_ID: volume.id,
		INFERENCE_TIMEOUT_S: "3600",
		PASSWORD: password,
	};
	if (ctx.civitaiApiKey) {
		env.CIVITAI_API_KEY = ctx.civitaiApiKey;
		env.CIVITAI_TOKEN = ctx.civitaiApiKey;
	}
	const safeLabel = (volume.label ?? volume.id)
		.toLowerCase()
		.replaceAll(/[^a-z0-9-]+/gu, "-");
	const response = await runpodRequest(ctx, "POST", "/pods", {
		cloudType: ctx.cloudType,
		containerDiskInGb: ctx.containerDiskInGb,
		env,
		gpuCount: 1,
		gpuTypeIds: [gpuTypeId],
		gpuTypePriority: "availability",
		imageName: ctx.imageName,
		name: `warmup-${safeLabel}-${Date.now().toString(36)}`,
		networkVolumeId: volume.id,
		ports: ["8188/http", "22/tcp"],
		templateId: ctx.templateId,
		volumeInGb: ctx.volumeInGb,
		volumeMountPath: "/workspace",
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`create /pods failed (${response.status}) on ${gpuTypeId}: ${text}`
		);
	}
	return JSON.parse(text) as { id: string };
}

async function tryCreatePodOnVolume(
	ctx: RunpodApiCtx,
	volume: VolumeEntry,
	password: string,
	label: string
): Promise<{ podId: string; gpuTypeId: string } | "no-capacity"> {
	const errors: string[] = [];
	for (const gpuTypeId of volume.gpus) {
		try {
			const pod = await createWarmupPod(ctx, volume, gpuTypeId, password);
			log(label, "pod.created", { gpu: gpuTypeId, podId: pod.id });
			return { gpuTypeId, podId: pod.id };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!isNoCapacity(message)) {
				throw error;
			}
			errors.push(`${gpuTypeId}: no-capacity`);
		}
	}
	log(label, "pod.no-capacity-on-all-gpus", { tried: errors });
	return "no-capacity";
}

async function waitForCapacityAndCreate(
	ctx: RunpodApiCtx,
	volume: VolumeEntry,
	password: string,
	label: string
): Promise<{ podId: string; gpuTypeId: string } | "no-capacity"> {
	const startedAt = Date.now();
	let attempt = 0;
	while (Date.now() - startedAt < VOLUME_CAPACITY_TIMEOUT_MS) {
		attempt += 1;
		const result = await tryCreatePodOnVolume(ctx, volume, password, label);
		if (result !== "no-capacity") {
			return result;
		}
		log(label, "capacity.retry-wait", {
			attempt,
			nextWaitMs: VOLUME_CAPACITY_RETRY_MS,
		});
		await sleep(VOLUME_CAPACITY_RETRY_MS);
	}
	return "no-capacity";
}

async function probeComfyReady(podId: string): Promise<boolean> {
	const url = `${COMFY_PROXY_HOST(podId)}/api/system_stats`;
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(8000),
		});
		// ComfyUI uses cookie-based auth. Once the process is up it returns 401
		// (auth required) without basic credentials. Anything < 500 means the
		// HTTP server is bound and provisioning is complete; 5xx/timeout means
		// pod is still booting / proxy not routing yet.
		return response.status === 200 || response.status === 401;
	} catch {
		return false;
	}
}

async function waitForComfyReady(
	podId: string,
	label: string
): Promise<boolean> {
	const startedAt = Date.now();
	let attempt = 0;
	while (Date.now() - startedAt < COMFY_READY_TIMEOUT_MS) {
		attempt += 1;
		const ready = await probeComfyReady(podId);
		if (ready) {
			log(label, "comfy.ready", {
				attempt,
				elapsedSec: Math.round((Date.now() - startedAt) / 1000),
			});
			return true;
		}
		if (attempt % 6 === 0) {
			log(label, "comfy.still-warming", {
				attempt,
				elapsedSec: Math.round((Date.now() - startedAt) / 1000),
			});
		}
		await sleep(COMFY_READY_POLL_MS);
	}
	return false;
}

async function terminatePod(ctx: RunpodApiCtx, podId: string): Promise<void> {
	try {
		const response = await runpodRequest(ctx, "DELETE", `/pods/${podId}`);
		if (!response.ok && response.status !== 404) {
			console.warn(
				`[${ts()}] terminate failed (${response.status}):`,
				await response.text()
			);
		}
	} catch (error) {
		console.warn(`[${ts()}] terminate threw:`, error);
	}
}

async function warmupVolume(
	ctx: RunpodApiCtx,
	volume: VolumeEntry,
	activeVolumeIds: Set<string>
): Promise<WarmupResult> {
	const label = volume.label ?? volume.id;
	const startedAt = Date.now();
	if (activeVolumeIds.has(volume.id)) {
		log(label, "skip.active-pod-on-volume", { volumeId: volume.id });
		return {
			elapsedMs: 0,
			status: "skipped-active-pod",
			volume,
		};
	}
	const password = randomPassword();
	let pod: { podId: string; gpuTypeId: string };
	const acquired = await waitForCapacityAndCreate(ctx, volume, password, label);
	if (acquired === "no-capacity") {
		log(label, "capacity.exhausted", {
			waitedMs: Date.now() - startedAt,
		});
		return {
			elapsedMs: Date.now() - startedAt,
			status: "no-capacity",
			volume,
		};
	}
	pod = acquired;
	try {
		const ready = await waitForComfyReady(pod.podId, label);
		await terminatePod(ctx, pod.podId);
		return {
			elapsedMs: Date.now() - startedAt,
			gpuTypeId: pod.gpuTypeId,
			podId: pod.podId,
			status: ready ? "ready" : "timeout",
			volume,
		};
	} catch (error) {
		await terminatePod(ctx, pod.podId);
		return {
			elapsedMs: Date.now() - startedAt,
			error: error instanceof Error ? error.message : String(error),
			gpuTypeId: pod.gpuTypeId,
			podId: pod.podId,
			status: "error",
			volume,
		};
	}
}

function requireEnv(key: string): string {
	const value = process.env[key];
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}

async function main(): Promise<void> {
	const ctx: RunpodApiCtx = {
		apiKey: requireEnv("RUNPOD_API_KEY"),
		civitaiApiKey: process.env.CIVITAI_API_KEY,
		cloudType:
			process.env.RUNPOD_LTX23_POD_CLOUD_TYPE === "COMMUNITY"
				? "COMMUNITY"
				: "SECURE",
		containerDiskInGb: Number(
			process.env.RUNPOD_LTX23_POD_CONTAINER_DISK_GB ?? "15"
		),
		imageName:
			process.env.RUNPOD_LTX23_POD_IMAGE_NAME ??
			"ls250824/run-comfyui-ltx:28042026",
		templateId: process.env.RUNPOD_LTX23_POD_TEMPLATE_ID ?? "p4f6rm9tb4",
		volumeInGb: Number(process.env.RUNPOD_LTX23_POD_VOLUME_GB ?? "90"),
	};

	const volumes = JSON.parse(
		requireEnv("RUNPOD_LTX23_POD_NETWORK_VOLUMES")
	) as VolumeEntry[];

	log("init", "config", {
		cloudType: ctx.cloudType,
		imageName: ctx.imageName,
		templateId: ctx.templateId,
		volumeCount: volumes.length,
	});

	const existingPods = await listPods(ctx);
	const activeVolumeIds = new Set<string>();
	for (const pod of existingPods) {
		if (
			pod.networkVolumeId &&
			pod.desiredStatus === "RUNNING" &&
			!pod.name?.startsWith("warmup-")
		) {
			activeVolumeIds.add(pod.networkVolumeId);
		}
	}
	log("init", "active-volumes-detected", {
		ids: Array.from(activeVolumeIds),
	});

	const settled = await Promise.allSettled(
		volumes.map((volume) => warmupVolume(ctx, volume, activeVolumeIds))
	);
	const results: WarmupResult[] = settled.map((s, idx) => {
		if (s.status === "fulfilled") {
			return s.value;
		}
		const reason = s.reason;
		return {
			elapsedMs: 0,
			error: reason instanceof Error ? reason.message : String(reason),
			status: "error",
			volume: volumes[idx] as VolumeEntry,
		};
	});

	console.log(`\n[${ts()}] WARM-UP SUMMARY:`);
	for (const r of results) {
		const label = r.volume.label ?? r.volume.id;
		const sec = Math.round(r.elapsedMs / 1000);
		const extras: string[] = [];
		if (r.gpuTypeId) {
			extras.push(`gpu=${r.gpuTypeId}`);
		}
		if (r.podId) {
			extras.push(`pod=${r.podId}`);
		}
		if (r.error) {
			extras.push(`err=${r.error}`);
		}
		console.log(
			`  ${label.padEnd(12)} ${r.status.padEnd(20)} ${sec}s  ${extras.join(" ")}`
		);
	}
	const ready = results.filter((r) => r.status === "ready").length;
	const skipped = results.filter(
		(r) => r.status === "skipped-active-pod"
	).length;
	const failed = results.length - ready - skipped;
	console.log(
		`\nready=${ready} skipped=${skipped} failed=${failed} total=${results.length}`
	);
	if (failed > 0) {
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(`[${ts()}] warmup.fatal`, error);
	process.exitCode = 1;
});
