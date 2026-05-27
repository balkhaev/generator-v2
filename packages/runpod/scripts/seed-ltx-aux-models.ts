/* biome-ignore-all lint/suspicious/noConsole: seed script reports human-readable timeline */
export {};

/**
 * Подгружает на RunPod network volume(ы) дополнительные модели, которых
 * нет в Sulphur seed:
 *
 *   - `LTX23_audio_vae_bf16.safetensors` (365 MB) → `ComfyUI/models/vae/`
 *     (требуется LTX2 sampler — без него ConcatAVLatent не строит AV latent
 *     и SamplerCustomAdvanced падает с `too many values to unpack`)
 *
 *   - `ltx-2.3-spatial-upscaler-x2-1.1.safetensors` (996 MB) →
 *     `ComfyUI/models/latent_upscale_models/`
 *     (нужно для второго pass'а LTXVLatentUpsampler; без него мы вынуждены
 *     bypass'ить spatial upscale → понижается качество)
 *
 * Селект volume'ов:
 *   - Если задан `RUNPOD_AUX_SEED_VOLUMES=id1,id2,…`, используем их
 *   - Иначе по умолчанию подгружаем ТОЛЬКО на volume serverless LTX endpoint'а
 *     (`eogecujak8`, US-CA-2) — этот один используется для текущего инференса
 *   - Чтобы залить на все ltx23-volumes, передай `RUNPOD_AUX_SEED_ALL=true`
 */

const RUNPOD_BASE_URL = "https://rest.runpod.io/v1";
const SEEDER_IMAGE = "python:3.11-slim";
const SEEDER_HTTP_PORT = 8080;
const SENTINEL_PATH = "LTX_AUX_SEED_DONE_v1";

const AUDIO_VAE_URL =
	"https://huggingface.co/Kijai/LTX2.3_comfy/resolve/main/vae/LTX23_audio_vae_bf16.safetensors";
const AUDIO_VAE_FILE = "LTX23_audio_vae_bf16.safetensors";

const SPATIAL_UPSCALER_URL =
	"https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-spatial-upscaler-x2-1.1.safetensors";
const SPATIAL_UPSCALER_FILE = "ltx-2.3-spatial-upscaler-x2-1.1.safetensors";

const DEFAULT_VOLUME_ID = "eogecujak8";

const VOLUME_CAPACITY_TIMEOUT_MS = 30 * 60 * 1000;
const VOLUME_CAPACITY_RETRY_MS = 60 * 1000;
const DOWNLOAD_READY_TIMEOUT_MS = 30 * 60 * 1000;
const DOWNLOAD_READY_POLL_MS = 15 * 1000;
const CONTAINER_DISK_GB = 6;
const SEED_PORT_SPEC = `${SEEDER_HTTP_PORT}/http`;

const NO_CAPACITY_PATTERN =
	/no instances|does not have the resources|no resources|out of stock|no available|capacity|could not find any pods with required specifications/iu;

const COMMUNITY_GPU_FALLBACKS = [
	"NVIDIA L4",
	"NVIDIA L40",
	"NVIDIA L40S",
	"NVIDIA RTX A4000",
	"NVIDIA RTX A4500",
	"NVIDIA RTX A5000",
	"NVIDIA RTX A6000",
	"NVIDIA RTX 4000 Ada Generation",
	"NVIDIA RTX 5000 Ada Generation",
	"NVIDIA RTX 6000 Ada Generation",
	"NVIDIA A40",
	"NVIDIA A30",
	"NVIDIA A100 80GB PCIe",
	"NVIDIA A100-SXM4-80GB",
	"NVIDIA H100 PCIe",
	"NVIDIA H100 NVL",
	"NVIDIA H100 80GB HBM3",
	"NVIDIA GeForce RTX 4090",
	"NVIDIA GeForce RTX 4080",
	"NVIDIA GeForce RTX 3090",
	"NVIDIA GeForce RTX 3080",
	"Tesla T4",
];

interface VolumeEntry {
	dataCenterId: string;
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

async function listAllLtxVolumes(ctx: RunpodApiCtx): Promise<VolumeEntry[]> {
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
	return body
		.filter((v) => v.name.startsWith("ltx23-"))
		.map((v) => ({
			dataCenterId: v.dataCenterId,
			id: v.id,
			name: v.name,
		}));
}

async function resolveSeedTargets(ctx: RunpodApiCtx): Promise<VolumeEntry[]> {
	const explicitIds = (process.env.RUNPOD_AUX_SEED_VOLUMES ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const all = await listAllLtxVolumes(ctx);
	if (explicitIds.length > 0) {
		return all.filter((v) => explicitIds.includes(v.id));
	}
	if (process.env.RUNPOD_AUX_SEED_ALL === "true") {
		return all;
	}
	const single = all.find((v) => v.id === DEFAULT_VOLUME_ID);
	return single ? [single] : [];
}

function buildSeedScript(): string {
	const wgetCommon =
		"--continue --tries=20 --waitretry=10 --timeout=120 --no-verbose";
	return `
set -e
echo "[seed] start at $(date -Is)"
if [ -f /workspace/${SENTINEL_PATH} ]; then
  echo "[seed] sentinel present — already seeded"
else
  apt-get update -qq && apt-get install -y --no-install-recommends wget ca-certificates
  mkdir -p /workspace/ComfyUI/models/vae /workspace/ComfyUI/models/latent_upscale_models
  cd /workspace/ComfyUI/models/vae
  echo "[seed] downloading ${AUDIO_VAE_FILE} (365 MB)"
  wget ${wgetCommon} -O ${AUDIO_VAE_FILE} "${AUDIO_VAE_URL}"
  cd /workspace/ComfyUI/models/latent_upscale_models
  echo "[seed] downloading ${SPATIAL_UPSCALER_FILE} (996 MB)"
  wget ${wgetCommon} -O ${SPATIAL_UPSCALER_FILE} "${SPATIAL_UPSCALER_URL}"
  touch /workspace/${SENTINEL_PATH}
  echo "[seed] done at $(date -Is)"
fi
cd /workspace
exec python3 -m http.server ${SEEDER_HTTP_PORT}
`.trim();
}

async function createSeederPod(
	ctx: RunpodApiCtx,
	volume: VolumeEntry,
	gpuTypeId: string
): Promise<{ id: string }> {
	const safeName = `seed-ltx-aux-${volume.name.replace(/[^a-z0-9-]+/giu, "-")}-${Date.now().toString(36)}`;
	const response = await runpodRequest(ctx, "POST", "/pods", {
		cloudType: ctx.cloudType,
		containerDiskInGb: CONTAINER_DISK_GB,
		dockerEntrypoint: ["/bin/bash", "-lc"],
		dockerStartCmd: [buildSeedScript()],
		env: { HF_HUB_ENABLE_HF_TRANSFER: "1" },
		gpuCount: 1,
		gpuTypeIds: [gpuTypeId],
		gpuTypePriority: "availability",
		imageName: SEEDER_IMAGE,
		name: safeName,
		networkVolumeId: volume.id,
		ports: [SEED_PORT_SPEC],
		volumeMountPath: "/workspace",
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`POST /pods failed (${response.status}): ${text}`);
	}
	const body = JSON.parse(text) as { id: string };
	return body;
}

async function waitForSentinel(
	podId: string,
	label: string
): Promise<"ready" | "timeout"> {
	const startedAt = Date.now();
	const url = `https://${podId}-${SEEDER_HTTP_PORT}.proxy.runpod.net/${SENTINEL_PATH}`;
	while (Date.now() - startedAt < DOWNLOAD_READY_TIMEOUT_MS) {
		try {
			const res = await fetch(url, { method: "GET" });
			if (res.status === 200) {
				return "ready";
			}
			log(label, "sentinel.still-downloading", {
				elapsedSec: Math.round((Date.now() - startedAt) / 1000),
				status: res.status,
			});
		} catch (err) {
			log(label, "sentinel.poll-error", {
				elapsedSec: Math.round((Date.now() - startedAt) / 1000),
				err: err instanceof Error ? err.message : String(err),
			});
		}
		await sleep(DOWNLOAD_READY_POLL_MS);
	}
	return "timeout";
}

async function terminatePod(ctx: RunpodApiCtx, podId: string): Promise<void> {
	const res = await runpodRequest(ctx, "DELETE", `/pods/${podId}`);
	if (!res.ok) {
		const text = await res.text();
		log("cleanup", "pod.delete-failed", { podId, status: res.status, text });
	}
}

async function seedVolume(
	ctx: RunpodApiCtx,
	volume: VolumeEntry
): Promise<SeedResult> {
	const label = `vol:${volume.name}`;
	const start = Date.now();
	const capacityDeadline = Date.now() + VOLUME_CAPACITY_TIMEOUT_MS;
	let lastError = "";
	while (Date.now() < capacityDeadline) {
		for (const gpuTypeId of COMMUNITY_GPU_FALLBACKS) {
			try {
				log(label, "pod.create", { gpuTypeId });
				const pod = await createSeederPod(ctx, volume, gpuTypeId);
				log(label, "pod.created", { gpuTypeId, podId: pod.id });
				const status = await waitForSentinel(pod.id, label);
				await terminatePod(ctx, pod.id);
				if (status === "timeout") {
					return {
						elapsedMs: Date.now() - start,
						gpuTypeId,
						podId: pod.id,
						status: "timeout",
						volume,
					};
				}
				return {
					elapsedMs: Date.now() - start,
					gpuTypeId,
					podId: pod.id,
					status: "seeded",
					volume,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				lastError = message;
				if (!isNoCapacity(message)) {
					return {
						elapsedMs: Date.now() - start,
						error: message,
						gpuTypeId,
						status: "error",
						volume,
					};
				}
				log(label, "pod.no-capacity", { gpuTypeId });
			}
		}
		log(label, "capacity.retry", {
			waitMs: VOLUME_CAPACITY_RETRY_MS,
		});
		await sleep(VOLUME_CAPACITY_RETRY_MS);
	}
	return {
		elapsedMs: Date.now() - start,
		error: lastError,
		status: "no-capacity",
		volume,
	};
}

function isNoCapacity(message: string): boolean {
	return NO_CAPACITY_PATTERN.test(message);
}

async function main(): Promise<void> {
	const apiKey = process.env.RUNPOD_API_KEY;
	if (!apiKey) {
		console.error("RUNPOD_API_KEY env required");
		process.exit(1);
	}
	const ctx: RunpodApiCtx = {
		apiKey,
		cloudType:
			process.env.RUNPOD_CLOUD_TYPE === "SECURE" ? "SECURE" : "COMMUNITY",
	};
	const targets = await resolveSeedTargets(ctx);
	if (targets.length === 0) {
		console.error("No volumes to seed (set RUNPOD_AUX_SEED_VOLUMES or _ALL)");
		process.exit(1);
	}
	log("seed", "start", {
		count: targets.length,
		ids: targets.map((v) => v.id),
	});
	const results = await Promise.all(targets.map((v) => seedVolume(ctx, v)));
	log("seed", "complete", {
		summary: results.map((r) => ({
			elapsedSec: Math.round(r.elapsedMs / 1000),
			id: r.volume.id,
			name: r.volume.name,
			status: r.status,
		})),
	});
	const failed = results.filter(
		(r) => r.status !== "seeded" && r.status !== "already-seeded"
	);
	if (failed.length > 0) {
		console.error("Some volumes failed:", failed);
		process.exit(2);
	}
}

await main();
