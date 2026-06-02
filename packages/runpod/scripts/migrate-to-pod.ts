/* biome-ignore-all lint/suspicious/noConsole: ops migration script reports human-readable timeline */
export {};

/**
 * Полная миграция RunPod: serverless → один персистентный pod с RTX PRO 6000.
 *
 * Шаги (порядок безопасный — create-first, потом delete):
 *   1. Подбирает DC в Америке/Европе со storageSupport=true и живой
 *      RTX PRO 6000 (Server/Workstation Edition).
 *   2. Создаёт новый network volume (default 200GB).
 *   3. Создаёт ОДИН pod с RTX PRO 6000, монтирует volume в /runpod-volume,
 *      запускает ComfyUI web UI (порт 8188/http) из общего образа
 *      worker-ltx-comfyui (LTX + WAN + Flux ноды).
 *   4. Удаляет ВСЕ старые serverless endpoints, templates и network volumes.
 *
 * Образ один общий: `ghcr.io/balkhaev/worker-ltx-comfyui:v1` уже обслуживает
 * LTX/WAN/Flux serverless (LTX-ноды + WAN в ComfyUI core + VHS + Flux core),
 * extra_model_paths.yaml мапит модели из /runpod-volume.
 *
 * Volume создаётся ПУСТЫМ — модели нужно засеять отдельно (seed-*.ts) после
 * старта pod'а. Скрипт это только логирует, не делает.
 *
 * Безопасность: без флага --apply работает в dry-run (только план, без вызовов
 * на изменение). Создание идёт ПЕРЕД удалением, чтобы сбой create не оставил
 * систему без ресурсов.
 *
 * Запуск:
 *   RUNPOD_API_KEY=rpa_xxx bun run packages/runpod/scripts/migrate-to-pod.ts            # dry-run
 *   RUNPOD_API_KEY=rpa_xxx bun run packages/runpod/scripts/migrate-to-pod.ts --apply    # live
 *
 * Опции:
 *   --apply               выполнить реальные create/delete
 *   --dc=EU-RO-1          форсировать дата-центр (иначе автоподбор)
 *   --image=<docker>      образ pod'а (default ghcr.io/balkhaev/worker-ltx-comfyui:v1)
 *   --volume-gb=200       размер network volume
 *   --container-gb=40     размер container disk
 *   --no-delete           создать pod+volume, но НЕ удалять старое
 */

const REST_BASE = "https://rest.runpod.io/v1";

const DEFAULT_IMAGE = "ghcr.io/balkhaev/worker-ltx-comfyui:v1";
const DEFAULT_VOLUME_GB = 200;
const DEFAULT_CONTAINER_GB = 40;
const COMFY_PORT = 8188;
const VOLUME_MOUNT_PATH = "/runpod-volume";
const POD_NAME = "generator-comfyui-pro6000";
const VOLUME_NAME = "generator-models";

// RTX PRO 6000 Blackwell — 96GB VRAM, хватает на LTX+WAN+Flux одновременно.
// Server Edition (secure cloud) приоритетнее Workstation.
const GPU_SERVER = "NVIDIA RTX PRO 6000 Blackwell Server Edition";
const GPU_WORKSTATION = "NVIDIA RTX PRO 6000 Blackwell Workstation Edition";

// Приоритет авто-подбора DC (Европа/Америка). Берём первый из этого списка,
// который реально отдаёт available RTX PRO 6000 и storageSupport.
const DC_PRIORITY = [
	"EU-RO-1",
	"EU-NL-1",
	"EU-CZ-1",
	"CA-MTL-3",
	"US-CA-2",
	"US-NE-1",
	"US-NC-1",
	"US-NC-2",
	"US-MO-2",
	"US-KS-2",
];

interface Cli {
	apply: boolean;
	containerGb: number;
	dc?: string;
	deleteOnly: boolean;
	image: string;
	noDelete: boolean;
	podOnly: boolean;
	volumeGb: number;
	volumeId?: string;
}

function parseCli(argv: string[]): Cli {
	const cli: Cli = {
		apply: false,
		containerGb: DEFAULT_CONTAINER_GB,
		deleteOnly: false,
		image: DEFAULT_IMAGE,
		noDelete: false,
		podOnly: false,
		volumeGb: DEFAULT_VOLUME_GB,
	};
	for (const raw of argv) {
		if (raw === "--apply") {
			cli.apply = true;
		} else if (raw === "--no-delete") {
			cli.noDelete = true;
		} else if (raw === "--delete-only") {
			cli.deleteOnly = true;
		} else if (raw === "--pod-only") {
			cli.podOnly = true;
		} else if (raw.startsWith("--dc=")) {
			cli.dc = raw.slice("--dc=".length);
		} else if (raw.startsWith("--image=")) {
			cli.image = raw.slice("--image=".length);
		} else if (raw.startsWith("--volume-id=")) {
			cli.volumeId = raw.slice("--volume-id=".length);
		} else if (raw.startsWith("--volume-gb=")) {
			cli.volumeGb = Number(raw.slice("--volume-gb=".length));
		} else if (raw.startsWith("--container-gb=")) {
			cli.containerGb = Number(raw.slice("--container-gb=".length));
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

async function rest(
	method: "GET" | "POST" | "DELETE" | "PATCH",
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
	if (!text) {
		return {};
	}
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

async function graphql(query: string): Promise<unknown> {
	const key = requireEnv("RUNPOD_API_KEY");
	const response = await fetch(
		`https://api.runpod.io/graphql?api_key=${encodeURIComponent(key)}`,
		{
			body: JSON.stringify({ query }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}
	);
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`graphql failed (${response.status}): ${text}`);
	}
	return JSON.parse(text);
}

function asArray(value: unknown): Record<string, unknown>[] {
	const raw = Array.isArray(value)
		? value
		: ((value as { data?: unknown[] } | null)?.data ?? []);
	return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

interface DcChoice {
	dataCenterId: string;
	gpuTypeIds: string[];
}

async function pickDataCenter(forced?: string): Promise<DcChoice> {
	const res = (await graphql(
		"query { dataCenters { id location storageSupport gpuAvailability { available gpuTypeId } } }"
	)) as {
		data: {
			dataCenters: {
				id: string;
				storageSupport: boolean;
				gpuAvailability: { available: boolean; gpuTypeId: string }[];
			}[];
		};
	};
	const byId = new Map(res.data.dataCenters.map((dc) => [dc.id, dc]));

	const editionsFor = (dcId: string): string[] => {
		const dc = byId.get(dcId);
		if (!dc?.storageSupport) {
			return [];
		}
		const editions: string[] = [];
		for (const edition of [GPU_SERVER, GPU_WORKSTATION]) {
			if (
				dc.gpuAvailability.some((g) => g.gpuTypeId === edition && g.available)
			) {
				editions.push(edition);
			}
		}
		return editions;
	};

	if (forced) {
		const editions = editionsFor(forced);
		if (editions.length === 0) {
			throw new Error(
				`forced DC ${forced} has no available RTX PRO 6000 + storage`
			);
		}
		return { dataCenterId: forced, gpuTypeIds: editions };
	}

	for (const dcId of DC_PRIORITY) {
		const editions = editionsFor(dcId);
		if (editions.length > 0) {
			return { dataCenterId: dcId, gpuTypeIds: editions };
		}
	}
	throw new Error("No EU/US datacenter with available RTX PRO 6000 + storage");
}

async function createVolume(
	dataCenterId: string,
	sizeGb: number
): Promise<{ id: string }> {
	const result = (await rest("POST", "/networkvolumes", {
		dataCenterId,
		name: VOLUME_NAME,
		size: sizeGb,
	})) as { id: string };
	return result;
}

async function createPod(args: {
	containerGb: number;
	dataCenterId: string;
	gpuTypeIds: string[];
	image: string;
	networkVolumeId: string;
}): Promise<{ id: string; desiredStatus?: string }> {
	const env: Record<string, string> = { NETWORK_VOLUME_DEBUG: "true" };
	const civitai = process.env.CIVITAI_API_KEY ?? process.env.CIVITAI_TOKEN;
	if (civitai) {
		env.CIVITAI_API_KEY = civitai;
	}
	const hf = process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN;
	if (hf) {
		env.HF_TOKEN = hf;
	}
	// Образ — serverless worker (CMD=/start.sh поднимает handler). Для
	// персистентного pod'а переопределяем старт на чистый ComfyUI web server.
	// ВАЖНО: ComfyUI и его зависимости (sqlalchemy и т.д.) живут в venv
	// `/opt/venv` (он в PATH). Системный /usr/bin/python3 их НЕ видит, поэтому
	// запускаем через `python` из venv, иначе main.py падает на import.
	const payload = {
		cloudType: "SECURE",
		containerDiskInGb: args.containerGb,
		dockerStartCmd: [
			"bash",
			"-lc",
			`cd /comfyui && exec python main.py --listen 0.0.0.0 --port ${COMFY_PORT}`,
		],
		env,
		gpuCount: 1,
		gpuTypeIds: args.gpuTypeIds,
		gpuTypePriority: "availability",
		imageName: args.image,
		name: POD_NAME,
		networkVolumeId: args.networkVolumeId,
		ports: [`${COMFY_PORT}/http`, "22/tcp"],
		supportPublicIp: true,
		volumeMountPath: VOLUME_MOUNT_PATH,
	};
	const result = (await rest("POST", "/pods", payload)) as {
		id: string;
		desiredStatus?: string;
	};
	return result;
}

const DELETE_RETRY_ATTEMPTS = 8;
const DELETE_RETRY_DELAY_MS = 8000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * RunPod возвращает 500 "Failed to terminate resources. Try again." пока
 * воркеры endpoint'а ещё терминируются после scale-down. Ретраим с паузой.
 */
async function deleteEndpointWithRetry(id: string): Promise<void> {
	for (let attempt = 1; attempt <= DELETE_RETRY_ATTEMPTS; attempt += 1) {
		try {
			await rest("DELETE", `/endpoints/${id}`);
			return;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const transient =
				message.includes("Failed to terminate resources") ||
				message.includes("(500)") ||
				message.includes("(409)");
			if (!transient || attempt === DELETE_RETRY_ATTEMPTS) {
				throw error;
			}
			log("delete.endpoint.retry", { attempt, id });
			await sleep(DELETE_RETRY_DELAY_MS);
		}
	}
}

async function deleteExistingPods(): Promise<void> {
	const pods = asArray(await rest("GET", "/pods"));
	for (const pod of pods) {
		if (pod.name !== POD_NAME) {
			continue;
		}
		const id = String(pod.id);
		log("delete.pod", { id, name: pod.name, status: pod.desiredStatus });
		try {
			await rest("DELETE", `/pods/${id}`);
		} catch (error) {
			log("delete.pod.warn", {
				id,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

async function deleteAllEndpoints(): Promise<void> {
	const endpoints = asArray(await rest("GET", "/endpoints"));
	// Сначала scale-down всех endpoint'ов, потом удаляем — даём воркерам время
	// на параллельную термированию, пока обрабатываем остальные.
	for (const ep of endpoints) {
		const id = String(ep.id);
		try {
			await rest("POST", `/endpoints/${id}/update`, {
				workersMax: 0,
				workersMin: 0,
			});
		} catch (error) {
			log("delete.endpoint.scale-down.warn", {
				id,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
	for (const ep of endpoints) {
		const id = String(ep.id);
		log("delete.endpoint", { id, name: ep.name });
		await deleteEndpointWithRetry(id);
	}
}

async function deleteOldResources(): Promise<void> {
	await deleteAllEndpoints();

	const templates = asArray(await rest("GET", "/templates"));
	for (const tpl of templates) {
		const id = String(tpl.id);
		log("delete.template", { id, name: tpl.name });
		try {
			await rest("DELETE", `/templates/${id}`);
		} catch (error) {
			log("delete.template.warn", {
				id,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const volumes = asArray(await rest("GET", "/networkvolumes"));
	for (const vol of volumes) {
		const id = String(vol.id);
		// Не удаляем только что созданный volume.
		if (vol.name === VOLUME_NAME) {
			continue;
		}
		log("delete.volume", { dc: vol.dataCenterId, id, name: vol.name });
		try {
			await rest("DELETE", `/networkvolumes/${id}`);
		} catch (error) {
			log("delete.volume.warn", {
				id,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

async function main(): Promise<void> {
	const cli = parseCli(process.argv.slice(2));
	requireEnv("RUNPOD_API_KEY");

	// Pod-only: пересоздать ТОЛЬКО pod на существующем volume (recovery после
	// сломанного старта). Старый pod с тем же именем удаляется, volume не
	// трогается, старое serverless-добро не удаляется.
	if (cli.podOnly) {
		if (!(cli.apply && cli.volumeId)) {
			log("dry-run", {
				note: "--pod-only requires --apply and --volume-id=<id>.",
				volumeId: cli.volumeId ?? null,
			});
			return;
		}
		const choice = await pickDataCenter(cli.dc);
		await deleteExistingPods();
		const pod = await createPod({
			containerGb: cli.containerGb,
			dataCenterId: choice.dataCenterId,
			gpuTypeIds: choice.gpuTypeIds,
			image: cli.image,
			networkVolumeId: cli.volumeId,
		});
		log("pod.created", {
			desiredStatus: pod.desiredStatus,
			id: pod.id,
			volumeId: cli.volumeId,
		});
		return;
	}

	// Delete-only: только удаляет старое (для recovery после частичного прогона).
	if (cli.deleteOnly) {
		if (!cli.apply) {
			log("dry-run", { note: "--delete-only requires --apply to run." });
			return;
		}
		await deleteOldResources();
		log("delete-only.done", {});
		return;
	}

	const choice = await pickDataCenter(cli.dc);
	log("plan", {
		apply: cli.apply,
		containerGb: cli.containerGb,
		dataCenterId: choice.dataCenterId,
		gpuTypeIds: choice.gpuTypeIds,
		image: cli.image,
		noDelete: cli.noDelete,
		volumeGb: cli.volumeGb,
	});

	if (!cli.apply) {
		log("dry-run", {
			note: "Re-run with --apply to create pod+volume and delete old resources.",
		});
		const endpoints = asArray(await rest("GET", "/endpoints"));
		const templates = asArray(await rest("GET", "/templates"));
		const volumes = asArray(await rest("GET", "/networkvolumes"));
		log("would.delete", {
			endpoints: endpoints.map((e) => e.name),
			templates: templates.map((t) => t.name),
			volumes: volumes.map((v) => v.name),
		});
		return;
	}

	// 1. Create volume (empty).
	const volume = await createVolume(choice.dataCenterId, cli.volumeGb);
	log("volume.created", {
		dc: choice.dataCenterId,
		id: volume.id,
		sizeGb: cli.volumeGb,
	});

	// 2. Create pod with RTX PRO 6000 + the new volume.
	const pod = await createPod({
		containerGb: cli.containerGb,
		dataCenterId: choice.dataCenterId,
		gpuTypeIds: choice.gpuTypeIds,
		image: cli.image,
		networkVolumeId: volume.id,
	});
	log("pod.created", { desiredStatus: pod.desiredStatus, id: pod.id });

	// 3. Delete old serverless endpoints, templates, volumes.
	if (cli.noDelete) {
		log("delete.skipped", { reason: "--no-delete" });
	} else {
		await deleteOldResources();
	}

	log("done", {
		next: [
			"Дождись pod RUNNING (rest GET /pods/{id}).",
			"Засей модели на пустой volume через seed-*.ts (LTX/WAN/Flux).",
			"ComfyUI доступен на https://{podId}-8188.proxy.runpod.net",
		],
		podId: pod.id,
		volumeId: volume.id,
	});
}

main().catch((error) => {
	console.error(`[${ts()}] migrate.fatal`, error);
	process.exitCode = 1;
});
