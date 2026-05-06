export interface ComfyUIClientCredentials {
	password: string;
	username: string;
}

export interface ComfyUIClientOptions extends ComfyUIClientCredentials {
	baseUrl: string;
	fetchImpl?: typeof fetch;
	requestTimeoutMs?: number;
}

export interface ComfyUIPromptResponse {
	node_errors?: Record<string, unknown>;
	number: number;
	prompt_id: string;
}

export interface ComfyUISystemStats {
	devices: Array<{
		index: number;
		name: string;
		type: string;
		vram_free: number;
		vram_total: number;
	}>;
	system: {
		comfyui_version?: string;
		os: string;
		ram_free: number;
		ram_total: number;
	};
}

export interface ComfyUIHistoryEntry {
	outputs: Record<string, ComfyUIOutputs>;
	prompt: unknown[];
	status?: {
		completed: boolean;
		messages?: unknown[];
		status_str: string;
	};
}

export interface ComfyUIOutputs {
	gifs?: ComfyUIArtifactRef[];
	images?: ComfyUIArtifactRef[];
	videos?: ComfyUIArtifactRef[];
}

export interface ComfyUIArtifactRef {
	filename: string;
	subfolder: string;
	type: string;
}

export interface ComfyUIUserdataEntry {
	modified?: number;
	name: string;
	path: string;
	size?: number;
	type: "directory" | "file";
}

export interface LoraDownloadStartArgs {
	downloadId: string;
	modelId: number;
	modelRoot?: string;
	modelVersionId: number;
	relativePath?: string;
	source?: string;
	useDefaultPaths?: boolean;
}

export interface LoraDownloadProgressEntry {
	bytes_downloaded?: number;
	bytes_total?: number;
	error?: string;
	file_path?: string;
	progress?: number;
	relative_path?: string;
	status?: string;
}

export interface ComfyUIPromptArgs {
	clientId?: string;
	extraData?: Record<string, unknown>;
	prompt: Record<string, ComfyUINodeApiInput>;
}

export interface ComfyUIQueueResponse {
	queue_pending: ComfyUIQueueItem[];
	queue_running: ComfyUIQueueItem[];
}

/**
 * ComfyUI returns queue items as 5-tuples:
 * [number, prompt_id, prompt_graph, extra_data, output_node_ids].
 * `extra_data.client_id` is the field we set when submitting via `/prompt`.
 */
export type ComfyUIQueueItem = [
	number,
	string,
	Record<string, ComfyUINodeApiInput>,
	{ client_id?: string; extra_pnginfo?: unknown },
	string[],
];

export interface ComfyUIHistoryItem {
	outputs: Record<string, ComfyUIOutputs>;
	prompt: ComfyUIQueueItem;
	status?: {
		completed: boolean;
		messages?: unknown[];
		status_str: string;
	};
}

export interface ComfyUINodeApiInput {
	_meta?: { title?: string };
	class_type: string;
	inputs: Record<
		string,
		number | string | boolean | [string, number] | unknown
	>;
}
