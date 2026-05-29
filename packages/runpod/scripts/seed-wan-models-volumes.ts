/* biome-ignore-all lint/suspicious/noConsole: seed script */
export {};

/**
 * Заливает Wan 2.2 I2V fp8 base + text encoder + VAE на `wan22-*` volumes.
 *
 *   RUNPOD_API_KEY=rpa_xxx
 *   RUNPOD_WAN22_SEED_VOLUMES=id1,id2   (опц.; иначе все wan22-*)
 *   HF_TOKEN=hf_xxx                     (опц., для HF rate limits)
 *
 *   bun run packages/runpod/scripts/seed-wan-models-volumes.ts
 */

const RUNPOD_BASE_URL = "https://rest.runpod.io/v1";
const SEEDER_IMAGE = "python:3.11-slim";
const SEEDER_HTTP_PORT = 8080;
const SENTINEL_PATH = "WAN22_MODELS_SEED_DONE_v1";
const HF_BASE =
	"https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files";

const FILES = [
	{
		destDir: "ComfyUI/models/diffusion_models",
		name: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
		url: `${HF_BASE}/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors`,
	},
	{
		destDir: "ComfyUI/models/diffusion_models",
		name: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
		url: `${HF_BASE}/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors`,
	},
	{
		destDir: "ComfyUI/models/text_encoders",
		name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
		url: `${HF_BASE}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors`,
	},
	{
		destDir: "ComfyUI/models/vae",
		name: "wan_2.1_vae.safetensors",
		url: `${HF_BASE}/vae/wan_2.1_vae.safetensors`,
	},
] as const;

const COMMUNITY_GPU_FALLBACKS = [
	"NVIDIA GeForce RTX 4090",
	"NVIDIA RTX A5000",
	"NVIDIA RTX A4500",
	"NVIDIA RTX A4000",
	"NVIDIA L4",
];

function buildSeedScript(): string {
	const wgetCommon =
		"--continue --tries=20 --waitretry=10 --timeout=120 --no-verbose";
	const hfHeader = process.env.HF_TOKEN?.trim()
		? `wget ${wgetCommon} --header="Authorization: Bearer ${process.env.HF_TOKEN.trim()}"`
		: `wget ${wgetCommon}`;
	const downloads = FILES.map(
		(f) => `
  mkdir -p /workspace/${f.destDir}
  echo "[seed] ${f.name}"
  ${hfHeader} -O /workspace/${f.destDir}/${f.name} "${f.url}"
`
	).join("");
	return `
set -e
echo "[seed] wan22 models start $(date -Is)"
if [ -f /workspace/${SENTINEL_PATH} ]; then
  echo "[seed] sentinel present"
else
  apt-get update -qq && apt-get install -y --no-install-recommends wget ca-certificates
  ${downloads}
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
	const explicit = process.env.RUNPOD_WAN22_SEED_VOLUMES?.trim();
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
	return body.filter((v) => v.name.startsWith("wan22-"));
}

async function main(): Promise<void> {
	const apiKey = process.env.RUNPOD_API_KEY?.trim();
	if (!apiKey) {
		throw new Error("RUNPOD_API_KEY required");
	}
	const volumes = await listTargetVolumes(apiKey);
	if (volumes.length === 0) {
		throw new Error(
			"No wan22-* volumes (create in RunPod or set RUNPOD_WAN22_SEED_VOLUMES)"
		);
	}
	console.log(`[seed-wan-models] volumes=${volumes.length}`);
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
				name: `seed-wan22-${volume.name}-${Date.now().toString(36)}`,
				networkVolumeId: volume.id,
				ports: [`${SEEDER_HTTP_PORT}/http`],
				volumeMountPath: "/workspace",
			});
			if (response.ok) {
				const pod = (await response.json()) as { id: string };
				console.log(
					`[${volume.name}] pod ${pod.id} on ${gpu} — poll ${SENTINEL_PATH} then terminate manually or via wait script`
				);
				created = true;
				break;
			}
		}
		if (!created) {
			console.warn(`[${volume.name}] no capacity on any GPU`);
		}
	}
	console.log(
		"\nTip: reuse seed-sulphur-volumes polling pattern or terminate pods after sentinel 200."
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
