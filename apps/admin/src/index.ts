import {
	ensureDevUser,
	getRequestSession,
	handleAuthRequest,
	isInitialAdminSetupRequired,
} from "@generator/auth";
import {
	env,
	getGeneratorApiUrl,
	getRequiredCorsOrigins,
	getStudioApiUrl,
	normalizeS3RuntimeEnv,
} from "@generator/env/server";
import { createApp } from "@/app";
import { getAdminDashboardSnapshot } from "@/dashboard";
import { AssetReleasePresetService } from "@/domain/asset-release-presets";
import type { AssetStorage } from "@/domain/asset-releases";
import { AssetReleaseService } from "@/domain/asset-releases";
import { LoraRegistryService } from "@/domain/loras";
import { PersonLoraTrainingControlService } from "@/domain/person-lora-training-control";
import { createPersonLoraTrainingQueueClient } from "@/queue/person-lora-training";
import { createDrizzleAssetReleaseRepository } from "@/repositories/asset-releases";
import { createDrizzleLoraRepository } from "@/repositories/loras";

const generatorBaseUrl = getGeneratorApiUrl();
const personsApiBaseUrl = env.PERSONS_API_URL;
const redisUrl = env.REDIS_URL;
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

const trailingSlashesPattern = /\/+$/u;
const s3Env = normalizeS3RuntimeEnv(process.env);
const s3Bucket = s3Env.S3_BUCKET?.trim();
const s3Endpoint = s3Env.S3_ENDPOINT;
const s3AccessKey = s3Env.S3_ACCESS_KEY_ID?.trim();
const s3SecretKey = s3Env.S3_SECRET_ACCESS_KEY?.trim();
const s3Config =
	s3Bucket && s3Endpoint && s3AccessKey && s3SecretKey
		? {
				bucket: s3Bucket,
				endpoint: s3Endpoint,
				accessKey: s3AccessKey,
				secretKey: s3SecretKey,
				region: s3Env.S3_REGION?.trim() ?? "us-east-1",
				publicUrl:
					s3Env.S3_PUBLIC_URL?.trim() ??
					`${s3Endpoint.replace(trailingSlashesPattern, "")}/${s3Bucket}`,
			}
		: undefined;

const loraRegistryService = new LoraRegistryService({
	repository: createDrizzleLoraRepository(),
	s3Config,
});

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
	loraRegistryService,
	s3Config,
	studioBaseUrl,
});

ensureDevUser();

export default {
	maxRequestBodySize: 3_000_000_000,
	port: Number(process.env.PORT ?? 3000),
	fetch: app.fetch,
};
