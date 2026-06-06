/* biome-ignore-all lint/suspicious/noConsole: ops script reports human-readable inventory */
export {};

/**
 * Read-only RunPod inventory: network volumes, serverless endpoints,
 * templates, pods + GPU types/availability. Used to plan migration from
 * serverless to a single dedicated pod.
 *
 * RUNPOD_API_KEY=rpa_xxx bun run packages/runpod/scripts/inventory.ts
 */

const RUNPOD_BASE_URL = "https://rest.runpod.io/v1";
const RTX_6000_PRO_GPU_PATTERN = /6000|pro/iu;

function requireEnv(key: string): string {
	const value = process.env[key];
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}

async function api(path: string): Promise<unknown> {
	const response = await fetch(`${RUNPOD_BASE_URL}${path}`, {
		headers: {
			authorization: `Bearer ${requireEnv("RUNPOD_API_KEY")}`,
			"content-type": "application/json",
		},
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`GET ${path} failed (${response.status}): ${text}`);
	}
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function asArray(value: unknown): unknown[] {
	if (Array.isArray(value)) {
		return value;
	}
	if (value && typeof value === "object") {
		const data = (value as { data?: unknown }).data;
		if (Array.isArray(data)) {
			return data;
		}
	}
	return [];
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

async function main(): Promise<void> {
	const [volumes, endpoints, templates, pods, gpu] = await Promise.all([
		api("/networkvolumes"),
		api("/endpoints"),
		api("/templates"),
		api("/pods"),
		graphql(
			"query { gpuTypes { id displayName memoryInGb secureCloud communityCloud } }"
		),
	]);
	const gpuTypes =
		(gpu as { data?: { gpuTypes?: unknown } } | null)?.data?.gpuTypes ?? [];

	console.log("=== NETWORK VOLUMES ===");
	for (const v of asArray(volumes)) {
		const vol = v as Record<string, unknown>;
		console.log(
			JSON.stringify({
				id: vol.id,
				name: vol.name,
				dataCenterId: vol.dataCenterId,
				size: vol.size,
			})
		);
	}

	console.log("\n=== SERVERLESS ENDPOINTS ===");
	for (const e of asArray(endpoints)) {
		const ep = e as Record<string, unknown>;
		console.log(
			JSON.stringify({
				id: ep.id,
				name: ep.name,
				templateId: ep.templateId,
				workersMin: ep.workersMin,
				workersMax: ep.workersMax,
			})
		);
	}

	console.log("\n=== TEMPLATES ===");
	for (const t of asArray(templates)) {
		const tpl = t as Record<string, unknown>;
		console.log(
			JSON.stringify({
				id: tpl.id,
				name: tpl.name,
				imageName: tpl.imageName,
				isServerless: tpl.isServerless,
			})
		);
	}

	console.log("\n=== PODS ===");
	for (const p of asArray(pods)) {
		const pod = p as Record<string, unknown>;
		console.log(
			JSON.stringify({
				id: pod.id,
				name: pod.name,
				desiredStatus: pod.desiredStatus,
				gpuTypeId: pod.machine
					? (pod.machine as Record<string, unknown>).gpuTypeId
					: undefined,
			})
		);
	}

	console.log("\n=== GPU TYPES (filter: 6000 / PRO / RTX) ===");
	for (const g of asArray(gpuTypes)) {
		const gpu = g as Record<string, unknown>;
		const id = String(gpu.id ?? "");
		const name = String(gpu.displayName ?? gpu.id ?? "");
		if (RTX_6000_PRO_GPU_PATTERN.test(`${id} ${name}`)) {
			console.log(JSON.stringify(gpu));
		}
	}
}

main().catch((error) => {
	console.error("inventory.fatal", error);
	process.exitCode = 1;
});
