import type { ComfyUIArtifactRef } from "../comfyui/client";
import type {
	ComfyUIHistoryItem,
	ComfyUIQueueItem,
	ComfyUIQueueResponse,
} from "../comfyui/types";

// RunPod proxy (pod-id-PORT.proxy.runpod.net) is fronted by Cloudflare и
// периодически отдаёт 5xx/timeout, пока pod ещё провижинится или из-за
// transient edge-проблем. Такие ошибки не должны валить exec — следующий poll
// либо пройдёт, либо api.get отдаст 404, и мы корректно зафейлим.
const COMFY_TRANSIENT_STATUSES = new Set([
	502, 503, 504, 520, 521, 522, 523, 524,
]);
const COMFY_FAILED_STATUS_PATTERN = /failed \((\d{3})\)/u;
const FETCH_NETWORK_ERROR_PATTERN =
	/fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|socket hang up|UND_ERR/iu;
const HISTORY_OUTPUTS_SUMMARY_MAX = 600;
const MESSAGES_SUMMARY_MAX = 2000;

export function isComfyTransientProxyError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	if (!error.message.startsWith("comfyui ")) {
		// Network-level fetch error без HTTP статуса — тоже считаем транзиентным
		// для ComfyUI запросов, но только если это произошло в comfyui/* контексте.
		return false;
	}
	if (FETCH_NETWORK_ERROR_PATTERN.test(error.message)) {
		return true;
	}
	const match = error.message.match(COMFY_FAILED_STATUS_PATTERN);
	if (!match) {
		return false;
	}
	const status = Number.parseInt(match[1] ?? "0", 10);
	return COMFY_TRANSIENT_STATUSES.has(status);
}

export function pickPrimaryArtifact(
	outputs: ComfyUIHistoryItem["outputs"]
): ComfyUIArtifactRef | null {
	for (const node of Object.values(outputs)) {
		if (node.videos?.length) {
			return node.videos[0] ?? null;
		}
		if (node.gifs?.length) {
			return node.gifs[0] ?? null;
		}
		if (node.images?.length) {
			return node.images[0] ?? null;
		}
	}
	return null;
}

/**
 * Summarises the structure of ComfyUI history `outputs` so engine errors carry
 * enough context to diagnose unexpected output shapes (e.g. custom nodes that
 * use non-standard keys like `result_files` or `audio`).
 */
export function summarizeHistoryOutputs(
	outputs: ComfyUIHistoryItem["outputs"]
): string {
	const summary: Record<string, string[]> = {};
	for (const [nodeId, node] of Object.entries(outputs)) {
		if (!node || typeof node !== "object") {
			continue;
		}
		summary[nodeId] = Object.keys(node);
	}
	const entries = Object.entries(summary);
	if (entries.length === 0) {
		return "{}";
	}
	return entries
		.map(([nid, keys]) => `${nid}=[${keys.join(",")}]`)
		.join(" ")
		.slice(0, HISTORY_OUTPUTS_SUMMARY_MAX);
}

export function findEntryByClientId(
	history: Record<string, ComfyUIHistoryItem>,
	clientId: string
): ComfyUIHistoryItem | null {
	for (const item of Object.values(history)) {
		const itemClientId = extractClientId(item.prompt);
		if (itemClientId === clientId) {
			return item;
		}
	}
	return null;
}

export function queueContainsClientId(
	queue: ComfyUIQueueResponse,
	clientId: string
): boolean {
	const all = [...queue.queue_running, ...queue.queue_pending];
	return all.some((item) => extractClientId(item) === clientId);
}

export function extractClientId(item: ComfyUIQueueItem): string | null {
	const extra = item[3];
	const raw = extra?.client_id;
	return typeof raw === "string" && raw.length > 0 ? raw : null;
}

export function stringifyMessages(messages: unknown): string {
	if (!messages) {
		return "no details";
	}
	try {
		return JSON.stringify(messages).slice(0, MESSAGES_SUMMARY_MAX);
	} catch {
		return String(messages).slice(0, MESSAGES_SUMMARY_MAX);
	}
}

export function inferArtifactExtension(contentType: string): string {
	const lower = contentType.toLowerCase();
	if (lower.startsWith("video/mp4")) {
		return ".mp4";
	}
	if (lower.startsWith("video/webm")) {
		return ".webm";
	}
	if (lower.startsWith("image/png")) {
		return ".png";
	}
	if (lower.startsWith("image/jpeg")) {
		return ".jpg";
	}
	if (lower.startsWith("image/webp")) {
		return ".webp";
	}
	return ".bin";
}

export function buildComfyArtifactKey(
	prefix: string,
	requestId: string,
	contentType: string
): string {
	const extension = inferArtifactExtension(contentType);
	return `${prefix}/${requestId}/output${extension}`;
}
