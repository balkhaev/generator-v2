import type {
	CreateRunpodNetworkVolumeInput,
	CreateRunpodPodTemplateInput,
	ListRunpodPodTemplatesQuery,
	RunpodNetworkVolume,
	RunpodPodTemplate,
	RunpodPodTemplateVolumeRef,
	RunpodTemplateMode,
	UpdateRunpodNetworkVolumeInput,
	UpdateRunpodPodTemplateInput,
} from "@generator/contracts/runpod-admin";
import { db } from "@generator/db";
import { and, asc, desc, eq, inArray } from "@generator/db/operators";
import {
	runpodNetworkVolume,
	runpodPodTemplate,
	runpodPodTemplateVolume,
} from "@generator/db/schema/runpod";

type Db = typeof db;
type NetworkVolumeRow = typeof runpodNetworkVolume.$inferSelect;
type PodTemplateRow = typeof runpodPodTemplate.$inferSelect;
type PodTemplateVolumeRow = typeof runpodPodTemplateVolume.$inferSelect;

function mapNetworkVolume(row: NetworkVolumeRow): RunpodNetworkVolume {
	return {
		createdAt: row.createdAt.toISOString(),
		datacenter: row.datacenter,
		description: row.description,
		gpuTypeIds: row.gpuTypeIds,
		id: row.id,
		name: row.name,
		runpodVolumeId: row.runpodVolumeId,
		sizeGb: row.sizeGb,
		updatedAt: row.updatedAt.toISOString(),
	};
}

function mapPodTemplate(
	row: PodTemplateRow,
	volumes: RunpodPodTemplateVolumeRef[]
): RunpodPodTemplate {
	return {
		cloudType: row.cloudType,
		containerDiskInGb: row.containerDiskInGb,
		createdAt: row.createdAt.toISOString(),
		defaultEnv: row.defaultEnv,
		description: row.description,
		enabled: row.enabled === "true",
		gpuTypeIds: row.gpuTypeIds,
		id: row.id,
		imageName: row.imageName,
		keepAliveMs: row.keepAliveMs,
		mode: row.mode as RunpodTemplateMode,
		name: row.name,
		runpodEndpointId: row.runpodEndpointId,
		runpodTemplateId: row.runpodTemplateId,
		timeoutMs: row.timeoutMs,
		updatedAt: row.updatedAt.toISOString(),
		volumeInGb: row.volumeInGb,
		volumes,
		workflowKey: row.workflowKey,
	};
}

async function loadVolumesForTemplates(
	database: Db,
	podTemplateIds: string[]
): Promise<Map<string, RunpodPodTemplateVolumeRef[]>> {
	if (podTemplateIds.length === 0) {
		return new Map();
	}
	const rows = await database
		.select({
			datacenter: runpodNetworkVolume.datacenter,
			description: runpodNetworkVolume.description,
			gpuTypeIds: runpodNetworkVolume.gpuTypeIds,
			id: runpodNetworkVolume.id,
			name: runpodNetworkVolume.name,
			podTemplateId: runpodPodTemplateVolume.podTemplateId,
			priority: runpodPodTemplateVolume.priority,
			runpodVolumeId: runpodNetworkVolume.runpodVolumeId,
			sizeGb: runpodNetworkVolume.sizeGb,
			volumeCreatedAt: runpodNetworkVolume.createdAt,
			volumeUpdatedAt: runpodNetworkVolume.updatedAt,
		})
		.from(runpodPodTemplateVolume)
		.innerJoin(
			runpodNetworkVolume,
			eq(runpodNetworkVolume.id, runpodPodTemplateVolume.volumeId)
		)
		.where(inArray(runpodPodTemplateVolume.podTemplateId, podTemplateIds))
		.orderBy(asc(runpodPodTemplateVolume.priority));

	const grouped = new Map<string, RunpodPodTemplateVolumeRef[]>();
	for (const row of rows) {
		const ref: RunpodPodTemplateVolumeRef = {
			priority: row.priority,
			volume: {
				createdAt: row.volumeCreatedAt.toISOString(),
				datacenter: row.datacenter,
				description: row.description,
				gpuTypeIds: row.gpuTypeIds,
				id: row.id,
				name: row.name,
				runpodVolumeId: row.runpodVolumeId,
				sizeGb: row.sizeGb,
				updatedAt: row.volumeUpdatedAt.toISOString(),
			},
		};
		const bucket = grouped.get(row.podTemplateId);
		if (bucket) {
			bucket.push(ref);
		} else {
			grouped.set(row.podTemplateId, [ref]);
		}
	}
	return grouped;
}

export interface RunpodNetworkVolumeRepository {
	create(input: CreateRunpodNetworkVolumeInput): Promise<RunpodNetworkVolume>;
	delete(id: string): Promise<RunpodNetworkVolume | null>;
	getById(id: string): Promise<RunpodNetworkVolume | null>;
	list(): Promise<RunpodNetworkVolume[]>;
	update(
		id: string,
		patch: UpdateRunpodNetworkVolumeInput
	): Promise<RunpodNetworkVolume | null>;
}

export interface RunpodPodTemplateRepository {
	assignVolumes(
		podTemplateId: string,
		assignments: { priority: number; volumeId: string }[]
	): Promise<RunpodPodTemplate | null>;
	create(input: CreateRunpodPodTemplateInput): Promise<RunpodPodTemplate>;
	delete(id: string): Promise<RunpodPodTemplate | null>;
	getById(id: string): Promise<RunpodPodTemplate | null>;
	list(query: ListRunpodPodTemplatesQuery): Promise<RunpodPodTemplate[]>;
	update(
		id: string,
		patch: UpdateRunpodPodTemplateInput
	): Promise<RunpodPodTemplate | null>;
}

function generateId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

export function createDrizzleRunpodNetworkVolumeRepository(
	database: Db = db
): RunpodNetworkVolumeRepository {
	return {
		async create(input) {
			const [row] = await database
				.insert(runpodNetworkVolume)
				.values({
					datacenter: input.datacenter,
					description: input.description ?? "",
					gpuTypeIds: input.gpuTypeIds ?? [],
					id: generateId("runpod_vol"),
					name: input.name,
					runpodVolumeId: input.runpodVolumeId,
					sizeGb: input.sizeGb ?? 0,
				})
				.returning();
			if (!row) {
				throw new Error("Failed to create RunPod network volume");
			}
			return mapNetworkVolume(row);
		},
		async delete(id) {
			const [row] = await database
				.delete(runpodNetworkVolume)
				.where(eq(runpodNetworkVolume.id, id))
				.returning();
			return row ? mapNetworkVolume(row) : null;
		},
		async getById(id) {
			const rows = await database
				.select()
				.from(runpodNetworkVolume)
				.where(eq(runpodNetworkVolume.id, id))
				.limit(1);
			return rows[0] ? mapNetworkVolume(rows[0]) : null;
		},
		async list() {
			const rows = await database
				.select()
				.from(runpodNetworkVolume)
				.orderBy(desc(runpodNetworkVolume.createdAt));
			return rows.map(mapNetworkVolume);
		},
		async update(id, patch) {
			const updates: Partial<NetworkVolumeRow> = {};
			if (patch.name !== undefined) {
				updates.name = patch.name;
			}
			if (patch.runpodVolumeId !== undefined) {
				updates.runpodVolumeId = patch.runpodVolumeId;
			}
			if (patch.datacenter !== undefined) {
				updates.datacenter = patch.datacenter;
			}
			if (patch.sizeGb !== undefined) {
				updates.sizeGb = patch.sizeGb;
			}
			if (patch.gpuTypeIds !== undefined) {
				updates.gpuTypeIds = patch.gpuTypeIds;
			}
			if (patch.description !== undefined) {
				updates.description = patch.description;
			}
			if (Object.keys(updates).length === 0) {
				return this.getById(id);
			}
			const [row] = await database
				.update(runpodNetworkVolume)
				.set(updates)
				.where(eq(runpodNetworkVolume.id, id))
				.returning();
			return row ? mapNetworkVolume(row) : null;
		},
	};
}

function buildPodTemplateUpdates(
	patch: UpdateRunpodPodTemplateInput
): Partial<PodTemplateRow> {
	const updates: Partial<PodTemplateRow> = {};
	const stringFields: Array<keyof UpdateRunpodPodTemplateInput> = [
		"name",
		"workflowKey",
	];
	for (const key of stringFields) {
		const value = patch[key];
		if (typeof value === "string") {
			(updates as Record<string, unknown>)[key] = value;
		}
	}
	const nullableStringFields: Array<keyof UpdateRunpodPodTemplateInput> = [
		"runpodTemplateId",
		"runpodEndpointId",
		"imageName",
		"cloudType",
	];
	for (const key of nullableStringFields) {
		const value = patch[key];
		if (value !== undefined) {
			(updates as Record<string, unknown>)[key] = value;
		}
	}
	const nullableNumberFields: Array<keyof UpdateRunpodPodTemplateInput> = [
		"containerDiskInGb",
		"volumeInGb",
		"keepAliveMs",
		"timeoutMs",
	];
	for (const key of nullableNumberFields) {
		const value = patch[key];
		if (value !== undefined) {
			(updates as Record<string, unknown>)[key] = value;
		}
	}
	if (patch.gpuTypeIds !== undefined) {
		updates.gpuTypeIds = patch.gpuTypeIds;
	}
	if (patch.defaultEnv !== undefined) {
		updates.defaultEnv = patch.defaultEnv;
	}
	if (patch.description !== undefined) {
		updates.description = patch.description;
	}
	if (patch.enabled !== undefined) {
		updates.enabled = patch.enabled ? "true" : "false";
	}
	return updates;
}

export function createDrizzleRunpodPodTemplateRepository(
	database: Db = db
): RunpodPodTemplateRepository {
	const loadOne = async (id: string): Promise<RunpodPodTemplate | null> => {
		const rows = await database
			.select()
			.from(runpodPodTemplate)
			.where(eq(runpodPodTemplate.id, id))
			.limit(1);
		const row = rows[0];
		if (!row) {
			return null;
		}
		const volumes = await loadVolumesForTemplates(database, [id]);
		return mapPodTemplate(row, volumes.get(id) ?? []);
	};

	const writeAssignments = async (
		podTemplateId: string,
		assignments: { priority: number; volumeId: string }[]
	): Promise<void> => {
		await database
			.delete(runpodPodTemplateVolume)
			.where(eq(runpodPodTemplateVolume.podTemplateId, podTemplateId));
		if (assignments.length === 0) {
			return;
		}
		const seen = new Set<string>();
		const rows: PodTemplateVolumeRow[] = [];
		for (const item of assignments) {
			if (seen.has(item.volumeId)) {
				continue;
			}
			seen.add(item.volumeId);
			rows.push({
				podTemplateId,
				priority: item.priority,
				volumeId: item.volumeId,
			});
		}
		await database.insert(runpodPodTemplateVolume).values(rows);
	};

	return {
		async assignVolumes(podTemplateId, assignments) {
			const existing = await loadOne(podTemplateId);
			if (!existing) {
				return null;
			}
			await writeAssignments(podTemplateId, assignments);
			return loadOne(podTemplateId);
		},
		async create(input) {
			const id = generateId("runpod_tpl");
			const [row] = await database
				.insert(runpodPodTemplate)
				.values({
					cloudType: input.cloudType ?? null,
					containerDiskInGb: input.containerDiskInGb ?? null,
					defaultEnv: input.defaultEnv ?? {},
					description: input.description ?? "",
					enabled: input.enabled === false ? "false" : "true",
					gpuTypeIds: input.gpuTypeIds ?? [],
					id,
					imageName: input.imageName ?? null,
					keepAliveMs: input.keepAliveMs ?? null,
					mode: input.mode,
					name: input.name,
					runpodEndpointId: input.runpodEndpointId ?? null,
					runpodTemplateId: input.runpodTemplateId ?? null,
					timeoutMs: input.timeoutMs ?? null,
					volumeInGb: input.volumeInGb ?? null,
					workflowKey: input.workflowKey,
				})
				.returning();
			if (!row) {
				throw new Error("Failed to create RunPod pod template");
			}
			if (input.volumes && input.volumes.length > 0) {
				await writeAssignments(id, input.volumes);
			}
			const result = await loadOne(id);
			if (!result) {
				throw new Error("Failed to read back RunPod pod template");
			}
			return result;
		},
		async delete(id) {
			const before = await loadOne(id);
			if (!before) {
				return null;
			}
			await database
				.delete(runpodPodTemplate)
				.where(eq(runpodPodTemplate.id, id));
			return before;
		},
		getById(id) {
			return loadOne(id);
		},
		async list(query) {
			const filters = [] as ReturnType<typeof eq>[];
			if (query.mode !== undefined) {
				filters.push(eq(runpodPodTemplate.mode, query.mode));
			}
			if (query.workflowKey !== undefined) {
				filters.push(eq(runpodPodTemplate.workflowKey, query.workflowKey));
			}
			if (query.enabled !== undefined) {
				filters.push(
					eq(runpodPodTemplate.enabled, query.enabled ? "true" : "false")
				);
			}
			const baseQuery = database
				.select()
				.from(runpodPodTemplate)
				.orderBy(desc(runpodPodTemplate.createdAt));
			const rows =
				filters.length > 0
					? await baseQuery.where(and(...filters))
					: await baseQuery;
			if (rows.length === 0) {
				return [];
			}
			const volumes = await loadVolumesForTemplates(
				database,
				rows.map((row) => row.id)
			);
			return rows.map((row) => mapPodTemplate(row, volumes.get(row.id) ?? []));
		},
		async update(id, patch) {
			const updates = buildPodTemplateUpdates(patch);
			if (Object.keys(updates).length > 0) {
				const [updated] = await database
					.update(runpodPodTemplate)
					.set(updates)
					.where(eq(runpodPodTemplate.id, id))
					.returning({ id: runpodPodTemplate.id });
				if (!updated) {
					return null;
				}
			}
			if (patch.volumes !== undefined) {
				await writeAssignments(id, patch.volumes);
			}
			return loadOne(id);
		},
	};
}
