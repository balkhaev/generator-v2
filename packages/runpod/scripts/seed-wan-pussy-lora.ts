/* biome-ignore-all lint/suspicious/noConsole: seed script */
export {};

/**
 * Скачивает Civitai «Wan2.2 - Pussy» (model 1895314 / version 2145434) zip,
 * распаковывает high/low LoRA на volume под фиксированными именами:
 *
 *   loras/wan22-pussy-high_noise.safetensors
 *   loras/wan22-pussy-low_noise.safetensors
 *
 * Env:
 *   RUNPOD_API_KEY
 *   CIVITAI_API_KEY or CIVITAI_API_TOKEN
 *   RUNPOD_WAN22_SEED_VOLUMES=id1,id2  (опц.)
 *
 *   bun run packages/runpod/scripts/seed-wan-pussy-lora.ts
 */

const RUNPOD_BASE_URL = "https://rest.runpod.io/v1";
const SEEDER_IMAGE = "python:3.11-slim";
const SEEDER_HTTP_PORT = 8080;
const SENTINEL_PATH = "WAN22_PUSSY_LORA_SEED_DONE_v1";
const CIVITAI_VERSION_ID = "2145434";
const HIGH_OUT = "wan22-pussy-high_noise.safetensors";
const LOW_OUT = "wan22-pussy-low_noise.safetensors";

const COMMUNITY_GPU_FALLBACKS = [
	"NVIDIA GeForce RTX 4090",
	"NVIDIA RTX A5000",
	"NVIDIA RTX A4500",
	"NVIDIA L4",
];

function buildSeedScript(civitaiToken: string): string {
	const downloadUrl = `https://civitai.com/api/download/models/${CIVITAI_VERSION_ID}?token=${civitaiToken}`;
	return `
set -e
echo "[pussy-lora] start $(date -Is)"
if [ -f /workspace/${SENTINEL_PATH} ]; then
  echo "[pussy-lora] sentinel present"
else
  apt-get update -qq && apt-get install -y --no-install-recommends wget unzip ca-certificates
  mkdir -p /workspace/ComfyUI/models/loras /tmp/pussy-lora
  cd /tmp/pussy-lora
  wget --no-verbose -O pussy.zip "${downloadUrl}"
  unzip -o pussy.zip
  HIGH=$(find . -iname '*high*noise*.safetensors' | head -1)
  LOW=$(find . -iname '*low*noise*.safetensors' | head -1)
  if [ -z "$HIGH" ] || [ -z "$LOW" ]; then
    echo "[pussy-lora] could not find high/low safetensors in zip"
    find . -name '*.safetensors'
    exit 1
  fi
  cp "$HIGH" /workspace/ComfyUI/models/loras/${HIGH_OUT}
  cp "$LOW" /workspace/ComfyUI/models/loras/${LOW_OUT}
  touch /workspace/${SENTINEL_PATH}
  echo "[pussy-lora] installed ${HIGH_OUT} and ${LOW_OUT}"
fi
cd /workspace
exec python3 -m http.server ${SEEDER_HTTP_PORT}
`.trim();
}

async function runpodRequest(
	apiKey: string,
	method: "GET" | "POST",
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

async function listTargetVolumes(apiKey: string) {
	const explicit = process.env.RUNPOD_WAN22_SEED_VOLUMES?.trim();
	const response = await runpodRequest(apiKey, "GET", "/networkvolumes");
	if (!response.ok) {
		throw new Error(await response.text());
	}
	const body = (await response.json()) as Array<{
		id: string;
		name: string;
	}>;
	if (explicit) {
		const ids = explicit.split(",").map((s) => s.trim());
		return body.filter((v) => ids.includes(v.id));
	}
	return body.filter((v) => v.name.startsWith("wan22-"));
}

async function main(): Promise<void> {
	const apiKey = process.env.RUNPOD_API_KEY?.trim();
	const civitaiToken =
		process.env.CIVITAI_API_KEY?.trim() ||
		process.env.CIVITAI_API_TOKEN?.trim();
	if (!(apiKey && civitaiToken)) {
		throw new Error("RUNPOD_API_KEY and CIVITAI_API_KEY required");
	}
	const volumes = await listTargetVolumes(apiKey);
	if (volumes.length === 0) {
		throw new Error("No wan22-* volumes");
	}
	const script = buildSeedScript(civitaiToken);
	for (const volume of volumes) {
		for (const gpu of COMMUNITY_GPU_FALLBACKS) {
			const response = await runpodRequest(apiKey, "POST", "/pods", {
				cloudType: "COMMUNITY",
				containerDiskInGb: 10,
				dockerEntrypoint: ["/bin/bash", "-lc"],
				dockerStartCmd: [script],
				gpuCount: 1,
				gpuTypeIds: [gpu],
				imageName: SEEDER_IMAGE,
				name: `seed-pussy-lora-${volume.name}-${Date.now().toString(36)}`,
				networkVolumeId: volume.id,
				ports: [`${SEEDER_HTTP_PORT}/http`],
				volumeMountPath: "/workspace",
			});
			if (response.ok) {
				const pod = (await response.json()) as { id: string };
				console.log(`[${volume.name}] pod ${pod.id}`);
				break;
			}
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
