import { createDb } from "@generator/db";
import { and, desc, eq } from "@generator/db/operators";
import { person, personGeneration } from "@generator/db/schema/persons";
import { getDatabaseUrl } from "@generator/env/server";

import type {
	PersonGenerationRecord,
	PersonRecord,
	PersonsRepository,
} from "@/domain/persons";

type PersonsDatabase = ReturnType<typeof createDb>;

function mapGeneration(
	record: typeof personGeneration.$inferSelect
): PersonGenerationRecord {
	return {
		...record,
		errorSummary: record.errorSummary,
		operatorRunId: record.operatorRunId,
		operatorScenarioId: record.operatorScenarioId,
		previewUrl: record.previewUrl,
		metadata: record.metadata ?? {},
	};
}

function mapPerson(
	record: typeof person.$inferSelect,
	generations: PersonGenerationRecord[] = []
): PersonRecord {
	return {
		...record,
		datasetUrl: record.datasetUrl,
		loraUrl: record.loraUrl,
		photoUrl: record.photoUrl,
		videoUrl: record.videoUrl,
		voiceWavUrl: record.voiceWavUrl,
		metadata: record.metadata ?? {},
		generations,
	};
}

function groupGenerationsByPerson(
	generationRows: (typeof personGeneration.$inferSelect)[]
) {
	const groupedGenerations = new Map<string, PersonGenerationRecord[]>();

	for (const generationRow of generationRows) {
		const list = groupedGenerations.get(generationRow.personId) ?? [];
		list.push(mapGeneration(generationRow));
		groupedGenerations.set(generationRow.personId, list);
	}

	return groupedGenerations;
}

export function createDrizzlePersonsRepository(
	database: PersonsDatabase = createDb(getDatabaseUrl())
): PersonsRepository {
	return {
		async listPersons() {
			const personRows = await database
				.select()
				.from(person)
				.orderBy(desc(person.updatedAt));
			const generationRows = await database
				.select()
				.from(personGeneration)
				.orderBy(desc(personGeneration.createdAt), desc(personGeneration.id));
			const groupedGenerations = groupGenerationsByPerson(generationRows);

			return personRows.map((personRow) =>
				mapPerson(personRow, groupedGenerations.get(personRow.id) ?? [])
			);
		},
		async getPersonById(personId) {
			const [personRow] = await database
				.select()
				.from(person)
				.where(eq(person.id, personId));
			if (!personRow) {
				return null;
			}

			const generationRows = await database
				.select()
				.from(personGeneration)
				.where(eq(personGeneration.personId, personId))
				.orderBy(desc(personGeneration.createdAt), desc(personGeneration.id));
			return mapPerson(personRow, generationRows.map(mapGeneration));
		},
		async getPersonBySlug(slug) {
			const [personRow] = await database
				.select()
				.from(person)
				.where(eq(person.slug, slug));
			if (!personRow) {
				return null;
			}

			const generationRows = await database
				.select()
				.from(personGeneration)
				.where(eq(personGeneration.personId, personRow.id))
				.orderBy(desc(personGeneration.createdAt), desc(personGeneration.id));
			return mapPerson(personRow, generationRows.map(mapGeneration));
		},
		createPerson(input) {
			return database.transaction(async (transaction) => {
				const [personRow] = await transaction
					.insert(person)
					.values(input.person)
					.returning();

				if (!personRow) {
					throw new Error("Failed to create person");
				}

				if (input.generations.length > 0) {
					await transaction.insert(personGeneration).values(
						input.generations.map((generation) => ({
							...generation,
							personId: personRow.id,
						}))
					);
				}

				const generationRows = await transaction
					.select()
					.from(personGeneration)
					.where(eq(personGeneration.personId, personRow.id))
					.orderBy(desc(personGeneration.createdAt), desc(personGeneration.id));

				return mapPerson(personRow, generationRows.map(mapGeneration));
			});
		},
		async updatePerson(personId, input) {
			const [personRow] = await database
				.update(person)
				.set(input)
				.where(eq(person.id, personId))
				.returning();
			if (!personRow) {
				return null;
			}

			const generationRows = await database
				.select()
				.from(personGeneration)
				.where(eq(personGeneration.personId, personId))
				.orderBy(desc(personGeneration.createdAt), desc(personGeneration.id));
			return mapPerson(personRow, generationRows.map(mapGeneration));
		},
		async deletePerson(personId) {
			const deletedRows = await database
				.delete(person)
				.where(eq(person.id, personId))
				.returning({ id: person.id });
			return deletedRows.length > 0;
		},
		async deleteGeneration(personId, generationId) {
			const [generationRow] = await database
				.delete(personGeneration)
				.where(
					and(
						eq(personGeneration.id, generationId),
						eq(personGeneration.personId, personId)
					)
				)
				.returning();
			return generationRow ? mapGeneration(generationRow) : null;
		},
		async deleteDatasetGenerations(personId, keepSourceUrls) {
			const datasetGenerations = await database
				.select({
					id: personGeneration.id,
					metadata: personGeneration.metadata,
					sourceUrl: personGeneration.sourceUrl,
				})
				.from(personGeneration)
				.where(eq(personGeneration.personId, personId));

			const keepSet = new Set(keepSourceUrls);
			const toDelete = datasetGenerations.filter(
				(row) =>
					row.metadata?.isDatasetPhoto === true &&
					!keepSet.has(row.sourceUrl) &&
					typeof row.id === "string"
			);

			let deletedCount = 0;
			for (const row of toDelete) {
				const [record] = await database
					.delete(personGeneration)
					.where(eq(personGeneration.id, row.id))
					.returning({ id: personGeneration.id });
				if (record) {
					deletedCount += 1;
				}
			}

			return deletedCount;
		},
		async findPersonByOperatorRunId(operatorRunId) {
			const [generationRow] = await database
				.select()
				.from(personGeneration)
				.where(eq(personGeneration.operatorRunId, operatorRunId));

			if (!generationRow) {
				return null;
			}

			return this.getPersonById(generationRow.personId);
		},
		async createGeneration(input) {
			const [generationRow] = await database
				.insert(personGeneration)
				.values(input)
				.returning();
			if (!generationRow) {
				throw new Error("Failed to create generation");
			}

			return mapGeneration(generationRow);
		},
		async updateGeneration(generationId, input) {
			const [generationRow] = await database
				.update(personGeneration)
				.set(input)
				.where(eq(personGeneration.id, generationId))
				.returning();
			return generationRow ? mapGeneration(generationRow) : null;
		},
		async getGenerationByOperatorRunId(operatorRunId) {
			const [generationRow] = await database
				.select()
				.from(personGeneration)
				.where(eq(personGeneration.operatorRunId, operatorRunId));
			return generationRow ? mapGeneration(generationRow) : null;
		},
		async listQueuedGenerations(limit) {
			const rows = await database
				.select()
				.from(personGeneration)
				.where(eq(personGeneration.status, "queued"))
				.orderBy(desc(personGeneration.updatedAt))
				.limit(limit);
			return rows.map(mapGeneration);
		},
	};
}
