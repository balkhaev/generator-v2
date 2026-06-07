/* biome-ignore-all lint/suspicious/noConsole: seed script */
export {};

/**
 * Пре-сидит веса VoxCPM2 в HF cache на `voxcpm-*` network volume, чтобы
 * serverless cold start не качал ~6 GB из HuggingFace.
 *
 * Serverless worker монтирует volume в `/runpod-volume` и читает HF cache из
 * `HF_HOME=/runpod-volume/hf-cache`. Seed-под монтирует тот же volume в
 * `/workspace`, поэтому HF_HOME здесь = `/workspace/hf-cache` (тот же том).
 *
 *   RUNPOD_API_KEY=rpa_xxx
 *   RUNPOD_VOXCPM_SEED_VOLUMES=id1,id2   (опц.; иначе все voxcpm-*)
 *   HF_TOKEN=hf_xxx                      (опц., для HF rate limits)
 *
 *   bun run packages/runpod/scripts/seed-voxcpm-models.ts
 */

const RUNPOD_BASE_URL = "https://rest.runpod.io/v1";
const SEEDER_IMAGE = "python:3.11-slim";
const SEEDER_HTTP_PORT = 8080;
const SENTINEL_PATH = "VOXCPM2_MODELS_SEED_DONE_v1";
const MODEL_ID = "openbmb/VoxCPM2";

const COMMUNITY_GPU_FALLBACKS = [
	"NVIDIA GeForce RTX 4090",
	"NVIDIA RTX A5000",
	"NVIDIA RTX A4500",
	"NVIDIA RTX A4000",
	"NVIDIA L4",
];

function buildSeedScript(): string {
	const tokenExport = process.env.HF_TOKEN?.trim()
		? `export HF_TOKEN="${process.env.HF_TOKEN.trim()}"`
		: "";
	return `
set -e
echo "[seed] voxcpm2 models start $(date -Is)"
if [ -f /workspace/${SENTINEL_PATH} ]; then
  echo "[seed] sentinel present"
else
  ${tokenExport}
  export HF_HOME=/workspace/hf-cache
  mkdir -p /workspace/hf-cache
  pip install --no-cache-dir -U "huggingface_hub[cli]"
  hf download ${MODEL_ID}
  touch /workspace/${SENTINEL_PATH}
  echo "[seed] done $(date -Is)"
fi
cd /workspace
exec python3 -m http.server ${SEEDER_HTTP_PORT}
`.trim();
}

async function runpodRequest(
	apiKey: string,
	method: "GET" | "POST" | "DELETE",
	path: string,
	body?: unknown
): Promise<Response> {
	return await fetch(`${RUNPOD_BASE_URL}${path}`, {
		body: body === undefined ? undefined : JSON.stringify(body),
		headers: {
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
		},
		method,
	});
}

async function listTargetVolumes(
	apiKey: string
): Promise<Array<{ dataCenterId: string; id: string; name: string }>> {
	const explicit = process.env.RUNPOD_VOXCPM_SEED_VOLUMES?.trim();
	const response = await runpodRequest(apiKey, "GET", "/networkvolumes");
	if (!response.ok) {
		throw new Error(`GET /networkvolumes: ${await response.text()}`);
	}
	const body = (await response.json()) as Array<{
		dataCenterId: string;
		id: string;
		name: string;
	}>;
	if (explicit) {
		const ids = explicit.split(",").map((s) => s.trim());
		return body.filter((v) => ids.includes(v.id));
	}
	return body.filter((v) => v.name.startsWith("voxcpm-"));
}

async function main(): Promise<void> {
	const apiKey = process.env.RUNPOD_API_KEY?.trim();
	if (!apiKey) {
		throw new Error("RUNPOD_API_KEY required");
	}
	const volumes = await listTargetVolumes(apiKey);
	if (volumes.length === 0) {
		throw new Error(
			"No voxcpm-* volumes (create in RunPod or set RUNPOD_VOXCPM_SEED_VOLUMES)"
		);
	}
	console.log(`[seed-voxcpm-models] volumes=${volumes.length}`);
	for (const volume of volumes) {
		let created = false;
		for (const gpu of COMMUNITY_GPU_FALLBACKS) {
			const response = await runpodRequest(apiKey, "POST", "/pods", {
				cloudType: "COMMUNITY",
				containerDiskInGb: 10,
				dockerEntrypoint: ["/bin/bash", "-lc"],
				dockerStartCmd: [buildSeedScript()],
				gpuCount: 1,
				gpuTypeIds: [gpu],
				imageName: SEEDER_IMAGE,
				name: `seed-voxcpm-${volume.name}-${Date.now().toString(36)}`,
				networkVolumeId: volume.id,
				ports: [`${SEEDER_HTTP_PORT}/http`],
				volumeMountPath: "/workspace",
			});
			if (response.ok) {
				const pod = (await response.json()) as { id: string };
				console.log(
					`[${volume.name}] pod ${pod.id} on ${gpu} — poll ${SENTINEL_PATH} then terminate`
				);
				created = true;
				break;
			}
		}
		if (!created) {
			console.warn(`[${volume.name}] no capacity on any GPU`);
		}
	}
	console.log("\nTip: terminate seed pods after sentinel file appears.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
