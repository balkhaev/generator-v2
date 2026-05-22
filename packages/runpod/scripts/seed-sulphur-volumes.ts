/* biome-ignore-all lint/suspicious/noConsole: seed script reports human-readable timeline */
// Marker export to force TS to treat this file as an ES module (avoids
// global-scope name collisions with sibling script files).
export {};

/**
 * Параллельно заливает Sulphur-2 base + distill LoRA на все 10 RunPod
 * network volumes для LTX 2.3 inference.
 *
 * Файлы:
 * - `sulphur_dev_fp8mixed.safetensors` (29 GB) → diffusion_models/
 * - `sulphur_distil_lora.safetensors`  (0.66 GB) → loras/
 *   (originally `distill_loras/ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors`)
 *
 * 100 GB volume + ~40 GB existing LTX 2.3 + 30 GB Sulphur = 70 GB, fits.
 * bf16 (46 GB) намеренно НЕ качаем — не помещается рядом с LTX 2.3.
 *
 * Mechanic:
 * 1. Получаем список volumes из RUNPOD_API_KEY (или из
 *    RUNPOD_LTX23_POD_NETWORK_VOLUMES env, как в warmup-volumes.ts).
 * 2. На каждый volume поднимаем минимальный pod (`python:3.11-slim`)
 *    с `dockerStartCmd`, который:
 *    - устанавливает wget
 *    - скачивает Sulphur файлы (resume-aware) на /workspace
 *    - кладёт sentinel `/workspace/SULPHUR_SEED_DONE`
 *    - запускает `python3 -m http.server 8080` для readiness probe
 * 3. Polling: `GET https://<podid>-8080.proxy.runpod.net/SULPHUR_SEED_DONE`
 *    — 200 = готово, terminate pod.
 * 4. Capacity-aware: при `no capacity` ждём 60s и retry, до 30 минут.
 *
 * Запуск (локально):
 *   RUNPOD_API_KEY=rpa_xxx bun run packages/runpod/scripts/seed-sulphur-volumes.ts
 *
 * Идемпотентно: wget --continue, sentinel-проверка перед началом — если
 * pod уже видит `/workspace/SULPHUR_SEED_DONE`, скачивание не повторяется.
 */

const RUNPOD_BASE_URL = "https://rest.runpod.io/v1";
const SEEDER_IMAGE = "python:3.11-slim";
const SEEDER_HTTP_PORT = 8080;
const SENTINEL_PATH = "SULPHUR_SEED_DONE";

const SULPHUR_BASE_URL =
	"https://huggingface.co/SulphurAI/Sulphur-2-base/resolve/main";
const SULPHUR_FP8_FILE = "sulphur_dev_fp8mixed.safetensors";
const SULPHUR_DISTILL_FILE = "sulphur_distil_lora.safetensors";
const SULPHUR_DISTILL_HF_PATH =
	"distill_loras/ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors";

const VOLUME_CAPACITY_TIMEOUT_MS = 30 * 60 * 1000;
const VOLUME_CAPACITY_RETRY_MS = 60 * 1000;
const DOWNLOAD_READY_TIMEOUT_MS = 60 * 60 * 1000;
const DOWNLOAD_READY_POLL_MS = 30 * 1000;
const CONTAINER_DISK_GB = 10;
const SEED_PORT_SPEC = `${SEEDER_HTTP_PORT}/http`;

const NO_CAPACITY_PATTERN =
	/no instances|does not have the resources|no resources|out of stock|no available|capacity|could not find any pods with required specifications/iu;

interface VolumeEntry {
	dataCenterId: string;
	gpuTypeIds: string[];
	id: string;
	name: string;
}

interface SeedResult {
	elapsedMs: number;
	error?: string;
	gpuTypeId?: string;
	podId?: string;
	status: "seeded" | "already-seeded" | "no-capacity" | "timeout" | "error";
	volume: VolumeEntry;
}

interface RunpodApiCtx {
	apiKey: string;
	cloudType: "SECURE" | "COMMUNITY";
}

const COMMUNITY_GPU_FALLBACKS = [
	"NVIDIA GeForce RTX 4090",
	"NVIDIA RTX A4000",
	"NVIDIA RTX A4500",
	"NVIDIA RTX A5000",
];

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

async function listVolumes(ctx: RunpodApiCtx): Promise<VolumeEntry[]> {
	const response = await runpodRequest(ctx, "GET", "/networkvolumes");
	if (!response.ok) {
		throw new Error(
			`GET /networkvolumes failed (${response.status}): ${await response.text()}`
		);
	}
	const body = (await response.json()) as Array<{
		dataCenterId: string;
		id: string;
		name: string;
	}>;
	const ltxOnly = body.filter((v) => v.name.startsWith("ltx23-"));
	return ltxOnly.map((v) => ({
		dataCenterId: v.dataCenterId,
		gpuTypeIds: COMMUNITY_GPU_FALLBACKS,
		id: v.id,
		name: v.name,
	}));
}

function buildSeedScript(): string {
	const distillUrl = `${SULPHUR_BASE_URL}/${SULPHUR_DISTILL_HF_PATH}`;
	const fp8Url = `${SULPHUR_BASE_URL}/${SULPHUR_FP8_FILE}`;
	const wgetCommon =
		"--continue --tries=20 --waitretry=10 --timeout=60 --no-verbose";
	const script = `
set -e
echo "[seed] start at $(date -Is)"
if [ -f /workspace/${SENTINEL_PATH} ]; then
  echo "[seed] sentinel present — already seeded"
else
  apt-get update -qq && apt-get install -y --no-install-recommends wget ca-certificates
  mkdir -p /workspace/ComfyUI/models/diffusion_models /workspace/ComfyUI/models/loras
  cd /workspace/ComfyUI/models/diffusion_models
  echo "[seed] downloading ${SULPHUR_FP8_FILE} (~29 GB)"
  wget ${wgetCommon} -O ${SULPHUR_FP8_FILE} "${fp8Url}"
  cd /workspace/ComfyUI/models/loras
  echo "[seed] downloading ${SULPHUR_DISTILL_FILE} (~660 MB)"
  wget ${wgetCommon} -O ${SULPHUR_DISTILL_FILE} "${distillUrl}"
  touch /workspace/${SENTINEL_PATH}
  echo "[seed] done at $(date -Is)"
fi
cd /workspace
exec python3 -m http.server ${SEEDER_HTTP_PORT}
`.trim();
	return script;
}

async function createSeederPod(
	ctx: RunpodApiCtx,
	volume: VolumeEntry,
	gpuTypeId: string
): Promise<{ id: string }> {
	const safeName = `seed-sulphur-${volume.name.replace(/[^a-z0-9-]+/giu, "-")}-${Date.now().toString(36)}`;
	const dockerArgs = `bash -lc ${JSON.stringify(buildSeedScript())}`;
	const response = await runpodRequest(ctx, "POST", "/pods", {
		cloudType: ctx.cloudType,
		containerDiskInGb: CONTAINER_DISK_GB,
		dockerEntrypoint: ["/bin/bash", "-lc"],
		dockerStartCmd: [buildSeedScript()],
		env: {
			HF_HUB_ENABLE_HF_TRANSFER: "1",
		},
		gpuCount: 1,
		gpuTypeIds: [gpuTypeId],
		gpuTypePriority: "availability",
		imageName: SEEDER_IMAGE,
		name: safeName,
		networkVolumeId: volume.id,
		ports: [SEED_PORT_SPEC],
		volumeMountPath: "/workspace",
		// dockerArgs alias for some RunPod templates that ignore startCmd
		// without explicit entrypoint override; harmless duplicate
		dockerArgs: dockerArgs.slice(0, 65_000),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`POST /pods failed (${response.status}) on ${gpuTypeId}: ${text}`
		);
	}
	return JSON.parse(text) as { id: string };
}

async function tryCreatePodOnVolume(
	ctx: RunpodApiCtx,
	volume: VolumeEntry,
	label: string
): Promise<{ podId: string; gpuTypeId: string } | "no-capacity"> {
	const tried: string[] = [];
	for (const gpuTypeId of volume.gpuTypeIds) {
		try {
			const pod = await createSeederPod(ctx, volume, gpuTypeId);
			log(label, "pod.created", { gpu: gpuTypeId, podId: pod.id });
			return { gpuTypeId, podId: pod.id };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!isNoCapacity(message)) {
				throw error;
			}
			tried.push(`${gpuTypeId}: no-capacity`);
		}
	}
	log(label, "pod.no-capacity-on-all-gpus", { tried });
	return "no-capacity";
}

async function waitForCapacityAndCreate(
	ctx: RunpodApiCtx,
	volume: VolumeEntry,
	label: string
): Promise<{ podId: string; gpuTypeId: string } | "no-capacity"> {
	const startedAt = Date.now();
	let attempt = 0;
	while (Date.now() - startedAt < VOLUME_CAPACITY_TIMEOUT_MS) {
		attempt += 1;
		const result = await tryCreatePodOnVolume(ctx, volume, label);
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

async function probeSentinel(podId: string): Promise<boolean> {
	const url = `https://${podId}-${SEEDER_HTTP_PORT}.proxy.runpod.net/${SENTINEL_PATH}`;
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(10_000),
		});
		return response.status === 200;
	} catch {
		return false;
	}
}

async function waitForSentinel(podId: string, label: string): Promise<boolean> {
	const startedAt = Date.now();
	let attempt = 0;
	while (Date.now() - startedAt < DOWNLOAD_READY_TIMEOUT_MS) {
		attempt += 1;
		const ready = await probeSentinel(podId);
		if (ready) {
			log(label, "sentinel.ready", {
				attempt,
				elapsedSec: Math.round((Date.now() - startedAt) / 1000),
			});
			return true;
		}
		if (attempt % 4 === 0) {
			log(label, "sentinel.still-downloading", {
				attempt,
				elapsedSec: Math.round((Date.now() - startedAt) / 1000),
			});
		}
		await sleep(DOWNLOAD_READY_POLL_MS);
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

async function seedVolume(
	ctx: RunpodApiCtx,
	volume: VolumeEntry
): Promise<SeedResult> {
	const label = volume.name;
	const startedAt = Date.now();
	const acquired = await waitForCapacityAndCreate(ctx, volume, label);
	if (acquired === "no-capacity") {
		log(label, "capacity.exhausted", { waitedMs: Date.now() - startedAt });
		return {
			elapsedMs: Date.now() - startedAt,
			status: "no-capacity",
			volume,
		};
	}
	const pod = acquired;
	try {
		const ready = await waitForSentinel(pod.podId, label);
		await terminatePod(ctx, pod.podId);
		return {
			elapsedMs: Date.now() - startedAt,
			gpuTypeId: pod.gpuTypeId,
			podId: pod.podId,
			status: ready ? "seeded" : "timeout",
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
		cloudType:
			process.env.RUNPOD_LTX23_POD_CLOUD_TYPE === "COMMUNITY"
				? "COMMUNITY"
				: "SECURE",
	};
	const volumes = await listVolumes(ctx);
	log("init", "discovered-volumes", {
		count: volumes.length,
		names: volumes.map((v) => v.name),
	});
	if (volumes.length === 0) {
		throw new Error("No ltx23-* volumes discovered via /networkvolumes");
	}

	const settled = await Promise.allSettled(
		volumes.map((volume) => seedVolume(ctx, volume))
	);
	const results: SeedResult[] = settled.map((s, idx) => {
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

	console.log(`\n[${ts()}] SEED SUMMARY:`);
	for (const r of results) {
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
			`  ${r.volume.name.padEnd(24)} ${r.status.padEnd(20)} ${sec}s  ${extras.join(" ")}`
		);
	}
	const ok = results.filter(
		(r) => r.status === "seeded" || r.status === "already-seeded"
	).length;
	const failed = results.length - ok;
	console.log(`\nseeded=${ok} failed=${failed} total=${results.length}`);
	if (failed > 0) {
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(`[${ts()}] seed.fatal`, error);
	process.exitCode = 1;
});
