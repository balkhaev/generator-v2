/* biome-ignore-all lint/suspicious/noConsole: helper script reports human-readable timeline */
/**
 * Ждёт пока ComfyUI на указанном RunPod pod ответит 200 на /api/system_stats,
 * затем terminate'ит pod. Используется как single-pod warm-up watcher для
 * случаев, когда основной warmup-volumes.ts уже работает с другим набором.
 *
 * Запуск:
 *   POD_ID=xxx PASSWORD=yyy bun run packages/runpod/scripts/wait-and-terminate.ts
 */

const COMFY_READY_TIMEOUT_MS = 40 * 60 * 1000;
const COMFY_READY_POLL_MS = 15 * 1000;

function ts(): string {
	return new Date().toISOString().slice(11, 19);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function probeComfyReady(
	podId: string
): Promise<{ ready: boolean; status: number | string }> {
	const url = `https://${podId}-8188.proxy.runpod.net/api/system_stats`;
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(8000),
		});
		// ComfyUI uses cookie auth: 401 without credentials = service is up.
		const ready = response.status === 200 || response.status === 401;
		return { ready, status: response.status };
	} catch (error) {
		return {
			ready: false,
			status: error instanceof Error ? error.message : String(error),
		};
	}
}

async function terminatePod(apiKey: string, podId: string): Promise<void> {
	const response = await fetch(`https://rest.runpod.io/v1/pods/${podId}`, {
		headers: { authorization: `Bearer ${apiKey}` },
		method: "DELETE",
	});
	if (!response.ok && response.status !== 404) {
		console.warn(`[${ts()}] terminate failed (${response.status})`);
	}
}

async function main(): Promise<void> {
	const podId = process.env.POD_ID;
	const apiKey = process.env.RUNPOD_API_KEY;
	if (!(podId && apiKey)) {
		throw new Error("POD_ID and RUNPOD_API_KEY are required");
	}
	console.log(`[${ts()}] watching pod=${podId}`);
	const startedAt = Date.now();
	let attempt = 0;
	while (Date.now() - startedAt < COMFY_READY_TIMEOUT_MS) {
		attempt += 1;
		const probe = await probeComfyReady(podId);
		if (probe.ready) {
			const elapsed = Math.round((Date.now() - startedAt) / 1000);
			console.log(`[${ts()}] ComfyUI ready after ${elapsed}s, terminating...`);
			await terminatePod(apiKey, podId);
			console.log(`[${ts()}] done. volume warmed.`);
			return;
		}
		if (attempt % 4 === 0) {
			const elapsed = Math.round((Date.now() - startedAt) / 1000);
			console.log(
				`[${ts()}] still warming (${elapsed}s, attempt ${attempt}, last=${probe.status})`
			);
		}
		await sleep(COMFY_READY_POLL_MS);
	}
	console.log(`[${ts()}] timeout, terminating anyway`);
	await terminatePod(apiKey, podId);
	process.exitCode = 1;
}

main().catch((error) => {
	console.error(`[${ts()}] fatal:`, error);
	process.exitCode = 1;
});
