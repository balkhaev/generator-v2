import type { ScenarioParamValue } from "@generator/contracts/generator";
import { db } from "@generator/db";
import {
	studioArtifact,
	studioRun,
	studioScenario,
} from "@generator/db/schema/studio";
import { desc, eq, inArray } from "drizzle-orm";

import type {
	StudioArtifactEntity,
	StudioRepository,
	StudioRunEntity,
	StudioScenarioEntity,
} from "@/domain/studio";

type StudioDatabase = typeof db;

function mapScenario(
	record: typeof studioScenario.$inferSelect
): StudioScenarioEntity {
	return {
		...record,
		generatorScenarioId: record.generatorScenarioId,
		params: (record.params ?? {}) as Record<string, ScenarioParamValue>,
	};
}

function mapArtifact(
	record: typeof studioArtifact.$inferSelect
): StudioArtifactEntity {
	return {
		...record,
		metadata: record.metadata ?? {},
	};
}

function mapRun(
	record: typeof studioRun.$inferSelect,
	artifacts: StudioArtifactEntity[] = []
): StudioRunEntity {
	return {
		...record,
		artifacts,
		completedAt: record.completedAt,
		errorSummary: record.errorSummary,
		generatorRunId: record.generatorRunId,
		providerEndpointId: record.providerEndpointId,
		providerJobId: record.providerJobId,
	};
}

export function createDrizzleStudioRepository(
	database: StudioDatabase = db
): StudioRepository {
	return {
		async createRun(input) {
			const [row] = await database.insert(studioRun).values(input).returning();
			if (!row) {
				throw new Error("Failed to create studio run.");
			}
			return mapRun(row, []);
		},
		async createScenario(input) {
			const [row] = await database
				.insert(studioScenario)
				.values(input)
				.returning();
			if (!row) {
				throw new Error("Failed to create studio scenario.");
			}
			return mapScenario(row);
		},
		async deleteScenario(scenarioId) {
			const deleted = await database
				.delete(studioScenario)
				.where(eq(studioScenario.id, scenarioId))
				.returning({ id: studioScenario.id });
			return deleted.length > 0;
		},
		async getRunByGeneratorRunId(generatorRunId) {
			const [row] = await database
				.select()
				.from(studioRun)
				.where(eq(studioRun.generatorRunId, generatorRunId));
			if (!row) {
				return null;
			}
			const artifactRows = await database
				.select()
				.from(studioArtifact)
				.where(eq(studioArtifact.runId, row.id));
			return mapRun(row, artifactRows.map(mapArtifact));
		},
		async getRunById(runId) {
			const [row] = await database
				.select()
				.from(studioRun)
				.where(eq(studioRun.id, runId));
			if (!row) {
				return null;
			}
			const artifactRows = await database
				.select()
				.from(studioArtifact)
				.where(eq(studioArtifact.runId, runId));
			return mapRun(row, artifactRows.map(mapArtifact));
		},
		async listActiveRuns(limit) {
			const rows = await database
				.select()
				.from(studioRun)
				.where(inArray(studioRun.status, ["queued", "running"]))
				.orderBy(desc(studioRun.updatedAt))
				.limit(limit);
			const artifacts = await database.select().from(studioArtifact);
			return rows.map((row) =>
				mapRun(
					row,
					artifacts
						.filter((artifactRow) => artifactRow.runId === row.id)
						.map(mapArtifact)
				)
			);
		},
		async getScenarioByGeneratorScenarioId(generatorScenarioId) {
			const [row] = await database
				.select()
				.from(studioScenario)
				.where(eq(studioScenario.generatorScenarioId, generatorScenarioId));
			return row ? mapScenario(row) : null;
		},
		async getScenarioById(scenarioId) {
			const [row] = await database
				.select()
				.from(studioScenario)
				.where(eq(studioScenario.id, scenarioId));
			return row ? mapScenario(row) : null;
		},
		async listRuns() {
			const rows = await database
				.select()
				.from(studioRun)
				.orderBy(desc(studioRun.createdAt));
			const artifacts = await database.select().from(studioArtifact);
			return rows.map((row) =>
				mapRun(
					row,
					artifacts
						.filter((artifactRow) => artifactRow.runId === row.id)
						.map(mapArtifact)
				)
			);
		},
		async listScenarios() {
			const rows = await database
				.select()
				.from(studioScenario)
				.orderBy(desc(studioScenario.updatedAt));
			return rows.map(mapScenario);
		},
		async replaceArtifacts(runId, artifactsToInsert) {
			await database
				.delete(studioArtifact)
				.where(eq(studioArtifact.runId, runId));
			if (artifactsToInsert.length === 0) {
				return [];
			}
			const rows = await database
				.insert(studioArtifact)
				.values(artifactsToInsert)
				.returning();
			return rows.map(mapArtifact);
		},
		async updateRun(runId, input) {
			const [row] = await database
				.update(studioRun)
				.set(input)
				.where(eq(studioRun.id, runId))
				.returning();
			if (!row) {
				return null;
			}
			const artifactRows = await database
				.select()
				.from(studioArtifact)
				.where(eq(studioArtifact.runId, runId));
			return mapRun(row, artifactRows.map(mapArtifact));
		},
		async updateScenario(scenarioId, input) {
			const [row] = await database
				.update(studioScenario)
				.set(input)
				.where(eq(studioScenario.id, scenarioId))
				.returning();
			return row ? mapScenario(row) : null;
		},
	};
}
