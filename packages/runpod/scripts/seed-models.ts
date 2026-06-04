/* biome-ignore-all lint/suspicious/noConsole: ops seed script reports human-readable timeline */
import {
	LTX_SYNTH_PUSSY_LORA_FILENAME,
	LTX_SYNTH_PUSSY_LORA_VERSION_ID,
} from "../src/civitai-lora-filenames";

/**
 * Засев ВСЕХ моделей (LTX/Sulphur + WAN 2.2 + Flux + LoRA) на один network
 * volume для персистентного ComfyUI-пода.
 *
 * RunPod монтирует network volume только к ОДНОМУ pod'у одновременно, поэтому:
 *   1. Удаляет ComfyUI-под (`generator-comfyui-pro6000`), освобождая volume.
 *   2. Поднимает дешёвый seeder-под (python:3.11-slim) на этом volume,
 *      качает все веса в /workspace/ComfyUI/models/... (идемпотентно: sentinel
 *      + wget --continue), затем поднимает http.server для readiness-пробы.
 *   3. Поллит sentinel до готовности и удаляет seeder.
 *   4. Печатает команду пересоздания ComfyUI-пода (migrate-to-pod --pod-only).
 *
 * Layout совпадает с extra_model_paths.yaml образа worker-ltx-comfyui:
 *   volume root → /workspace (seeder) == /runpod-volume (ComfyUI pod)
 *   модели в    → ComfyUI/models/{diffusion_models,loras,vae,text_encoders,...}
 *
 * Env:
 *   RUNPOD_API_KEY   (обяз.)
 *   HF_TOKEN         (опц. — Authorization для HF; снимает rate-limit/gating)
 *   CIVITAI_API_KEY  (обяз. для Wan Pussy LoRA)
 *
 * Запуск:
 *   ... bun run packages/runpod/scripts/seed-models.ts --volume-id=<id> --dc=EU-RO-1            # dry-run
 *   ... bun run packages/runpod/scripts/seed-models.ts --volume-id=<id> --dc=EU-RO-1 --apply    # live
 */

const REST_BASE = "https://rest.runpod.io/v1";
const SEEDER_IMAGE = "python:3.11-slim";
const SEEDER_PORT = 8080;
const SENTINEL = "GENERATOR_MODELS_SEED_v5";
const COMFY_POD_NAME = "generator-comfyui-pro6000";
const CIVITAI_VERSION_ID = "2145434";

// Flux «Noisify» LoRA: имя на volume и источник (наш S3, без токена). Должно
// совпадать с RUNPOD_FLUX_NOISIFY_LORA_FILENAME / _SOURCE_URL из
// packages/workflows (сценарий runpod-flux-dev-image, loraFilename=noisify.safetensors).
const NOISIFY_LORA_FILENAME = "noisify.safetensors";
const NOISIFY_LORA_SOURCE_URL =
	"https://hel1.your-objectstorage.com/generator/loras/external/external-7919a4063730eca7.safetensors";

const CONTAINER_DISK_GB = 20;
const READY_TIMEOUT_MS = 120 * 60 * 1000;
const READY_POLL_MS = 30 * 1000;

// Дешёвые GPU в EU-RO-1 (seeder'у нужны только сеть+диск). Перебор при capacity.
const SEEDER_GPU_FALLBACKS = [
	"NVIDIA L4",
	"NVIDIA RTX 2000 Ada Generation",
	"NVIDIA RTX A4500",
	"NVIDIA RTX 4000 Ada Generation",
	"NVIDIA GeForce RTX 4090",
	// Последний резерв — та же RTX PRO 6000, что и у ComfyUI-пода (стабильно
	// доступна в EU-RO-1). Дороже, но seeder живёт пару минут.
	"NVIDIA RTX PRO 6000 Blackwell Server Edition",
	"NVIDIA RTX PRO 6000 Blackwell Workstation Edition",
];

const NO_CAPACITY_PATTERN =
	/no instances|does not have the resources|no resources|out of stock|no available|capacity|could not find any pods/iu;

interface ModelFile {
	dir: string;
	name: string;
	url: string;
}

// HF-репозитории (public/gated; HF_TOKEN добавляется заголовком при наличии).
const HF_WAN =
	"https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files";
const HF_SULPHUR =
	"https://huggingface.co/SulphurAI/Sulphur-2-base/resolve/main";

const MODEL_FILES: ModelFile[] = [
	// LTX 2.3 / Sulphur-2
	{
		dir: "diffusion_models",
		name: "sulphur_dev_fp8mixed.safetensors",
		url: `${HF_SULPHUR}/sulphur_dev_fp8mixed.safetensors`,
	},
	{
		dir: "loras",
		name: "sulphur_distil_lora.safetensors",
		url: `${HF_SULPHUR}/distill_loras/ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors`,
	},
	{
		dir: "vae",
		name: "LTX23_audio_vae_bf16.safetensors",
		url: "https://huggingface.co/Kijai/LTX2.3_comfy/resolve/main/vae/LTX23_audio_vae_bf16.safetensors",
	},
	{
		dir: "latent_upscale_models",
		name: "ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
		url: "https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
	},
	// LTX 2.3 aux: video VAE + TAE preview + text encoders. Подпапки (`vae/`,
	// `text_encoders/`, `comfyui/`) СОХРАНЯЮТСЯ под models/, потому что граф
	// ltx-2-3-i2v ссылается на них с этими префиксами (combo ComfyUI показывает
	// путь относительно корня типа модели). Не переименовывать!
	{
		dir: "vae/vae",
		name: "LTX23_video_vae_bf16.safetensors",
		url: "https://huggingface.co/Kijai/LTX2.3_comfy/resolve/main/vae/LTX23_video_vae_bf16.safetensors",
	},
	{
		dir: "vae/vae",
		name: "taeltx2_3.safetensors",
		url: "https://huggingface.co/Kijai/LTX2.3_comfy/resolve/main/vae/taeltx2_3.safetensors",
	},
	{
		dir: "text_encoders/text_encoders",
		name: "ltx-2.3_text_projection_bf16.safetensors",
		url: "https://huggingface.co/Kijai/LTX2.3_comfy/resolve/main/text_encoders/ltx-2.3_text_projection_bf16.safetensors",
	},
	{
		dir: "text_encoders/comfyui",
		name: "gemma-3-12b-it-heretic-v2.safetensors",
		url: "https://huggingface.co/DreamFast/gemma-3-12b-it-heretic-v2/resolve/main/comfyui/gemma-3-12b-it-heretic-v2.safetensors",
	},
	// WAN 2.2 I2V
	{
		dir: "diffusion_models",
		name: "wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors",
		url: `${HF_WAN}/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors`,
	},
	{
		dir: "diffusion_models",
		name: "wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors",
		url: `${HF_WAN}/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors`,
	},
	{
		dir: "text_encoders",
		name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
		url: `${HF_WAN}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors`,
	},
	{
		dir: "vae",
		name: "wan_2.1_vae.safetensors",
		url: `${HF_WAN}/vae/wan_2.1_vae.safetensors`,
	},
	// Flux.1-dev all-in-one fp8
	{
		dir: "checkpoints",
		name: "flux1-dev-fp8.safetensors",
		url: "https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors",
	},
	// Flux «Noisify» LoRA — наш S3 (RUNPOD_FLUX_NOISIFY_LORA_SOURCE_URL в
	// packages/workflows). Сценарий runpod-flux-dev-image, loraFilename=noisify.safetensors.
	{
		dir: "loras",
		name: NOISIFY_LORA_FILENAME,
		url: NOISIFY_LORA_SOURCE_URL,
	},
];

interface Cli {
	apply: boolean;
	dc?: string;
	keepSeeder: boolean;
	volumeId?: string;
}

function parseCli(argv: string[]): Cli {
	const cli: Cli = { apply: false, keepSeeder: false };
	for (const raw of argv) {
		if (raw === "--apply") {
			cli.apply = true;
		} else if (raw === "--keep-seeder") {
			cli.keepSeeder = true;
		} else if (raw.startsWith("--volume-id=")) {
			cli.volumeId = raw.slice("--volume-id=".length);
		} else if (raw.startsWith("--dc=")) {
			cli.dc = raw.slice("--dc=".length);
		}
	}
	return cli;
}

function requireEnv(key: string): string {
	const value = process.env[key];
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}

function ts(): string {
	return new Date().toISOString().slice(11, 19);
}

function log(event: string, fields: unknown = {}): void {
	console.log(`[${ts()}] ${event}`, fields);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function rest(
	method: "GET" | "POST" | "DELETE",
	path: string,
	body?: unknown
): Promise<unknown> {
	const response = await fetch(`${REST_BASE}${path}`, {
		body: body === undefined ? undefined : JSON.stringify(body),
		headers: {
			authorization: `Bearer ${requireEnv("RUNPOD_API_KEY")}`,
			"content-type": "application/json",
		},
		method,
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
	}
	return text ? JSON.parse(text) : {};
}

function buildSeedScript(): string {
	const hfToken = process.env.HF_TOKEN?.trim();
	const civitai =
		process.env.CIVITAI_API_KEY?.trim() ??
		process.env.CIVITAI_API_TOKEN?.trim();
	// aria2c: 16 параллельных соединений на файл + resume докачивает частичные
	// файлы, оставшиеся от прерванного wget (range-запросы к HF CDN).
	const aria =
		"aria2c -c -x16 -s16 -k1M --console-log-level=warn --summary-interval=0 --max-tries=20 --retry-wait=10";
	const hfAuth = hfToken ? ` --header="Authorization: Bearer ${hfToken}"` : "";
	// Civitai за Cloudflare: aria2c UA блокируется на dc-IP, range игнорится.
	// Качаем curl'ом с браузерным UA (-L follow redirect).
	const browserUa =
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

	const downloads = MODEL_FILES.map(
		(f) => `
mkdir -p /workspace/ComfyUI/models/${f.dir}
echo "[seed] ${f.name}" | tee -a /workspace/seed.log
${aria}${hfAuth} -d /workspace/ComfyUI/models/${f.dir} -o ${f.name} "${f.url}" || echo "[seed][WARN] failed ${f.name}" | tee -a /workspace/seed.log`
	).join("");

	// Wan Pussy LoRA — Civitai zip → распаковка в фиксированные имена.
	const civitaiBlock = civitai
		? `
echo "[seed] wan22 pussy lora (civitai ${CIVITAI_VERSION_ID})" | tee -a /workspace/seed.log
mkdir -p /tmp/pussy && cd /tmp/pussy
curl -fSL -A "${browserUa}" -o pussy.zip "https://civitai.com/api/download/models/${CIVITAI_VERSION_ID}?token=${civitai}" 2>>/workspace/seed.log && file pussy.zip | tee -a /workspace/seed.log && unzip -o pussy.zip 2>&1 | tee -a /workspace/seed.log || echo "[seed][WARN] civitai download/unzip failed" | tee -a /workspace/seed.log
HIGH=$(find . -iname '*high*noise*.safetensors' | head -1)
LOW=$(find . -iname '*low*noise*.safetensors' | head -1)
echo "[seed] pussy HIGH=$HIGH LOW=$LOW" | tee -a /workspace/seed.log
[ -n "$HIGH" ] && cp "$HIGH" /workspace/ComfyUI/models/loras/wan22-pussy-high_noise.safetensors
[ -n "$LOW" ] && cp "$LOW" /workspace/ComfyUI/models/loras/wan22-pussy-low_noise.safetensors
cd /workspace`
		: '\necho "[seed][WARN] CIVITAI_API_KEY missing — skip pussy lora"';

	// LTX 2.3 «Synth Pussy» LoRA — имя ${LTX_SYNTH_PUSSY_LORA_FILENAME} (см.
	// civitai-lora-filenames.ts). Guard по файлу; выполняется даже при sentinel.
	const ltxSynthTarget = `/workspace/ComfyUI/models/loras/${LTX_SYNTH_PUSSY_LORA_FILENAME}`;
	const ltxSynthBlock = civitai
		? `
if [ -s "${ltxSynthTarget}" ]; then
  echo "[seed] ltx synth lora present — skip" | tee -a /workspace/seed.log
else
  echo "[seed] ltx synth lora (civitai ${LTX_SYNTH_PUSSY_LORA_VERSION_ID})" | tee -a /workspace/seed.log
  mkdir -p /workspace/ComfyUI/models/loras
  curl -fSL -A "${browserUa}" -o "${ltxSynthTarget}.part" "https://civitai.com/api/download/models/${LTX_SYNTH_PUSSY_LORA_VERSION_ID}?token=${civitai}" 2>>/workspace/seed.log && mv "${ltxSynthTarget}.part" "${ltxSynthTarget}" && echo "[seed] ltx synth lora OK" | tee -a /workspace/seed.log || echo "[seed][WARN] ltx synth lora download failed" | tee -a /workspace/seed.log
fi`
		: '\necho "[seed][WARN] CIVITAI_API_KEY missing — skip ltx synth lora"';

	// Flux «Noisify» LoRA — наш S3 (без токена). Guard по файлу; выполняется даже
	// при sentinel, чтобы досеять LoRA на уже залитый том без полного пересида.
	const noisifyTarget = `/workspace/ComfyUI/models/loras/${NOISIFY_LORA_FILENAME}`;
	const noisifyBlock = `
if [ -s "${noisifyTarget}" ]; then
  echo "[seed] noisify lora present — skip" | tee -a /workspace/seed.log
else
  echo "[seed] noisify lora (s3)" | tee -a /workspace/seed.log
  mkdir -p /workspace/ComfyUI/models/loras
  curl -fSL -o "${noisifyTarget}.part" "${NOISIFY_LORA_SOURCE_URL}" 2>>/workspace/seed.log && mv "${noisifyTarget}.part" "${noisifyTarget}" && echo "[seed] noisify lora OK" | tee -a /workspace/seed.log || echo "[seed][WARN] noisify lora download failed" | tee -a /workspace/seed.log
fi`;

	return `
set +e
echo "[seed] start $(date -Is)" | tee /workspace/seed.log
apt-get update -qq && apt-get install -y --no-install-recommends aria2 curl unzip file ca-certificates >> /workspace/seed.log 2>&1
if [ -f /workspace/${SENTINEL} ]; then
  echo "[seed] sentinel present — bulk already seeded" | tee -a /workspace/seed.log
else
  ${downloads}
  ${civitaiBlock}
  touch /workspace/${SENTINEL}
  echo "[seed] done $(date -Is)" | tee -a /workspace/seed.log
fi
${ltxSynthBlock}
${noisifyBlock}
du -sh /workspace/ComfyUI/models/* 2>/dev/null | tee -a /workspace/seed.log
cd /workspace
exec python3 -m http.server ${SEEDER_PORT}
`.trim();
}

async function deleteComfyPod(): Promise<void> {
	const pods = (await rest("GET", "/pods")) as
		| Record<string, unknown>[]
		| { data?: Record<string, unknown>[] };
	const list = Array.isArray(pods) ? pods : (pods.data ?? []);
	for (const pod of list) {
		if (pod.name !== COMFY_POD_NAME) {
			continue;
		}
		log("comfy-pod.delete", { id: pod.id });
		await rest("DELETE", `/pods/${String(pod.id)}`);
	}
}

const CAPACITY_RETRIES = 12;
const CAPACITY_RETRY_MS = 15_000;

async function createSeeder(
	volumeId: string,
	script: string
): Promise<{ id: string }> {
	// Capacity в EU-RO-1 флапает посекундно — несколько проходов по списку GPU.
	let lastErrors: string[] = [];
	for (let round = 1; round <= CAPACITY_RETRIES; round += 1) {
		const errors: string[] = [];
		for (const gpu of SEEDER_GPU_FALLBACKS) {
			try {
				const pod = (await rest("POST", "/pods", {
					cloudType: "SECURE",
					containerDiskInGb: CONTAINER_DISK_GB,
					dockerEntrypoint: ["/bin/bash", "-lc"],
					dockerStartCmd: [script],
					env: { HF_HUB_ENABLE_HF_TRANSFER: "1" },
					gpuCount: 1,
					gpuTypeIds: [gpu],
					gpuTypePriority: "availability",
					imageName: SEEDER_IMAGE,
					name: `seed-models-${Date.now().toString(36)}`,
					networkVolumeId: volumeId,
					ports: [`${SEEDER_PORT}/http`],
					volumeMountPath: "/workspace",
				})) as { id: string };
				log("seeder.created", { gpu, podId: pod.id, round });
				return pod;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!NO_CAPACITY_PATTERN.test(message)) {
					throw error;
				}
				errors.push(`${gpu}: no-capacity`);
			}
		}
		lastErrors = errors;
		log("seeder.capacity-retry", { nextWaitMs: CAPACITY_RETRY_MS, round });
		await sleep(CAPACITY_RETRY_MS);
	}
	throw new Error(
		`seeder: no capacity on any GPU:\n  ${lastErrors.join("\n  ")}`
	);
}

async function waitForSentinel(podId: string): Promise<boolean> {
	const url = `https://${podId}-${SEEDER_PORT}.proxy.runpod.net/${SENTINEL}`;
	const startedAt = Date.now();
	let attempt = 0;
	while (Date.now() - startedAt < READY_TIMEOUT_MS) {
		attempt += 1;
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
			if (res.status === 200) {
				log("seeder.ready", {
					elapsedSec: Math.round((Date.now() - startedAt) / 1000),
				});
				return true;
			}
		} catch {
			// proxy not ready / still downloading
		}
		if (attempt % 4 === 0) {
			log("seeder.downloading", {
				elapsedSec: Math.round((Date.now() - startedAt) / 1000),
			});
		}
		await sleep(READY_POLL_MS);
	}
	return false;
}

async function main(): Promise<void> {
	const cli = parseCli(process.argv.slice(2));
	requireEnv("RUNPOD_API_KEY");
	if (!cli.volumeId) {
		throw new Error("--volume-id=<id> is required");
	}

	log("plan", {
		apply: cli.apply,
		civitai: Boolean(
			process.env.CIVITAI_API_KEY ?? process.env.CIVITAI_API_TOKEN
		),
		files: MODEL_FILES.length,
		hfToken: Boolean(process.env.HF_TOKEN),
		volumeId: cli.volumeId,
	});

	if (!cli.apply) {
		log("dry-run", {
			models: MODEL_FILES.map((f) => `${f.dir}/${f.name}`),
			note: "Re-run with --apply. WARNING: deletes ComfyUI pod, runs seeder, you then recreate the pod.",
		});
		return;
	}

	await deleteComfyPod();
	await sleep(5000);

	const seeder = await createSeeder(cli.volumeId, buildSeedScript());
	const ready = await waitForSentinel(seeder.id);

	if (cli.keepSeeder) {
		log("seeder.kept-alive", {
			logUrl: `https://${seeder.id}-${SEEDER_PORT}.proxy.runpod.net/seed.log`,
			podId: seeder.id,
			ready,
		});
		return;
	}

	log("seeder.terminate", { podId: seeder.id, ready });
	await rest("DELETE", `/pods/${seeder.id}`);

	if (!ready) {
		throw new Error("Seeder timed out before sentinel — inspect seed.log");
	}

	log("done", {
		next: `Recreate ComfyUI pod: bun run packages/runpod/scripts/migrate-to-pod.ts --apply --pod-only --volume-id=${cli.volumeId} --dc=${cli.dc ?? "EU-RO-1"}`,
		volumeId: cli.volumeId,
	});
}

main().catch((error) => {
	console.error(`[${ts()}] seed.fatal`, error);
	process.exitCode = 1;
});
