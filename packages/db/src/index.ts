import { getDatabaseUrl } from "@generator/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import {
	assetRelease,
	assetReleaseGroupEnum,
	assetReleaseItem,
	assetReleaseItemRelations,
	assetReleaseRelations,
	assetReleaseStatusEnum,
	volumeDistributionJob,
	volumeDistributionJobRelations,
	volumeDistributionStatusEnum,
} from "./schema/assets";
import {
	account,
	accountRelations,
	session,
	sessionRelations,
	user,
	userRelations,
	verification,
} from "./schema/auth";
import {
	generatorExecution,
	generatorExecutionStatusEnum,
} from "./schema/generator";
import { lora, loraStatusEnum } from "./schema/loras";
import {
	person,
	personGeneration,
	personGenerationMediaTypeEnum,
	personGenerationRelations,
	personGenerationStatusEnum,
	personRelations,
} from "./schema/persons";
import {
	studioArtifact,
	studioArtifactRelations,
	studioRun,
	studioRunRelations,
	studioRunStatusEnum,
	studioScenario,
	studioScenarioRelations,
} from "./schema/studio";

const schema = {
	account,
	accountRelations,
	assetRelease,
	assetReleaseGroupEnum,
	assetReleaseItem,
	assetReleaseItemRelations,
	assetReleaseRelations,
	assetReleaseStatusEnum,
	generatorExecution,
	generatorExecutionStatusEnum,
	lora,
	loraStatusEnum,
	person,
	personGeneration,
	personGenerationMediaTypeEnum,
	personGenerationRelations,
	personGenerationStatusEnum,
	personRelations,
	session,
	sessionRelations,
	studioArtifact,
	studioArtifactRelations,
	studioRun,
	studioRunRelations,
	studioRunStatusEnum,
	studioScenario,
	studioScenarioRelations,
	user,
	userRelations,
	verification,
	volumeDistributionJob,
	volumeDistributionJobRelations,
	volumeDistributionStatusEnum,
};

export function createDb(connectionString: string) {
	return drizzle(connectionString, { schema });
}

type Database = ReturnType<typeof createDb>;

let cachedDb: Database | null = null;

function getDb() {
	if (!cachedDb) {
		cachedDb = createDb(getDatabaseUrl());
	}
	return cachedDb;
}

export const db = new Proxy({} as Database, {
	get(_, property) {
		return getDb()[property as keyof Database];
	},
});
