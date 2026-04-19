import { z } from "zod";

const TRAILING_SLASH = /\/$/u;

const POD_STATUSES = ["RUNNING", "EXITED", "TERMINATED"] as const;
export type RunpodPodStatus = (typeof POD_STATUSES)[number];

/**
 * Subset of `pod.machine` we care about for the training-details UI.
 * RunPod's `/pods` responses nest the GPU/datacenter facts under
 * `machine`, so this is what feeds the "what GPU is the inference
 * actually running on" line in the UI.
 *
 * Everything is optional because RunPod has historically added/renamed
 * machine fields without warning, and we don't want a dropped field to
 * crash the whole training pipeline.
 */
const RUNPOD_MACHINE_SCHEMA = z
	.object({
		dataCenterId: z.string().nullable().optional(),
		gpuDisplayName: z.string().nullable().optional(),
		gpuTypeId: z.string().nullable().optional(),
		location: z.string().nullable().optional(),
		podHostId: z.string().nullable().optional(),
		secureCloud: z.boolean().optional(),
	})
	.passthrough();

export type RunpodMachineInfo = z.infer<typeof RUNPOD_MACHINE_SCHEMA>;

const RUNPOD_POD_SCHEMA = z.object({
	id: z.string().min(1),
	name: z.string().nullable().optional(),
	desiredStatus: z.enum(POD_STATUSES).optional(),
	lastStatusChange: z.string().optional(),
	costPerHr: z.number().optional(),
	gpuCount: z.number().optional(),
	image: z.string().optional(),
	machine: RUNPOD_MACHINE_SCHEMA.nullable().optional(),
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
	/**
	 * Как scheduler ранжирует `gpuTypeIds`:
	 *   - `availability` (default по доке: docs.runpod.io/api-reference/pods/POST/pods)
	 *     — берёт первый ДОСТУПНЫЙ из списка
	 *   - `custom` — строгий порядок, fail если первый занят
	 *
	 * Дока говорит default = availability, но эмпирически (апрель 2026)
	 * без явного указания scheduler возвращает 500 "no resources" даже
	 * когда другие GPU из массива доступны. Поэтому мы передаём это
	 * поле всегда явно из `createPod`.
	 */
	gpuTypePriority?: "availability" | "custom";
	imageName: string;
	interruptible?: boolean;
	name: string;
	networkVolumeId?: string;
	ports?: string[];
	supportPublicIp?: boolean;
	/**
	 * Опциональный id RunPod-template (например, `0fqzfjy6f3` —
	 * официальный ostris ai-toolkit). RunPod scheduler предпочитает
	 * хосты, где этот template уже warm, что радикально сокращает
	 * provisioning.
	 */
	templateId?: string;
	volumeInGb?: number;
	volumeMountPath?: string;
}

export interface RunpodPodClientOptions {
	apiKey: string;
	baseUrl?: string;
	fetchImpl?: typeof fetch;
}

const NO_CAPACITY_PATTERN =
	/no instances|does not have the resources|no resources|out of stock|no available|capacity/iu;

/**
 * Признак ошибки RunPod, которая по сути значит "сейчас этот тип GPU
 * не получится поднять, попробуй другой". Используется для fallback'а на
 * следующий gpu type в `createPod`.
 */
function isNoCapacityError(err: unknown): boolean {
	if (!(err instanceof Error)) {
		return false;
	}
	return NO_CAPACITY_PATTERN.test(err.message);
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

	private async postCreatePod(
		payload: CreatePodInput
	): Promise<RunpodPodSnapshot> {
		const response = await this.fetchImpl(`${this.baseUrl}/pods`, {
			body: JSON.stringify(payload),
			headers: this.authHeaders,
			method: "POST",
		});
		await ensureOk(response, "RunPod /pods (create)");
		const body = await response.json();
		return RUNPOD_POD_SCHEMA.parse(body);
	}

	/**
	 * Создаёт RunPod pod, выбирая первый доступный GPU из `input.gpuTypeIds`.
	 *
	 * Основной путь — один POST с `gpuTypePriority: "availability"`. Согласно
	 * docs.runpod.io/api-reference/pods/POST/pods это default-поведение
	 * scheduler'а: он сам перебирает массив и берёт первый свободный.
	 * Эмпирически (апрель 2026) без явного указания этого поля сервер
	 * флакает с 500 "does not have the resources" даже когда другие GPU
	 * из массива доступны — похоже на баг, что default не подставляется
	 * на стороне RunPod. Передаём явно — проблема исчезает.
	 *
	 * Backstop: если даже с `availability` сервер вернул capacity-ошибку
	 * (бывает при настоящей нехватке мощностей или флаках scheduler'а),
	 * последовательно пробуем каждый gpuTypeId отдельно. Не-capacity
	 * ошибки (auth, валидация) пробрасываем сразу — повторять бессмысленно.
	 */
	async createPod(input: CreatePodInput): Promise<RunpodPodSnapshot> {
		if (input.gpuTypeIds.length === 0) {
			throw new Error("RunPod /pods (create): gpuTypeIds is empty");
		}
		const payload: CreatePodInput = {
			...input,
			gpuTypePriority: input.gpuTypePriority ?? "availability",
		};
		try {
			return await this.postCreatePod(payload);
		} catch (err) {
			if (!isNoCapacityError(err) || payload.gpuTypeIds.length === 1) {
				throw err;
			}
		}
		const errors: string[] = [];
		for (const gpuTypeId of payload.gpuTypeIds) {
			try {
				return await this.postCreatePod({
					...payload,
					gpuTypeIds: [gpuTypeId],
				});
			} catch (err) {
				if (!isNoCapacityError(err)) {
					throw err;
				}
				const message = err instanceof Error ? err.message : String(err);
				errors.push(`${gpuTypeId}: ${message}`);
			}
		}
		throw new Error(
			`RunPod /pods (create) failed for all ${payload.gpuTypeIds.length} gpu types — no capacity:\n  - ${errors.join("\n  - ")}`
		);
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
