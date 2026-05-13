import { z } from "zod";

import { isNoCapacityError, type RunpodHttpClient } from "../http/client";

export const POD_DESIRED_STATUSES = [
	"RUNNING",
	"EXITED",
	"TERMINATED",
] as const;

export type PodDesiredStatus = (typeof POD_DESIRED_STATUSES)[number];

const podMachineSchema = z
	.object({
		dataCenterId: z.string().nullable().optional(),
		gpuDisplayName: z.string().nullable().optional(),
		gpuTypeId: z.string().nullable().optional(),
		location: z.string().nullable().optional(),
		podHostId: z.string().nullable().optional(),
		secureCloud: z.boolean().optional(),
	})
	.passthrough();

const podSnapshotSchema = z
	.object({
		id: z.string().min(1),
		name: z.string().nullable().optional(),
		desiredStatus: z.enum(POD_DESIRED_STATUSES).optional(),
		lastStatusChange: z.string().optional(),
		costPerHr: z.number().optional(),
		gpuCount: z.number().optional(),
		image: z.string().optional(),
		machine: podMachineSchema.nullable().optional(),
	})
	.passthrough();

export type PodSnapshot = z.infer<typeof podSnapshotSchema>;

export interface CreatePodInput {
	cloudType?: "SECURE" | "COMMUNITY";
	containerDiskInGb?: number;
	dockerStartCmd?: string[];
	env: Record<string, string>;
	gpuCount?: number;
	gpuTypeIds: string[];
	gpuTypePriority?: "availability" | "custom";
	imageName: string;
	name: string;
	networkVolumeId?: string;
	ports?: string[];
	supportPublicIp?: boolean;
	templateId?: string;
	volumeInGb?: number;
	volumeMountPath?: string;
}

/**
 * Низкоуровневый клиент REST API подов (`/v1/pods`). Только CRUD над
 * snapshot'ом; politики жизненного цикла (создал-подождал-убил) — на уровне
 * `engine/pod-engine.ts`.
 */
export interface RunpodPodsApi {
	create(input: CreatePodInput): Promise<PodSnapshot>;
	delete(podId: string): Promise<void>;
	get(podId: string): Promise<PodSnapshot>;
	/**
	 * Все pods, видимые под текущим RunPod API token'ом. Используется reaper'ом
	 * для поиска осиротевших pods, выпавших из warm-pool. RunPod возвращает
	 * массив `PodSnapshot`'ов в `{ data: PodSnapshot[] }` обёртке, что мы
	 * разворачиваем здесь.
	 */
	list(): Promise<PodSnapshot[]>;
}

export function createPodsApi(http: RunpodHttpClient): RunpodPodsApi {
	const postCreate = async (payload: CreatePodInput): Promise<PodSnapshot> => {
		const response = await http.post(
			"/pods",
			payload as unknown as Record<string, unknown>,
			"runpod /pods (create)"
		);
		return podSnapshotSchema.parse(response);
	};

	const createWithCapacityFallback = async (
		payload: CreatePodInput
	): Promise<PodSnapshot> => {
		try {
			return await postCreate(payload);
		} catch (error) {
			if (!isNoCapacityError(error) || payload.gpuTypeIds.length === 1) {
				throw error;
			}
		}
		return tryEachGpuType(postCreate, payload);
	};

	return {
		create(input) {
			if (input.gpuTypeIds.length === 0) {
				return Promise.reject(
					new Error("runpod /pods (create): gpuTypeIds is empty")
				);
			}
			return createWithCapacityFallback({
				...input,
				gpuTypePriority: input.gpuTypePriority ?? "availability",
			});
		},

		async delete(podId) {
			await http.delete(`/pods/${podId}`, `runpod /pods/${podId} (delete)`);
		},

		async get(podId) {
			const response = await http.get(
				`/pods/${podId}`,
				`runpod /pods/${podId} (get)`
			);
			return podSnapshotSchema.parse(response);
		},

		async list() {
			const response = await http.get("/pods", "runpod /pods (list)");
			// RunPod REST returns either `{ data: [...] }` (paginated future) or a
			// bare array. Handle both — server-side shape evolved over time.
			const rawList = Array.isArray(response)
				? response
				: (response as { data?: unknown[] }).data;
			if (!Array.isArray(rawList)) {
				return [];
			}
			const parsed: PodSnapshot[] = [];
			for (const item of rawList) {
				const result = podSnapshotSchema.safeParse(item);
				if (result.success) {
					parsed.push(result.data);
				}
			}
			return parsed;
		},
	};
}

async function tryEachGpuType(
	postCreate: (payload: CreatePodInput) => Promise<PodSnapshot>,
	payload: CreatePodInput
): Promise<PodSnapshot> {
	const errors: string[] = [];
	for (const gpuTypeId of payload.gpuTypeIds) {
		try {
			return await postCreate({ ...payload, gpuTypeIds: [gpuTypeId] });
		} catch (error) {
			if (!isNoCapacityError(error)) {
				throw error;
			}
			const message = error instanceof Error ? error.message : String(error);
			errors.push(`${gpuTypeId}: ${message}`);
		}
	}
	throw new Error(
		`runpod /pods (create): no capacity for any of ${payload.gpuTypeIds.length} gpu types:\n  - ${errors.join("\n  - ")}`
	);
}
