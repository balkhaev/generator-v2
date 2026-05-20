import { beforeEach, describe, expect, it } from "bun:test";
import type {
	CreateRunpodNetworkVolumeInput,
	CreateRunpodPodTemplateInput,
	ListRunpodPodTemplatesQuery,
	RunpodNetworkVolume,
	RunpodPodTemplate,
	UpdateRunpodNetworkVolumeInput,
	UpdateRunpodPodTemplateInput,
} from "@generator/contracts/runpod-admin";
import type { RunpodRegistryReloadKind } from "@generator/runpod";

import {
	createRunpodAdminService,
	type RunpodAdminService,
} from "@/domain/runpod-admin";
import type { RunpodRegistryReloadBus } from "@/domain/runpod-registry-reload-bus";
import type {
	RunpodNetworkVolumeRepository,
	RunpodPodTemplateRepository,
} from "@/repositories/runpod-admin";

interface PublishedEvent {
	kind: RunpodRegistryReloadKind;
	resourceId?: string;
}

function createSpyBus(): RunpodRegistryReloadBus & {
	events: PublishedEvent[];
} {
	const events: PublishedEvent[] = [];
	return {
		events,
		publish(kind, options) {
			events.push({ kind, resourceId: options?.resourceId });
			return Promise.resolve();
		},
	};
}

const baseTemplate: RunpodPodTemplate = {
	cloudType: null,
	containerDiskInGb: 15,
	createdAt: "2026-01-01T00:00:00.000Z",
	defaultEnv: {},
	description: "",
	enabled: true,
	gpuTypeIds: ["NVIDIA A40"],
	id: "tpl-1",
	imageName: "img:latest",
	keepAliveMs: 600_000,
	mode: "pod",
	name: "ltx default",
	runpodEndpointId: null,
	runpodTemplateId: "p4f6rm9tb4",
	timeoutMs: 3_600_000,
	updatedAt: "2026-01-01T00:00:00.000Z",
	volumeInGb: 90,
	volumes: [],
	workflowKey: "ltx-2-3-video",
};

const baseVolume: RunpodNetworkVolume = {
	createdAt: "2026-01-01T00:00:00.000Z",
	datacenter: "EU-RO-1",
	description: "",
	gpuTypeIds: ["NVIDIA A40"],
	id: "vol-1",
	name: "ltx primary",
	runpodVolumeId: "abc123",
	sizeGb: 90,
	updatedAt: "2026-01-01T00:00:00.000Z",
};

function createInMemoryTemplates(): RunpodPodTemplateRepository {
	let store = new Map<string, RunpodPodTemplate>();
	store.set(baseTemplate.id, baseTemplate);
	return {
		create(input: CreateRunpodPodTemplateInput) {
			const id = `tpl-${store.size + 1}`;
			const tpl: RunpodPodTemplate = {
				...baseTemplate,
				...input,
				cloudType: input.cloudType ?? null,
				containerDiskInGb: input.containerDiskInGb ?? null,
				defaultEnv: input.defaultEnv ?? {},
				description: input.description ?? "",
				enabled: input.enabled ?? true,
				gpuTypeIds: input.gpuTypeIds ?? [],
				id,
				imageName: input.imageName ?? null,
				keepAliveMs: input.keepAliveMs ?? null,
				runpodEndpointId: input.runpodEndpointId ?? null,
				runpodTemplateId: input.runpodTemplateId ?? null,
				timeoutMs: input.timeoutMs ?? null,
				volumeInGb: input.volumeInGb ?? null,
				volumes: [],
			};
			store.set(id, tpl);
			return Promise.resolve(tpl);
		},
		delete(id: string) {
			const found = store.get(id) ?? null;
			if (found) {
				store.delete(id);
			}
			return Promise.resolve(found);
		},
		getById(id: string) {
			return Promise.resolve(store.get(id) ?? null);
		},
		list(_query: ListRunpodPodTemplatesQuery) {
			return Promise.resolve(Array.from(store.values()));
		},
		reset() {
			store = new Map();
			store.set(baseTemplate.id, baseTemplate);
		},
		update(id: string, patch: UpdateRunpodPodTemplateInput) {
			const existing = store.get(id);
			if (!existing) {
				return Promise.resolve(null);
			}
			const next: RunpodPodTemplate = {
				...existing,
				...(patch.name === undefined ? {} : { name: patch.name }),
				...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
			};
			store.set(id, next);
			return Promise.resolve(next);
		},
	} as RunpodPodTemplateRepository & { reset(): void };
}

function createInMemoryVolumes(): RunpodNetworkVolumeRepository {
	const store = new Map<string, RunpodNetworkVolume>();
	store.set(baseVolume.id, baseVolume);
	return {
		create(input: CreateRunpodNetworkVolumeInput) {
			const id = `vol-${store.size + 1}`;
			const created: RunpodNetworkVolume = {
				...baseVolume,
				...input,
				description: input.description ?? "",
				gpuTypeIds: input.gpuTypeIds ?? [],
				id,
			};
			store.set(id, created);
			return Promise.resolve(created);
		},
		delete(id: string) {
			const found = store.get(id) ?? null;
			if (found) {
				store.delete(id);
			}
			return Promise.resolve(found);
		},
		getById(id: string) {
			return Promise.resolve(store.get(id) ?? null);
		},
		list() {
			return Promise.resolve(Array.from(store.values()));
		},
		update(id: string, patch: UpdateRunpodNetworkVolumeInput) {
			const existing = store.get(id);
			if (!existing) {
				return Promise.resolve(null);
			}
			const next: RunpodNetworkVolume = {
				...existing,
				...(patch.name === undefined ? {} : { name: patch.name }),
			};
			store.set(id, next);
			return Promise.resolve(next);
		},
	} as RunpodNetworkVolumeRepository;
}

describe("RunpodAdminService → registry reload bus", () => {
	let service: RunpodAdminService;
	let bus: ReturnType<typeof createSpyBus>;

	beforeEach(() => {
		bus = createSpyBus();
		service = createRunpodAdminService({
			podTemplates: createInMemoryTemplates(),
			reloadBus: bus,
			volumes: createInMemoryVolumes(),
		});
	});

	it("publishes pod-template-created on createPodTemplate", async () => {
		const created = await service.createPodTemplate({
			mode: "pod",
			name: "new template",
			runpodTemplateId: "p4f6rm9tb4",
			workflowKey: "ltx-2-3-video",
		});
		expect(bus.events).toEqual([
			{ kind: "pod-template-created", resourceId: created.id },
		]);
	});

	it("publishes pod-template-updated on updatePodTemplate", async () => {
		await service.updatePodTemplate(baseTemplate.id, { name: "renamed" });
		expect(bus.events).toEqual([
			{ kind: "pod-template-updated", resourceId: baseTemplate.id },
		]);
	});

	it("does not publish updatePodTemplate when template missing", async () => {
		const result = await service.updatePodTemplate("does-not-exist", {
			name: "x",
		});
		expect(result).toBeNull();
		expect(bus.events).toEqual([]);
	});

	it("publishes pod-template-deleted on deletePodTemplate", async () => {
		await service.deletePodTemplate(baseTemplate.id);
		expect(bus.events).toEqual([
			{ kind: "pod-template-deleted", resourceId: baseTemplate.id },
		]);
	});

	it("does not publish pod-template-deleted when missing", async () => {
		await service.deletePodTemplate("does-not-exist");
		expect(bus.events).toEqual([]);
	});

	it("publishes volume lifecycle events", async () => {
		const created = await service.createVolume({
			datacenter: "EU-RO-1",
			name: "extra",
			runpodVolumeId: "xyz789",
			sizeGb: 90,
		});
		await service.updateVolume(created.id, { name: "renamed" });
		await service.deleteVolume(created.id);
		expect(bus.events).toEqual([
			{ kind: "volume-created", resourceId: created.id },
			{ kind: "volume-updated", resourceId: created.id },
			{ kind: "volume-deleted", resourceId: created.id },
		]);
	});

	it("does not publish for read-only methods", async () => {
		await service.listPodTemplates({});
		await service.listVolumes();
		await service.getPodTemplate(baseTemplate.id);
		await service.getVolume(baseVolume.id);
		expect(bus.events).toEqual([]);
	});
});

describe("RunpodAdminService without bus", () => {
	it("works as no-op (no errors, no publish)", async () => {
		const service = createRunpodAdminService({
			podTemplates: createInMemoryTemplates(),
			volumes: createInMemoryVolumes(),
		});
		await expect(
			service.createPodTemplate({
				mode: "pod",
				name: "new",
				runpodTemplateId: "p4f6rm9tb4",
				workflowKey: "ltx-2-3-video",
			})
		).resolves.toMatchObject({ name: "new" });
	});
});
