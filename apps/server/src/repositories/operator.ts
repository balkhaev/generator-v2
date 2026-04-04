import { and, desc, eq } from "drizzle-orm";

import { db } from "@generator/db";
import { artifact, scenario, scenarioRun } from "@generator/db/schema";

import { type ArtifactRecord, type OperatorRepository, type RunRecord, type ScenarioRecord } from "@/domain/operator";

function mapScenario(record: typeof scenario.$inferSelect): ScenarioRecord {
  return {
    ...record,
    params: record.params ?? {},
  };
}

function mapArtifact(record: typeof artifact.$inferSelect): ArtifactRecord {
  return {
    ...record,
    metadata: record.metadata ?? {},
  };
}

function mapRun(
  record: typeof scenarioRun.$inferSelect,
  artifacts: ArtifactRecord[] = [],
): RunRecord {
  return {
    ...record,
    providerJobId: record.providerJobId,
    errorSummary: record.errorSummary,
    completedAt: record.completedAt,
    artifacts,
  };
}

export function createDrizzleOperatorRepository(database = db): OperatorRepository {
  return {
    async listScenarios() {
      const rows = await database.select().from(scenario).orderBy(desc(scenario.updatedAt));
      return rows.map(mapScenario);
    },
    async getScenarioById(scenarioId) {
      const [row] = await database.select().from(scenario).where(eq(scenario.id, scenarioId));
      return row ? mapScenario(row) : null;
    },
    async createScenario(input) {
      const [row] = await database.insert(scenario).values(input).returning();
      return mapScenario(row);
    },
    async updateScenario(scenarioId, input) {
      const [row] = await database
        .update(scenario)
        .set(input)
        .where(eq(scenario.id, scenarioId))
        .returning();
      return row ? mapScenario(row) : null;
    },
    async deleteScenario(scenarioId) {
      const deleted = await database.delete(scenario).where(eq(scenario.id, scenarioId)).returning({ id: scenario.id });
      return deleted.length > 0;
    },
    async listRuns() {
      const rows = await database.select().from(scenarioRun).orderBy(desc(scenarioRun.createdAt));
      const artifacts = await database.select().from(artifact);
      return rows.map((row) =>
        mapRun(
          row,
          artifacts.filter((item) => item.runId === row.id).map(mapArtifact),
        ),
      );
    },
    async getRunById(runId) {
      const [row] = await database.select().from(scenarioRun).where(eq(scenarioRun.id, runId));
      if (!row) {
        return null;
      }
      const artifactRows = await database.select().from(artifact).where(eq(artifact.runId, runId));
      return mapRun(row, artifactRows.map(mapArtifact));
    },
    async createRun(input) {
      const [row] = await database.insert(scenarioRun).values(input).returning();
      return mapRun(row, []);
    },
    async updateRun(runId, input) {
      const [row] = await database
        .update(scenarioRun)
        .set(input)
        .where(eq(scenarioRun.id, runId))
        .returning();
      if (!row) {
        return null;
      }
      const artifactRows = await database.select().from(artifact).where(eq(artifact.runId, runId));
      return mapRun(row, artifactRows.map(mapArtifact));
    },
    async replaceArtifacts(runId, artifactsToInsert) {
      await database.delete(artifact).where(eq(artifact.runId, runId));
      if (artifactsToInsert.length === 0) {
        return [];
      }
      const rows = await database.insert(artifact).values(artifactsToInsert).returning();
      return rows.map(mapArtifact);
    },
  };
}
