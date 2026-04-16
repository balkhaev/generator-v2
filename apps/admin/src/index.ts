import {
	ensureDevUser,
	getRequestSession,
	handleAuthRequest,
	isInitialAdminSetupRequired,
} from "@generator/auth";
import {
	getGeneratorApiUrl,
	getRequiredCorsOrigins,
	getStudioApiUrl,
} from "@generator/env/server";
import { createApp } from "@/app";
import { getAdminDashboardSnapshot } from "@/dashboard";
import { AssetReleasePresetService } from "@/domain/asset-release-presets";
import type { AssetStorage } from "@/domain/asset-releases";
import { AssetReleaseService } from "@/domain/asset-releases";
import { PersonLoraTrainingControlService } from "@/domain/person-lora-training-control";
import { createPersonLoraTrainingQueueClient } from "@/queue/person-lora-training";
import { createDrizzleAssetReleaseRepository } from "@/repositories/asset-releases";

const generatorBaseUrl = getGeneratorApiUrl();
const personsApiBaseUrl = process.env.PERSONS_API_URL;
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const studioBaseUrl = getStudioApiUrl();
const internalTrainingControlService = new PersonLoraTrainingControlService(
	createPersonLoraTrainingQueueClient(redisUrl)
);

const noopStorage: AssetStorage = {
	readJson() {
		return Promise.resolve(null);
	},
	async writeJson() {
		await Promise.resolve();
	},
	async writeObject() {
		await Promise.resolve();
	},
};

const assetReleaseRepository = createDrizzleAssetReleaseRepository();
const assetReleaseService = new AssetReleaseService(
	assetReleaseRepository,
	noopStorage,
	{ launchJob: async () => ({ podId: "noop" }) },
	"local",
	[]
);
const assetReleasePresetService = new AssetReleasePresetService(
	assetReleaseService
);

const app = createApp({
	assetReleasePresetService,
	assetReleaseService,
	authHandler: handleAuthRequest,
	corsOrigins: getRequiredCorsOrigins(),
	generatorBaseUrl,
	internalTrainingControlService,
	getSession: getRequestSession,
	loadDashboardSnapshot: () =>
		getAdminDashboardSnapshot(studioBaseUrl, personsApiBaseUrl),
	loadSetupStatus: async () => ({
		setupRequired: await isInitialAdminSetupRequired(),
	}),
	loggerImpl: console,
	studioBaseUrl,
});

ensureDevUser();

export default {
	maxRequestBodySize: 3_000_000_000,
	port: Number(process.env.PORT ?? 3000),
	fetch: app.fetch,
};
