/**
 * End-to-end: volume → seed Flux.1-dev fp8 + Noisify LoRA → serverless endpoint →
 * admin DB (prod MCP) → generator live submit + poll.
 *
 * Loads: .env.local (PROD_MCP_*), apps/generator/.env (RUNPOD_*)
 *
 *   bun run packages/runpod/scripts/provision-flux-serverless-live.ts
 *
 * Skip seed if already done:
 *   SKIP_SEED=true bun run packages/runpod/scripts/provision-flux-serverless-live.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUNPOD_BASE = "https://rest.runpod.io/v1";
const TRAILING_SLASH = /\/$/u;
const ENDPOINT_ID_RE = /RUNPOD_FLUX_DEV_SERVERLESS_ENDPOINT_ID=(\w+)/u;
const TEMPLATE_ID_JSON_RE = /"templateId":\s*"([^"]+)"/u;
const SEEDER_IMAGE = "python:3.11-slim";
const SEEDER_PORT = 8080;
const VOLUME_NAME = "flux-models-us-ca-2";
const VOLUME_DC = "US-CA-2";
const VOLUME_SIZE_GB = 50;
const FLUX_SENTINEL = "FLUX_DEV_SEED_DONE_v1";
const ENDPOINT_NAME = "flux-dev-image-serverless";
const CHECKPOINT_NAME = "flux1-dev-fp8.safetensors";
const CHECKPOINT_URL =
	"https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/flux1-dev-fp8.safetensors";
const LORA_NAME = "noisify.safetensors";
const LORA_URL =
	"https://hel1.your-objectstorage.com/generator/loras/external/external-7919a4063730eca7.safetensors";
const WORKER_IMAGE_DEFAULT = "ghcr.io/balkhaev/worker-ltx-comfyui:v1";
const FLUX_GPU_PRIORITY = [
	"NVIDIA GeForce RTX 4090",
	"NVIDIA RTX A5000",
	"NVIDIA L4",
	"NVIDIA RTX A6000",
	"NVIDIA RTX A4500",
	"NVIDIA RTX A4000",
];
// Seeder only downloads files to the network volume — no GPU needed.
const CPU_FLAVORS = ["cpu3c", "cpu5c", "cpu3g", "cpu5g"];
const GPU_FALLBACKS = [
	"NVIDIA GeForce RTX 4090",
	"NVIDIA RTX A4000",
	"NVIDIA RTX A4500",
	"NVIDIA RTX A5000",
	"NVIDIA RTX A6000",
	"NVIDIA L4",
	"NVIDIA L40",
	"NVIDIA L40S",
	"NVIDIA A40",
	"NVIDIA A100 80GB PCIe",
	"Tesla T4",
];
const NO_CAPACITY =
	/no instances|does not have the resources|no resources|out of stock|no available|no longer any instances|capacity|could not find any pods/iu;

function loadEnvFiles(): void {
	for (const rel of [".env.local", "apps/generator/.env"]) {
		try {
			const raw = readFileSync(
				resolve(import.meta.dir, "../../../", rel),
				"utf8"
			);
			for (const line of raw.split("\n")) {
				const t = line.trim();
				if (!t || t.startsWith("#")) {
					continue;
				}
				const eq = t.indexOf("=");
				if (eq <= 0) {
					continue;
				}
				const k = t.slice(0, eq);
				const v = t.slice(eq + 1);
				if (!process.env[k]) {
					process.env[k] = v;
				}
			}
		} catch {
			// optional file
		}
	}
}

function log(step: string, detail: Record<string, unknown> = {}): void {
	console.log(`[flux-live] ${step}`, detail);
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function runpodRest(
	apiKey: string,
	method: string,
	path: string,
	body?: unknown
): Promise<Response> {
	return await fetch(`${RUNPOD_BASE}${path}`, {
		body: body === undefined ? undefined : JSON.stringify(body),
		headers: {
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
		},
		method,
	});
}

async function mcpCall(
	toolName: string,
	args: Record<string, unknown>
): Promise<unknown> {
	const url = (
		process.env.PROD_MCP_URL ?? "https://mcp.gen.balkhaev.com/mcp"
	).replace(TRAILING_SLASH, "");
	const token = process.env.PROD_MCP_TOKEN;
	if (!token) {
		throw new Error("PROD_MCP_TOKEN missing");
	}
	const endpoint = url.includes("/mcp") ? url : `${url}/mcp`;
	const response = await fetch(endpoint, {
		body: JSON.stringify({
			id: Date.now(),
			jsonrpc: "2.0",
			method: "tools/call",
			params: { arguments: args, name: toolName },
		}),
		headers: {
			Accept: "application/json, text/event-stream",
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(`MCP HTTP ${response.status}: ${await response.text()}`);
	}
	const envelope = (await response.json()) as {
		error?: { message: string };
		result?: { content?: Array<{ text?: string }> };
	};
	if (envelope.error) {
		throw new Error(envelope.error.message);
	}
	const text = envelope.result?.content?.[0]?.text;
	if (!text) {
		throw new Error("MCP empty result");
	}
	return JSON.parse(text) as unknown;
}

function asRecord(v: unknown): Record<string, unknown> | null {
	return v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;
}

async function ensureVolume(
	apiKey: string
): Promise<{ id: string; name: string }> {
	const list = (await (
		await runpodRest(apiKey, "GET", "/networkvolumes")
	).json()) as Array<{ id: string; name: string }>;
	const existing = list.find((v) => v.name === VOLUME_NAME);
	if (existing) {
		log("volume.exists", { id: existing.id, name: existing.name });
		return existing;
	}
	let created = await runpodRest(apiKey, "POST", "/networkvolumes", {
		dataCenterId: VOLUME_DC,
		name: VOLUME_NAME,
		size: VOLUME_SIZE_GB,
	});
	if (!created.ok) {
		await sleep(5000);
		created = await runpodRest(apiKey, "POST", "/networkvolumes", {
			dataCenterId: VOLUME_DC,
			name: VOLUME_NAME,
			size: VOLUME_SIZE_GB,
		});
	}
	if (!created.ok) {
		throw new Error(`create volume: ${await created.text()}`);
	}
	const vol = (await created.json()) as { id: string; name: string };
	log("volume.created", vol);
	return vol;
}

function buildFluxSeedScript(): string {
	const wget =
		"--continue --tries=20 --waitretry=10 --timeout=120 --no-verbose";
	const hf = process.env.HF_TOKEN?.trim()
		? `--header="Authorization: Bearer ${process.env.HF_TOKEN.trim()}"`
		: "";
	return `
set -e
if [ -f /workspace/${FLUX_SENTINEL} ]; then echo "[seed] flux sentinel ok"; else
  apt-get update -qq && apt-get install -y --no-install-recommends wget ca-certificates
  mkdir -p /workspace/ComfyUI/models/checkpoints /workspace/ComfyUI/models/loras
  echo "[seed] ${CHECKPOINT_NAME}"
  wget ${wget} ${hf} -O /workspace/ComfyUI/models/checkpoints/${CHECKPOINT_NAME} "${CHECKPOINT_URL}"
  echo "[seed] ${LORA_NAME}"
  wget ${wget} -O /workspace/ComfyUI/models/loras/${LORA_NAME} "${LORA_URL}"
  touch /workspace/${FLUX_SENTINEL}
fi
cd /workspace && exec python3 -m http.server ${SEEDER_PORT}
`.trim();
}

async function probeSentinel(
	podId: string,
	sentinel: string
): Promise<boolean> {
	const url = `https://${podId}-${SEEDER_PORT}.proxy.runpod.net/${sentinel}`;
	try {
		const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
		return r.status === 200;
	} catch {
		return false;
	}
}

async function terminatePod(apiKey: string, podId: string): Promise<void> {
	await runpodRest(apiKey, "DELETE", `/pods/${podId}`);
}

type Compute =
	| { kind: "cpu"; flavor: string }
	| { kind: "gpu"; cloudType: "SECURE" | "COMMUNITY"; gpu: string };

function buildPodBody(
	label: string,
	script: string,
	volumeId: string,
	compute: Compute
): Record<string, unknown> {
	const base = {
		containerDiskInGb: 12,
		dockerEntrypoint: ["/bin/bash", "-lc"],
		dockerStartCmd: [script],
		imageName: SEEDER_IMAGE,
		name: `${label}-${Date.now().toString(36)}`,
		networkVolumeId: volumeId,
		ports: [`${SEEDER_PORT}/http`],
		volumeMountPath: "/workspace",
	};
	if (compute.kind === "cpu") {
		return { ...base, computeType: "CPU", cpuFlavorIds: [compute.flavor] };
	}
	return {
		...base,
		cloudType: compute.cloudType,
		gpuCount: 1,
		gpuTypeIds: [compute.gpu],
	};
}

async function createSeedPod(
	apiKey: string,
	volumeId: string,
	label: string,
	script: string,
	compute: Compute
): Promise<{ id: string } | "no-capacity" | "error"> {
	const response = await runpodRest(
		apiKey,
		"POST",
		"/pods",
		buildPodBody(label, script, volumeId, compute)
	);
	const text = await response.text();
	if (!response.ok) {
		if (NO_CAPACITY.test(text)) {
			return "no-capacity";
		}
		log("seed.pod.error", { detail: text.slice(0, 200), label });
		return "error";
	}
	return JSON.parse(text) as { id: string };
}

function buildComputeAttempts(): Compute[] {
	const attempts: Compute[] = CPU_FLAVORS.map((flavor) => ({
		flavor,
		kind: "cpu",
	}));
	for (const cloudType of ["SECURE", "COMMUNITY"] as const) {
		for (const gpu of GPU_FALLBACKS) {
			attempts.push({ cloudType, gpu, kind: "gpu" });
		}
	}
	return attempts;
}

async function runSeedPod(
	apiKey: string,
	volumeId: string,
	label: string,
	script: string,
	sentinel: string
): Promise<void> {
	const attempts = buildComputeAttempts();
	const capacityDeadline = Date.now() + 30 * 60 * 1000;
	let podId: string | null = null;
	while (!podId && Date.now() < capacityDeadline) {
		for (const compute of attempts) {
			const result = await createSeedPod(
				apiKey,
				volumeId,
				label,
				script,
				compute
			);
			if (result === "no-capacity" || result === "error") {
				continue;
			}
			podId = result.id;
			log("seed.pod", { compute, label, podId });
			break;
		}
		if (!podId) {
			log("seed.capacity.wait", { label });
			await sleep(60_000);
		}
	}
	if (!podId) {
		throw new Error(`no capacity for seed pod ${label}`);
	}
	const deadline = Date.now() + 75 * 60 * 1000;
	let attempt = 0;
	while (Date.now() < deadline) {
		attempt += 1;
		if (await probeSentinel(podId, sentinel)) {
			log("seed.done", { attempt, label, podId });
			await terminatePod(apiKey, podId);
			return;
		}
		if (attempt % 6 === 0) {
			log("seed.waiting", {
				attempt,
				elapsedMin: Math.round(
					(Date.now() - (deadline - 75 * 60 * 1000)) / 60_000
				),
				label,
			});
		}
		await sleep(30_000);
	}
	await terminatePod(apiKey, podId);
	throw new Error(`seed timeout: ${label}`);
}

async function ensureEndpoint(
	apiKey: string,
	volumeId: string,
	imageName: string
): Promise<{ endpointId: string; templateId: string }> {
	process.env.RUNPOD_FLUX_DEV_SERVERLESS_IMAGE = imageName;
	process.env.RUNPOD_FLUX_DEV_VOLUME_IDS = volumeId;
	// biome-ignore lint/correctness/noUndeclaredVariables: Bun global in bun runtime
	const proc = Bun.spawn({
		cmd: [
			"bun",
			"run",
			"packages/runpod/scripts/create-flux-serverless-endpoints.ts",
		],
		cwd: resolve(import.meta.dir, "../../.."),
		env: process.env as Record<string, string & undefined>,
		stderr: "pipe",
		stdout: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (code !== 0) {
		console.error(stderr);
		throw new Error(`create-flux-serverless-endpoints exit ${code}`);
	}
	const endpointMatch = stdout.match(ENDPOINT_ID_RE);
	const templateMatch = stdout.match(TEMPLATE_ID_JSON_RE);
	const endpointFromList = (await (
		await runpodRest(apiKey, "GET", "/endpoints")
	).json()) as Array<{ id: string; name?: string }>;
	const ep = endpointFromList.find((e) => e.name === ENDPOINT_NAME);
	if (!ep) {
		console.log(stdout);
		throw new Error("flux endpoint not found after create script");
	}
	log("endpoint.ready", {
		endpointId: ep.id,
		stdoutTail: stdout.slice(-500),
		templateHint: endpointMatch?.[1] ?? templateMatch?.[1],
	});
	return { endpointId: ep.id, templateId: "unknown" };
}

async function registerAdmin(
	volume: { id: string; name: string },
	endpointId: string,
	imageName: string
): Promise<string> {
	const volumesResp = asRecord(
		await mcpCall("admin_request", {
			method: "GET",
			path: "/api/admin/runpod/volumes",
		})
	);
	const body = asRecord(volumesResp?.body) ?? volumesResp;
	const volumes =
		(body?.volumes as Array<{ id: string; runpodVolumeId: string }>) ?? [];
	let adminVol = volumes.find((v) => v.runpodVolumeId === volume.id);
	if (!adminVol) {
		const created = asRecord(
			await mcpCall("admin_request", {
				body: {
					datacenter: VOLUME_DC,
					description: "Flux.1-dev fp8 + Noisify LoRA",
					gpuTypeIds: FLUX_GPU_PRIORITY,
					name: volume.name,
					runpodVolumeId: volume.id,
					sizeGb: VOLUME_SIZE_GB,
				},
				method: "POST",
				path: "/api/admin/runpod/volumes",
			})
		);
		const volBody = asRecord(created?.body) ?? created;
		adminVol = volBody?.volume as { id: string; runpodVolumeId: string };
		log("admin.volume.created", { id: adminVol?.id });
	}
	if (!adminVol?.id) {
		throw new Error("admin volume registration failed");
	}

	const templatesResp = asRecord(
		await mcpCall("admin_request", {
			method: "GET",
			path: "/api/admin/runpod/pod-templates?workflowKey=flux-dev-image",
		})
	);
	const tplBody = asRecord(templatesResp?.body) ?? templatesResp;
	const templates =
		(tplBody?.templates as Array<{ id: string; runpodEndpointId?: string }>) ??
		[];
	let templateId = templates.find((t) => t.runpodEndpointId === endpointId)?.id;
	if (templateId) {
		log("admin.template.exists", { templateId });
	} else {
		const createdTpl = asRecord(
			await mcpCall("admin_request", {
				body: {
					cloudType: "SECURE",
					containerDiskInGb: 20,
					description: "Flux.1-dev T2I + Noisify LoRA (live provision)",
					enabled: true,
					gpuTypeIds: FLUX_GPU_PRIORITY,
					imageName,
					mode: "serverless",
					name: "Flux.1-dev T2I serverless",
					runpodEndpointId: endpointId,
					timeoutMs: 300_000,
					volumeInGb: VOLUME_SIZE_GB,
					volumes: [{ priority: 0, volumeId: adminVol.id }],
					workflowKey: "flux-dev-image",
				},
				method: "POST",
				path: "/api/admin/runpod/pod-templates",
			})
		);
		const cBody = asRecord(createdTpl?.body) ?? createdTpl;
		templateId = (cBody?.template as { id: string })?.id;
		log("admin.template.created", { templateId });
	}
	if (!templateId) {
		throw new Error("admin template registration failed");
	}
	return templateId;
}

async function liveGeneratorTest(): Promise<void> {
	const submitPayload = {
		params: {
			guidance: 3.5,
			height: 1152,
			loraFilename: LORA_NAME,
			loraScale: 1,
			numImages: 1,
			steps: 28,
			width: 896,
		},
		prompt:
			"A low-quality 2015 Snapchat photo, raw unfiltered candid, noise, grain, jpeg artifacts, dim fluorescent dorm lighting, flux noisify live test",
		workflowKey: "runpod-flux-dev-image",
	};
	log("live.submit", { workflowKey: submitPayload.workflowKey });
	const submit = asRecord(
		await mcpCall("generator_execution_submit", submitPayload)
	);
	const submitBody = asRecord(submit?.body) ?? submit;
	const execution = asRecord(submitBody?.execution) ?? submitBody;
	const executionId =
		(typeof execution?.id === "string" && execution.id) ||
		(typeof execution?.executionId === "string" && execution.executionId) ||
		null;
	if (!executionId) {
		throw new Error(
			`submit missing execution id: ${JSON.stringify(submit).slice(0, 800)}`
		);
	}
	log("live.execution", { executionId, status: execution?.status });

	const deadline = Date.now() + 15 * 60 * 1000;
	while (Date.now() < deadline) {
		await sleep(15_000);
		const sync = asRecord(
			await mcpCall("generator_execution_sync", {
				providerJobId: executionId,
				workflowKey: submitPayload.workflowKey,
			})
		);
		const syncBody = asRecord(sync?.body) ?? sync;
		const ex = asRecord(syncBody?.execution) ?? syncBody;
		const status = ex?.status;
		const progress = ex?.progress;
		log("live.poll", { progress, status });
		if (status === "completed" || status === "succeeded") {
			log("live.success", {
				artifactUrls: ex?.artifactUrls ?? ex?.artifacts,
				executionId,
			});
			return;
		}
		if (status === "failed" || status === "error" || status === "cancelled") {
			throw new Error(`execution failed: ${JSON.stringify(ex).slice(0, 1200)}`);
		}
	}
	throw new Error("live test timeout");
}

async function resolveLtxImageName(apiKey: string): Promise<string | null> {
	try {
		const epResp = await runpodRest(apiKey, "GET", "/endpoints/hr1a398xx75thx");
		const ep = asRecord(await epResp.json());
		const templateId =
			typeof ep?.templateId === "string" ? ep.templateId : null;
		if (!templateId) {
			return null;
		}
		const tplResp = await runpodRest(apiKey, "GET", `/templates/${templateId}`);
		const tpl = asRecord(await tplResp.json());
		return typeof tpl?.imageName === "string" ? tpl.imageName : null;
	} catch {
		return null;
	}
}

async function main(): Promise<void> {
	loadEnvFiles();
	const apiKey = process.env.RUNPOD_API_KEY?.trim();
	if (!apiKey) {
		throw new Error("RUNPOD_API_KEY missing (apps/generator/.env)");
	}

	const imageName =
		process.env.RUNPOD_FLUX_DEV_SERVERLESS_IMAGE?.trim() ||
		process.env.RUNPOD_WAN22_SERVERLESS_IMAGE?.trim() ||
		process.env.RUNPOD_LTX23_SERVERLESS_IMAGE?.trim() ||
		(await resolveLtxImageName(apiKey)) ||
		WORKER_IMAGE_DEFAULT;

	const volume = await ensureVolume(apiKey);

	if (process.env.SKIP_SEED === "true") {
		log("seed.skipped", {});
	} else {
		log("seed.flux.start", { volumeId: volume.id });
		await runSeedPod(
			apiKey,
			volume.id,
			"seed-flux-dev",
			buildFluxSeedScript(),
			FLUX_SENTINEL
		);
	}

	const { endpointId } = await ensureEndpoint(apiKey, volume.id, imageName);
	await registerAdmin(volume, endpointId, imageName);

	log("live.test.start", { endpointId });
	await sleep(10_000);
	await liveGeneratorTest();
	log("done", { endpointId, volumeId: volume.id });
}

main().catch((err) => {
	console.error("[flux-live] fatal", err);
	process.exit(1);
});
