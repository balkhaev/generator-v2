import { createDb } from "@generator/db";
import { and, eq, inArray, isNotNull } from "@generator/db/operators";
import { generatorExecution } from "@generator/db/schema/generator";
import { getDatabaseUrl } from "@generator/env/server";

import type { ExecutionEntity, ExecutionRepository } from "@/domain/executions";

type GeneratorDatabase = ReturnType<typeof createDb>;

function mapExecution(
	record: typeof generatorExecution.$inferSelect
): ExecutionEntity {
	return {
		...record,
		artifacts: record.artifacts ?? [],
		callback: record.callback ?? null,
		errorSummary: record.errorSummary,
		inputImageUrl: record.inputImageUrl,
		lastLogLine: record.lastLogLine ?? null,
		params: record.params ?? {},
		progressPct: record.progressPct ?? null,
		providerEndpointId: record.providerEndpointId,
		providerJobId: record.providerJobId,
		queuePosition: record.queuePosition ?? null,
	};
}

export function createDrizzleExecutionRepository(
	database: GeneratorDatabase = createDb(getDatabaseUrl())
): ExecutionRepository {
	return {
		async createExecution(input) {
			const [row] = await database
				.insert(generatorExecution)
				.values(input)
				.returning();
			if (!row) {
				throw new Error("Failed to create generator execution");
			}
			return mapExecution(row);
		},
		async getExecutionById(executionId) {
			const [row] = await database
				.select()
				.from(generatorExecution)
				.where(eq(generatorExecution.id, executionId));
			return row ? mapExecution(row) : null;
		},
		async listActiveExecutionsForStream() {
			const rows = await database
				.select()
				.from(generatorExecution)
				.where(
					and(
						inArray(generatorExecution.status, ["queued", "running"]),
						isNotNull(generatorExecution.providerJobId)
					)
				);
			return rows.map(mapExecution);
		},
		async updateExecution(executionId, input) {
			const [row] = await database
				.update(generatorExecution)
				.set(input)
				.where(eq(generatorExecution.id, executionId))
				.returning();
			return row ? mapExecution(row) : null;
		},
	};
}
