import { z } from "zod";

const TRAILING_SLASH = /\/$/u;

const POD_STATUSES = ["RUNNING", "EXITED", "TERMINATED"] as const;
export type RunpodPodStatus = (typeof POD_STATUSES)[number];

const RUNPOD_POD_SCHEMA = z.object({
	id: z.string().min(1),
	name: z.string().nullable().optional(),
	desiredStatus: z.enum(POD_STATUSES).optional(),
	lastStatusChange: z.string().optional(),
	costPerHr: z.number().optional(),
	image: z.string().optional(),
	machine: z.unknown().optional(),
});

export type RunpodPodSnapshot = z.infer<typeof RUNPOD_POD_SCHEMA>;

export interface CreatePodInput {
	cloudType?: "SECURE" | "COMMUNITY";
	containerDiskInGb?: number;
	dockerEntrypoint?: string[];
	dockerStartCmd?: string[];
	env: Record<string, string>;
	gpuCount?: number;
	gpuTypeIds: string[];
	imageName: string;
	interruptible?: boolean;
	name: string;
	networkVolumeId?: string;
	ports?: string[];
	supportPublicIp?: boolean;
	volumeInGb?: number;
	volumeMountPath?: string;
}

export interface RunpodPodClientOptions {
	apiKey: string;
	baseUrl?: string;
	fetchImpl?: typeof fetch;
}

/**
 * Минимальный клиент к RunPod REST API (https://rest.runpod.io/v1) для pod-режима.
 * Покрывает только то, что нужно admin-worker-у: create / get / delete pod.
 */
export class RunpodPodClient {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly fetchImpl: typeof fetch;

	constructor(options: RunpodPodClientOptions) {
		this.apiKey = options.apiKey;
		this.baseUrl = (options.baseUrl ?? "https://rest.runpod.io/v1").replace(
			TRAILING_SLASH,
			""
		);
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	private get authHeaders(): Record<string, string> {
		return {
			authorization: `Bearer ${this.apiKey}`,
			"content-type": "application/json",
		};
	}

	async createPod(input: CreatePodInput): Promise<RunpodPodSnapshot> {
		const response = await this.fetchImpl(`${this.baseUrl}/pods`, {
			body: JSON.stringify(input),
			headers: this.authHeaders,
			method: "POST",
		});
		await ensureOk(response, "RunPod /pods (create)");
		const body = await response.json();
		return RUNPOD_POD_SCHEMA.parse(body);
	}

	async getPod(podId: string): Promise<RunpodPodSnapshot> {
		const response = await this.fetchImpl(`${this.baseUrl}/pods/${podId}`, {
			headers: this.authHeaders,
		});
		await ensureOk(response, `RunPod /pods/${podId} (get)`);
		const body = await response.json();
		return RUNPOD_POD_SCHEMA.parse(body);
	}

	async deletePod(podId: string): Promise<void> {
		try {
			await this.fetchImpl(`${this.baseUrl}/pods/${podId}`, {
				headers: this.authHeaders,
				method: "DELETE",
			});
		} catch {
			// best-effort cleanup; admin-worker still moves on.
		}
	}

	async stopPod(podId: string): Promise<void> {
		try {
			await this.fetchImpl(`${this.baseUrl}/pods/${podId}/stop`, {
				headers: this.authHeaders,
				method: "POST",
			});
		} catch {
			// best-effort
		}
	}
}

async function ensureOk(response: Response, label: string): Promise<void> {
	if (response.ok) {
		return;
	}
	let detail = "";
	try {
		const contentType = response.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			const body = (await response.json()) as Record<string, unknown>;
			detail =
				(typeof body.error === "string" && body.error) ||
				(typeof body.message === "string" && body.message) ||
				JSON.stringify(body);
		} else {
			detail = (await response.text()).trim();
		}
	} catch {
		detail = "";
	}
	const statusSuffix = response.statusText ? ` ${response.statusText}` : "";
	const detailSuffix = detail ? `: ${detail}` : "";
	throw new Error(
		`${label} failed (${response.status}${statusSuffix})${detailSuffix}`
	);
}
