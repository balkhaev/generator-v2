import type {
	CreateRunpodNetworkVolumeInput,
	CreateRunpodPodTemplateInput,
	ListRunpodPodTemplatesQuery,
	RunpodNetworkVolume,
	RunpodPodTemplate,
	UpdateRunpodNetworkVolumeInput,
	UpdateRunpodPodTemplateInput,
} from "@generator/contracts/runpod-admin";

import {
	createNoopRunpodRegistryReloadBus,
	type RunpodRegistryReloadBus,
} from "@/domain/runpod-registry-reload-bus";
import type {
	RunpodNetworkVolumeRepository,
	RunpodPodTemplateRepository,
} from "@/repositories/runpod-admin";

const TRIM_PATTERN = /^\s+|\s+$/gu;

function normalizeString(value: string): string {
	return value.replace(TRIM_PATTERN, "");
}

/**
 * Тройное состояние для update patch:
 * - undefined  — поле не меняем
 * - null       — явно сбросить в null
 * - string     — записать новое значение (trim'нутое)
 *
 * Помогает обойти `lint/style/noNestedTernary` для PATCH-полей с nullable.
 */
function normalizeNullablePatch(
	value: string | null | undefined
): string | null | undefined {
	if (value === undefined) {
		return;
	}
	if (value === null) {
		return null;
	}
	return normalizeString(value);
}

function validateName(value: string, label: string): string {
	const trimmed = normalizeString(value);
	if (trimmed.length === 0) {
		throw new Error(`${label} is required`);
	}
	return trimmed;
}

/**
 * Тонкий service-слой поверх repositories. Здесь же валидация имён, gpu
 * списков и нормализация defaultEnv: пользователь не должен сам гарантировать
 * что в админке нет пустых строк / дублей.
 */
export interface RunpodAdminService {
	createPodTemplate(
		input: CreateRunpodPodTemplateInput
	): Promise<RunpodPodTemplate>;
	createVolume(
		input: CreateRunpodNetworkVolumeInput
	): Promise<RunpodNetworkVolume>;
	deletePodTemplate(id: string): Promise<RunpodPodTemplate | null>;
	deleteVolume(id: string): Promise<RunpodNetworkVolume | null>;
	getPodTemplate(id: string): Promise<RunpodPodTemplate | null>;
	getVolume(id: string): Promise<RunpodNetworkVolume | null>;
	listPodTemplates(
		query: ListRunpodPodTemplatesQuery
	): Promise<RunpodPodTemplate[]>;
	listVolumes(): Promise<RunpodNetworkVolume[]>;
	updatePodTemplate(
		id: string,
		patch: UpdateRunpodPodTemplateInput
	): Promise<RunpodPodTemplate | null>;
	updateVolume(
		id: string,
		patch: UpdateRunpodNetworkVolumeInput
	): Promise<RunpodNetworkVolume | null>;
}

interface RunpodAdminServiceDeps {
	podTemplates: RunpodPodTemplateRepository;
	/**
	 * Опционально. Если передан — после успешных mutation методов сервис
	 * публикует событие, которое generator-api/worker подхватывают и
	 * делают graceful self-restart для перечитывания registry. Без bus'а
	 * (например, в unit-тестах) — silent no-op.
	 */
	reloadBus?: RunpodRegistryReloadBus;
	volumes: RunpodNetworkVolumeRepository;
}

function normalizeStringList(values: string[] | undefined): string[] {
	if (!values) {
		return [];
	}
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of values) {
		const trimmed = normalizeString(raw);
		if (trimmed.length === 0 || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

function normalizeDefaultEnv(
	env: Record<string, string> | undefined
): Record<string, string> {
	if (!env) {
		return {};
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) {
		const trimmedKey = normalizeString(key);
		if (trimmedKey.length === 0) {
			continue;
		}
		out[trimmedKey] = typeof value === "string" ? value : String(value);
	}
	return out;
}

function normalizeCreatePodTemplate(
	input: CreateRunpodPodTemplateInput
): CreateRunpodPodTemplateInput {
	const mode = input.mode;
	if (mode === "pod" && !input.runpodTemplateId) {
		throw new Error("runpodTemplateId is required for mode=pod");
	}
	if (mode === "serverless" && !input.runpodEndpointId) {
		throw new Error("runpodEndpointId is required for mode=serverless");
	}
	return {
		cloudType: input.cloudType ? normalizeString(input.cloudType) : undefined,
		containerDiskInGb: input.containerDiskInGb,
		defaultEnv: normalizeDefaultEnv(input.defaultEnv),
		description: input.description
			? normalizeString(input.description)
			: undefined,
		enabled: input.enabled,
		gpuTypeIds: normalizeStringList(input.gpuTypeIds),
		imageName: input.imageName ? normalizeString(input.imageName) : undefined,
		keepAliveMs: input.keepAliveMs,
		mode,
		name: validateName(input.name, "name"),
		runpodEndpointId: input.runpodEndpointId
			? normalizeString(input.runpodEndpointId)
			: undefined,
		runpodTemplateId: input.runpodTemplateId
			? normalizeString(input.runpodTemplateId)
			: undefined,
		timeoutMs: input.timeoutMs,
		volumeInGb: input.volumeInGb,
		volumes: input.volumes,
		workflowKey: validateName(input.workflowKey, "workflowKey"),
	};
}

function normalizeUpdatePodTemplate(
	input: UpdateRunpodPodTemplateInput
): UpdateRunpodPodTemplateInput {
	return {
		cloudType: normalizeNullablePatch(input.cloudType),
		containerDiskInGb: input.containerDiskInGb,
		defaultEnv:
			input.defaultEnv === undefined
				? undefined
				: normalizeDefaultEnv(input.defaultEnv),
		description:
			input.description === undefined
				? undefined
				: normalizeString(input.description),
		enabled: input.enabled,
		gpuTypeIds:
			input.gpuTypeIds === undefined
				? undefined
				: normalizeStringList(input.gpuTypeIds),
		imageName: normalizeNullablePatch(input.imageName),
		keepAliveMs: input.keepAliveMs,
		name:
			input.name === undefined ? undefined : validateName(input.name, "name"),
		runpodEndpointId: normalizeNullablePatch(input.runpodEndpointId),
		runpodTemplateId: normalizeNullablePatch(input.runpodTemplateId),
		timeoutMs: input.timeoutMs,
		volumeInGb: input.volumeInGb,
		volumes: input.volumes,
		workflowKey:
			input.workflowKey === undefined
				? undefined
				: validateName(input.workflowKey, "workflowKey"),
	};
}

export function createRunpodAdminService(
	deps: RunpodAdminServiceDeps
): RunpodAdminService {
	const bus = deps.reloadBus ?? createNoopRunpodRegistryReloadBus();
	return {
		async createPodTemplate(input) {
			const created = await deps.podTemplates.create(
				normalizeCreatePodTemplate(input)
			);
			await bus.publish("pod-template-created", { resourceId: created.id });
			return created;
		},
		async createVolume(input) {
			const created = await deps.volumes.create({
				datacenter: validateName(input.datacenter, "datacenter"),
				description: input.description
					? normalizeString(input.description)
					: undefined,
				gpuTypeIds: normalizeStringList(input.gpuTypeIds),
				name: validateName(input.name, "name"),
				runpodVolumeId: validateName(input.runpodVolumeId, "runpodVolumeId"),
				sizeGb: input.sizeGb,
			});
			await bus.publish("volume-created", { resourceId: created.id });
			return created;
		},
		async deletePodTemplate(id) {
			const deleted = await deps.podTemplates.delete(id);
			if (deleted) {
				await bus.publish("pod-template-deleted", { resourceId: id });
			}
			return deleted;
		},
		async deleteVolume(id) {
			const deleted = await deps.volumes.delete(id);
			if (deleted) {
				await bus.publish("volume-deleted", { resourceId: id });
			}
			return deleted;
		},
		getPodTemplate(id) {
			return deps.podTemplates.getById(id);
		},
		getVolume(id) {
			return deps.volumes.getById(id);
		},
		listPodTemplates(query) {
			return deps.podTemplates.list(query);
		},
		listVolumes() {
			return deps.volumes.list();
		},
		async updatePodTemplate(id, patch) {
			const updated = await deps.podTemplates.update(
				id,
				normalizeUpdatePodTemplate(patch)
			);
			if (updated) {
				await bus.publish("pod-template-updated", { resourceId: id });
			}
			return updated;
		},
		async updateVolume(id, patch) {
			const updates: UpdateRunpodNetworkVolumeInput = {
				datacenter:
					patch.datacenter === undefined
						? undefined
						: validateName(patch.datacenter, "datacenter"),
				description:
					patch.description === undefined
						? undefined
						: normalizeString(patch.description),
				gpuTypeIds:
					patch.gpuTypeIds === undefined
						? undefined
						: normalizeStringList(patch.gpuTypeIds),
				name:
					patch.name === undefined
						? undefined
						: validateName(patch.name, "name"),
				runpodVolumeId:
					patch.runpodVolumeId === undefined
						? undefined
						: validateName(patch.runpodVolumeId, "runpodVolumeId"),
				sizeGb: patch.sizeGb,
			};
			const updated = await deps.volumes.update(id, updates);
			if (updated) {
				await bus.publish("volume-updated", { resourceId: id });
			}
			return updated;
		},
	};
}
