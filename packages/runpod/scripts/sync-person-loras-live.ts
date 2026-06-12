/* biome-ignore-all lint/suspicious/noConsole: seed script */
export {};

/**
 * Синхронизирует person LoRA с S3 на network volume ComfyUI-пода под именами
 * `{slug}-flux.safetensors` — именно их ждёт `runpod-flux-dev-image` /
 * `generateWithLora` в persons-api.
 *
 * Seeder co-attach'ит тот же volume, что и `generator-comfyui-pro6000`, без
 * остановки основного пода (см. seed-wan-bounce-lora.ts).
 *
 * Env:
 *   RUNPOD_API_KEY — обязателен
 *   RUNPOD_COMFYUI_POD_ID — volume берётся у этого пода
 *   PERSONS_API_URL — default https://persons-api.gen.balkhaev.com
 *   GENERATOR_INTERNAL_TOKEN — для list persons
 *   RUNPOD_PERSON_LORA_SEED_VOLUMES — опц. csv volume ids
 *
 *   bun run packages/runpod/scripts/sync-person-loras-live.ts
 *   bun run packages/runpod/scripts/sync-person-loras-live.ts --slug=mila
 */

const RUNPOD_BASE_URL = "https://rest.runpod.io/v1";
const SEEDER_IMAGE = "python:3.11-slim";
const SEEDER_HTTP_PORT = 8080;
const SENTINEL_PREFIX = "PERSON_LORA_SYNC_v1";
const DEFAULT_VOLUME_NAME = "generator-models";
const DEFAULT_PERSONS_API = "https://persons-api.gen.balkhaev.com";
const TRAILING_SLASH = /\/$/u;

interface PersonRow {
	loraUrl?: string | null;
	metadata?: {
		training?: {
			debug?: { baseModel?: string | null };
			status?: string | null;
		};
	};
	slug: string;
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

async function resolvePodVolumeId(apiKey: string): Promise<string | null> {
	const podId = process.env.RUNPOD_COMFYUI_POD_ID?.trim();
	if (!podId) {
		return null;
	}
	const response = await runpodRequest(apiKey, "GET", `/pods/${podId}`);
	if (!response.ok) {
		return null;
	}
	const pod = (await response.json()) as { networkVolumeId?: string };
	return pod.networkVolumeId ?? null;
}

async function listTargetVolumes(apiKey: string) {
	const explicit = process.env.RUNPOD_PERSON_LORA_SEED_VOLUMES?.trim();
	const response = await runpodRequest(apiKey, "GET", "/networkvolumes");
	if (!response.ok) {
		throw new Error(await response.text());
	}
	const body = (await response.json()) as Array<{ id: string; name: string }>;
	if (explicit) {
		const ids = explicit.split(",").map((s) => s.trim());
		return body.filter((v) => ids.includes(v.id));
	}
	const podVolumeId = await resolvePodVolumeId(apiKey);
	if (podVolumeId) {
		return body.filter((v) => v.id === podVolumeId);
	}
	return body.filter((v) => v.name === DEFAULT_VOLUME_NAME);
}

async function fetchReadyPersons(slugFilter?: string): Promise<PersonRow[]> {
	const base =
		process.env.PERSONS_API_URL?.trim().replace(TRAILING_SLASH, "") ??
		DEFAULT_PERSONS_API;
	const token = process.env.GENERATOR_INTERNAL_TOKEN?.trim();
	if (!token) {
		throw new Error("GENERATOR_INTERNAL_TOKEN required");
	}
	const response = await fetch(`${base}/api/persons`, {
		headers: { "x-generator-internal-token": token },
	});
	if (!response.ok) {
		throw new Error(`persons list failed (${response.status})`);
	}
	const data = (await response.json()) as { persons?: PersonRow[] };
	const rows = data.persons ?? [];
	return rows.filter((p) => {
		if (slugFilter && p.slug !== slugFilter) {
			return false;
		}
		const t = p.metadata?.training;
		const base = t?.debug?.baseModel;
		return Boolean(p.loraUrl) && t?.status === "ready" && base === "flux-dev";
	});
}

function shellEscape(value: string): string {
	return value.replace(/'/gu, `'\\''`);
}

function buildSeedScript(persons: PersonRow[]): string {
	const downloads = persons
		.map((p) => {
			const target = `${p.slug}-flux.safetensors`;
			const url = p.loraUrl ?? "";
			return `
if [ -s "/workspace/ComfyUI/models/loras/${target}" ]; then
  echo "[person-lora] skip ${target} (present)" | tee -a /workspace/person-lora-sync.log
else
  echo "[person-lora] download ${target}" | tee -a /workspace/person-lora-sync.log
  curl -fSL --retry 5 --retry-delay 10 --connect-timeout 30 --max-time 600 \\
    -o "/workspace/ComfyUI/models/loras/${target}.part" '${shellEscape(url)}' \\
    && mv "/workspace/ComfyUI/models/loras/${target}.part" "/workspace/ComfyUI/models/loras/${target}" \\
    && echo "[person-lora] ok ${target}" | tee -a /workspace/person-lora-sync.log \\
    || echo "[person-lora] FAIL ${target}" | tee -a /workspace/person-lora-sync.log
fi`;
		})
		.join("\n");

	return `
set -e
echo "[person-lora] start $(date -Is)" | tee /workspace/person-lora-sync.log
apt-get update -qq && apt-get install -y --no-install-recommends curl ca-certificates >> /workspace/person-lora-sync.log 2>&1
mkdir -p /workspace/ComfyUI/models/loras
${downloads}
touch /workspace/${SENTINEL_PREFIX}_$(date +%Y%m%d_%H%M%S)
ls -la /workspace/ComfyUI/models/loras/*-flux.safetensors 2>/dev/null | tee -a /workspace/person-lora-sync.log || true
cd /workspace
exec python3 -m http.server ${SEEDER_HTTP_PORT}
`.trim();
}

const SECURE_GPU_FALLBACKS = [
	"NVIDIA RTX A6000",
	"NVIDIA RTX A5000",
	"NVIDIA RTX PRO 6000 Blackwell Server Edition",
	"NVIDIA GeForce RTX 4090",
];

async function waitForSeeder(
	podId: string,
	timeoutMs = 20 * 60_000
): Promise<void> {
	const url = `https://${podId}-${SEEDER_HTTP_PORT}.proxy.runpod.net/person-lora-sync.log`;
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
			if (res.ok) {
				const text = await res.text();
				if (
					text.includes("[person-lora] ok") ||
					text.includes("[person-lora] skip")
				) {
					console.log(
						`[sync] seeder log ready (${Math.round((Date.now() - started) / 1000)}s)`
					);
					return;
				}
			}
		} catch {
			// proxy warming up
		}
		await new Promise((r) => setTimeout(r, 8000));
	}
	throw new Error(`Seeder ${podId} timed out — check ${url}`);
}

function parseSlugArg(argv: string[]): string | undefined {
	for (const arg of argv) {
		if (arg.startsWith("--slug=")) {
			return arg.slice("--slug=".length);
		}
	}
	return undefined;
}

async function main(): Promise<void> {
	const apiKey = process.env.RUNPOD_API_KEY?.trim();
	if (!apiKey) {
		throw new Error("RUNPOD_API_KEY required");
	}
	const slug = parseSlugArg(process.argv.slice(2));
	const persons = await fetchReadyPersons(slug);
	if (persons.length === 0) {
		console.log("[sync] no ready flux-dev persons to sync");
		return;
	}
	console.log(
		`[sync] ${persons.length} person(s): ${persons.map((p) => p.slug).join(", ")}`
	);

	const volumes = await listTargetVolumes(apiKey);
	if (volumes.length === 0) {
		throw new Error(
			"No target volume (set RUNPOD_COMFYUI_POD_ID or RUNPOD_PERSON_LORA_SEED_VOLUMES)"
		);
	}

	const script = buildSeedScript(persons);
	for (const volume of volumes) {
		let created = false;
		for (const gpu of SECURE_GPU_FALLBACKS) {
			const response = await runpodRequest(apiKey, "POST", "/pods", {
				cloudType: "SECURE",
				containerDiskInGb: 10,
				dockerEntrypoint: ["/bin/bash", "-lc"],
				dockerStartCmd: [script],
				gpuCount: 1,
				gpuTypeIds: [gpu],
				imageName: SEEDER_IMAGE,
				name: `sync-person-lora-${volume.name}-${Date.now().toString(36)}`,
				networkVolumeId: volume.id,
				ports: [`${SEEDER_HTTP_PORT}/http`],
				volumeMountPath: "/workspace",
			});
			if (!response.ok) {
				continue;
			}
			const pod = (await response.json()) as { id: string };
			console.log(`[${volume.name}] seeder ${pod.id} on ${gpu}`);
			try {
				await waitForSeeder(pod.id);
			} finally {
				await runpodRequest(apiKey, "DELETE", `/pods/${pod.id}`);
				console.log(`[${volume.name}] seeder ${pod.id} terminated`);
			}
			created = true;
			break;
		}
		if (!created) {
			throw new Error(`No GPU capacity for volume ${volume.name}`);
		}
	}
	console.log("[sync] done");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
