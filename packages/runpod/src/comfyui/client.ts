import type {
	ComfyUIArtifactRef,
	ComfyUIClientOptions,
	ComfyUIHistoryEntry,
	ComfyUIHistoryItem,
	ComfyUIPromptArgs,
	ComfyUIPromptResponse,
	ComfyUIQueueResponse,
	ComfyUISystemStats,
	ComfyUIUserdataEntry,
	LoraDownloadProgressEntry,
	LoraDownloadStartArgs,
} from "./types";

export type {
	ComfyUIArtifactRef,
	ComfyUIClientOptions,
	ComfyUIHistoryItem,
	ComfyUINodeApiInput,
	ComfyUIQueueResponse,
} from "./types";

const TRAILING_SLASH = /\/$/u;
const COOKIE_HEADER = /AIOHTTP_SESSION="?([^;",]+)/u;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_ERROR_BODY_LENGTH = 2000;

export interface LoraManagerLibrariesSnapshot {
	active_library?: string;
	libraries?: Record<string, LoraManagerLibrary>;
}

export interface LoraManagerLibrary {
	default_lora_root?: string;
	folder_paths?: {
		loras?: string[];
	};
}

export interface LoraManagerSettings {
	civitai_api_key?: string;
	default_lora_root?: string;
	[key: string]: unknown;
}

export interface ComfyUIClient {
	authorizedFetch(path: string, init?: RequestInit): Promise<Response>;
	cancelDownload(downloadId: string): Promise<void>;
	downloadArtifact(ref: ComfyUIArtifactRef): Promise<ArrayBuffer>;
	getCivitaiVersionInfo(
		modelType: string,
		modelVersionId: number
	): Promise<CivitaiVersionInfo | null>;
	getHistory(): Promise<Record<string, ComfyUIHistoryItem>>;
	getHistoryEntry(promptId: string): Promise<ComfyUIHistoryEntry | null>;
	getLoraManagerLibraries(): Promise<LoraManagerLibrariesSnapshot>;
	getLoraManagerSettings(): Promise<LoraManagerSettings>;
	getQueue(): Promise<ComfyUIQueueResponse>;
	getSystemStats(): Promise<ComfyUISystemStats>;
	listUserdata(dir: string): Promise<ComfyUIUserdataEntry[]>;
	login(): Promise<void>;
	pollLoraDownload(downloadId: string): Promise<LoraDownloadProgressEntry>;
	readUserdata(relativePath: string): Promise<string>;
	startLoraDownload(args: LoraDownloadStartArgs): Promise<unknown>;
	submitPrompt(args: ComfyUIPromptArgs): Promise<ComfyUIPromptResponse>;
	updateLoraManagerSettings(patch: Record<string, unknown>): Promise<void>;
	uploadInputImage(args: {
		bytes: ArrayBuffer | Uint8Array;
		filename: string;
		overwrite?: boolean;
		subfolder?: string;
	}): Promise<{ name: string; subfolder: string; type: string }>;
}

export interface CivitaiVersionInfo {
	files?: Array<{
		downloadUrl?: string;
		name?: string;
		primary?: boolean;
		sizeKB?: number;
	}>;
	id?: number;
	model?: { name?: string; type?: string };
	modelId?: number;
	name?: string;
}

/**
 * HTTP-клиент к ComfyUI внутри RunPod pod (template `p4f6rm9tb4`).
 * Управляет AIOHTTP_SESSION cookie через `liusida/ComfyUI-Login` плагин,
 * а также инкапсулирует Lora Manager API (`willmiao/ComfyUI-Lora-Manager`),
 * стандартные ComfyUI endpoints (/prompt, /history, /view, /upload/image)
 * и /api/v2/userdata для чтения встроенных workflows.
 */
export function createComfyUIClient(
	options: ComfyUIClientOptions
): ComfyUIClient {
	const baseUrl = options.baseUrl.replace(TRAILING_SLASH, "");
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
	let sessionCookie: string | null = null;

	const buildHeaders = (
		extra?: Record<string, string> | Headers | undefined
	): Headers => {
		const headers = new Headers(extra);
		if (sessionCookie) {
			headers.set("cookie", `AIOHTTP_SESSION=${sessionCookie}`);
		}
		return headers;
	};

	const request = async (
		path: string,
		init?: RequestInit
	): Promise<Response> => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await fetchImpl(`${baseUrl}${path}`, {
				...init,
				headers: buildHeaders(
					init?.headers as Record<string, string> | Headers | undefined
				),
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timer);
		}
	};

	const expectJson = async <T>(
		response: Response,
		label: string
	): Promise<T> => {
		if (!response.ok) {
			throw await toError(response, label);
		}
		const parsed = (await response.json().catch(() => null)) as T | null;
		if (parsed === null) {
			throw new Error(`${label}: empty or invalid JSON`);
		}
		return parsed;
	};

	const login = async (): Promise<void> => {
		const body = new URLSearchParams({
			guest_mode: "",
			password: options.password,
			username: options.username,
		});
		const response = await request("/login", {
			body,
			headers: { "content-type": "application/x-www-form-urlencoded" },
			method: "POST",
			redirect: "manual",
		});
		const setCookie = response.headers.get("set-cookie");
		if (response.status !== 302 && response.status !== 200) {
			throw await toError(response, "comfyui /login");
		}
		if (!setCookie) {
			throw new Error("comfyui /login: missing Set-Cookie header");
		}
		const match = COOKIE_HEADER.exec(setCookie);
		if (!match?.[1]) {
			throw new Error(
				`comfyui /login: cannot parse AIOHTTP_SESSION from ${setCookie}`
			);
		}
		sessionCookie = match[1];
	};

	const ensureCookie = async (): Promise<void> => {
		if (!sessionCookie) {
			await login();
		}
	};

	const getSystemStats = async (): Promise<ComfyUISystemStats> => {
		await ensureCookie();
		const response = await request("/system_stats");
		return expectJson<ComfyUISystemStats>(response, "comfyui /system_stats");
	};

	const submitPrompt = async (
		args: ComfyUIPromptArgs
	): Promise<ComfyUIPromptResponse> => {
		await ensureCookie();
		const payload: Record<string, unknown> = {
			client_id:
				args.clientId ??
				(typeof crypto !== "undefined" && "randomUUID" in crypto
					? crypto.randomUUID()
					: `comfyui-${Date.now()}`),
			prompt: args.prompt,
		};
		if (args.extraData) {
			payload.extra_data = args.extraData;
		}
		const response = await request("/prompt", {
			body: JSON.stringify(payload),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		return expectJson<ComfyUIPromptResponse>(response, "comfyui /prompt");
	};

	const getHistoryEntry = async (
		promptId: string
	): Promise<ComfyUIHistoryEntry | null> => {
		await ensureCookie();
		const response = await request(`/history/${promptId}`);
		if (!response.ok) {
			throw await toError(response, "comfyui /history");
		}
		const parsed = (await response.json().catch(() => null)) as Record<
			string,
			ComfyUIHistoryEntry
		> | null;
		if (parsed === null) {
			return null;
		}
		const entry = parsed[promptId];
		return entry ?? null;
	};

	const getHistory = async (): Promise<Record<string, ComfyUIHistoryItem>> => {
		await ensureCookie();
		const response = await request("/history");
		return expectJson(response, "comfyui /history");
	};

	const getQueue = async (): Promise<ComfyUIQueueResponse> => {
		await ensureCookie();
		const response = await request("/queue");
		return expectJson(response, "comfyui /queue");
	};

	const downloadArtifact = async (
		ref: ComfyUIArtifactRef
	): Promise<ArrayBuffer> => {
		await ensureCookie();
		const params = new URLSearchParams({
			filename: ref.filename,
			subfolder: ref.subfolder ?? "",
			type: ref.type ?? "output",
		});
		const response = await request(`/view?${params.toString()}`);
		if (!response.ok) {
			throw await toError(response, "comfyui /view");
		}
		return await response.arrayBuffer();
	};

	const uploadInputImage: ComfyUIClient["uploadInputImage"] = async (args) => {
		await ensureCookie();
		const form = new FormData();
		const buffer =
			args.bytes instanceof Uint8Array
				? args.bytes
				: new Uint8Array(args.bytes);
		const blob = new Blob([buffer], {
			type: "application/octet-stream",
		});
		form.append("image", blob, args.filename);
		form.append("type", "input");
		form.append("overwrite", args.overwrite === false ? "0" : "1");
		if (args.subfolder) {
			form.append("subfolder", args.subfolder);
		}
		const response = await request("/upload/image", {
			body: form,
			method: "POST",
		});
		return expectJson(response, "comfyui /upload/image");
	};

	const startLoraDownload = async (
		args: LoraDownloadStartArgs
	): Promise<unknown> => {
		await ensureCookie();
		const body = {
			download_id: args.downloadId,
			model_id: args.modelId,
			model_root: args.modelRoot ?? "loras",
			model_version_id: args.modelVersionId,
			relative_path: args.relativePath ?? "",
			use_default_paths: args.useDefaultPaths ?? false,
			...(args.source ? { source: args.source } : {}),
		};
		const response = await request("/api/lm/download-model", {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		return expectJson(response, "comfyui /api/lm/download-model");
	};

	const pollLoraDownload = async (
		downloadId: string
	): Promise<LoraDownloadProgressEntry> => {
		await ensureCookie();
		const response = await request(
			`/api/lm/download-progress/${encodeURIComponent(downloadId)}`
		);
		if (response.status === 404) {
			return {};
		}
		const data = await expectJson<
			LoraDownloadProgressEntry | { downloads: LoraDownloadProgressEntry[] }
		>(response, "comfyui /api/lm/download-progress");
		if ("downloads" in data && Array.isArray(data.downloads)) {
			const entry = data.downloads.find(
				(d) => (d as { download_id?: string }).download_id === downloadId
			);
			return entry ?? {};
		}
		return data as LoraDownloadProgressEntry;
	};

	const cancelDownload = async (downloadId: string): Promise<void> => {
		await ensureCookie();
		const response = await request(
			`/api/lm/cancel-download-get?download_id=${encodeURIComponent(downloadId)}`
		);
		if (!response.ok) {
			throw await toError(response, "comfyui /api/lm/cancel-download-get");
		}
	};

	const listUserdata = async (dir: string): Promise<ComfyUIUserdataEntry[]> => {
		await ensureCookie();
		const response = await request(
			`/api/v2/userdata?dir=${encodeURIComponent(dir)}`
		);
		return expectJson(response, "comfyui /api/v2/userdata");
	};

	const readUserdata = async (relativePath: string): Promise<string> => {
		await ensureCookie();
		const response = await request(
			`/api/v2/userdata/${encodeURIComponent(relativePath)}`
		);
		if (!response.ok) {
			throw await toError(response, "comfyui /api/v2/userdata read");
		}
		return await response.text();
	};

	const getLoraManagerSettings = async (): Promise<LoraManagerSettings> => {
		await ensureCookie();
		const response = await request("/api/lm/settings");
		const data = await expectJson<{
			settings?: LoraManagerSettings;
			success?: boolean;
		}>(response, "comfyui /api/lm/settings");
		return data.settings ?? {};
	};

	const getLoraManagerLibraries =
		async (): Promise<LoraManagerLibrariesSnapshot> => {
			await ensureCookie();
			const response = await request("/api/lm/settings/libraries");
			const data = await expectJson<
				LoraManagerLibrariesSnapshot & { success?: boolean }
			>(response, "comfyui /api/lm/settings/libraries");
			return data;
		};

	const updateLoraManagerSettings = async (
		patch: Record<string, unknown>
	): Promise<void> => {
		await ensureCookie();
		const response = await request("/api/lm/settings", {
			body: JSON.stringify(patch),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		if (!response.ok) {
			throw await toError(response, "comfyui /api/lm/settings (POST)");
		}
	};

	const getCivitaiVersionInfo = async (
		modelType: string,
		modelVersionId: number
	): Promise<CivitaiVersionInfo | null> => {
		await ensureCookie();
		const response = await request(
			`/api/lm/${encodeURIComponent(modelType)}/civitai/model/version/${encodeURIComponent(String(modelVersionId))}`
		);
		if (response.status === 404) {
			return null;
		}
		const data = await expectJson<
			CivitaiVersionInfo | { success: boolean; data?: CivitaiVersionInfo }
		>(response, "comfyui /api/lm/civitai/model/version");
		if ("success" in data && "data" in data) {
			return data.data ?? null;
		}
		return data as CivitaiVersionInfo;
	};

	return {
		authorizedFetch: async (path, init) => {
			await ensureCookie();
			return request(path, init);
		},
		cancelDownload,
		downloadArtifact,
		getCivitaiVersionInfo,
		getHistory,
		getHistoryEntry,
		getLoraManagerLibraries,
		getLoraManagerSettings,
		getQueue,
		getSystemStats,
		listUserdata,
		login,
		pollLoraDownload,
		readUserdata,
		startLoraDownload,
		submitPrompt,
		updateLoraManagerSettings,
		uploadInputImage,
	};
}

async function toError(response: Response, label: string): Promise<Error> {
	const contentType = response.headers.get("content-type") ?? "";
	let message: string;
	if (contentType.includes("application/json")) {
		const body = (await response.json().catch(() => null)) as Record<
			string,
			unknown
		> | null;
		const fromBody = body
			? (extractErrorMessage(body) ?? JSON.stringify(body))
			: "";
		message = fromBody;
	} else {
		const text = (await response.text().catch(() => "")).trim();
		message = text;
	}
	if (message.length > MAX_ERROR_BODY_LENGTH) {
		message = `${message.slice(0, MAX_ERROR_BODY_LENGTH - 3)}...`;
	}
	if (!message) {
		message = response.statusText || `status ${response.status}`;
	}
	return new Error(`${label} failed (${response.status}): ${message}`);
}

function extractErrorMessage(body: Record<string, unknown>): string | null {
	for (const key of ["error", "message", "detail"] as const) {
		const value = body[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return null;
}
