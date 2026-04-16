import { createDb } from "@generator/db";
import { eq } from "@generator/db/operators";
import { generatorExecution } from "@generator/db/schema/generator";
import { env } from "@generator/env/server";

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
		params: record.params ?? {},
		providerEndpointId: record.providerEndpointId,
		providerJobId: record.providerJobId,
	};
}

export function createDrizzleExecutionRepository(
	database: GeneratorDatabase = createDb(env.DATABASE_URL)
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
