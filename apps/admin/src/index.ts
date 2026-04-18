import {
	ensureDevUser,
	getRequestSession,
	handleAuthRequest,
	isInitialAdminSetupRequired,
} from "@generator/auth";
import {
	env,
	getGeneratorApiUrl,
	getKafkaEventBusConfig,
	getRequiredCorsOrigins,
	getStudioApiUrl,
} from "@generator/env/server";
import { createKafkaEventPublisher } from "@generator/events";
import { tryResolveS3StorageConfig } from "@generator/storage";
import { createApp } from "@/app";
import { getAdminDashboardSnapshot } from "@/dashboard";
import { LoraRegistryService } from "@/domain/loras";
import { PersonLoraTrainingControlService } from "@/domain/person-lora-training-control";
import { createRedisPromptEnhanceSettings } from "@/domain/prompt-enhance-settings";
import { resolveTrainingProviderAvailability } from "@/domain/training-provider-availability";
import { createRedisTrainingProviderSettings } from "@/domain/training-provider-settings";
import { UsersService } from "@/domain/users";
import { createRedisWorkerSettingsReader } from "@/domain/worker-settings-store";
import { createLoraSourceResolver } from "@/providers/lora-source-resolver";
import { createPersonLoraTrainingQueueClient } from "@/queue/person-lora-training";
import { createDrizzleLoraRepository } from "@/repositories/loras";
import { createDrizzleUserRepository } from "@/repositories/users";
import {
	createRuntimeConfigSetup,
	seedCredentialsFromEnv,
} from "@/runtime-config/setup";

const generatorBaseUrl = getGeneratorApiUrl();
const personsApiBaseUrl = env.PERSONS_API_URL;
const redisUrl = env.REDIS_URL;
const studioBaseUrl = getStudioApiUrl();
const internalTrainingControlService = new PersonLoraTrainingControlService(
	createPersonLoraTrainingQueueClient(redisUrl)
);

const s3Config = tryResolveS3StorageConfig() ?? undefined;

const trainingProviderSettings = createRedisTrainingProviderSettings({
	defaultProvider: env.TRAINING_PROVIDER,
	redisUrl,
});

const promptEnhanceSettings = createRedisPromptEnhanceSettings({
	defaultOpenRouterModel: env.OPENROUTER_MODEL,
	defaultProvider: env.PROMPT_ENHANCE_PROVIDER,
	redisUrl,
});

/**
 * Reader for the worker's settings heartbeat (see worker-settings-store.ts).
 * Used by `/api/admin/settings` so the UI surfaces the worker's view of
 * provider availability instead of the gateway's empty env.
 */
const workerSettingsReader = createRedisWorkerSettingsReader({ redisUrl });

const kafkaConfig = getKafkaEventBusConfig("admin-api");
const eventPublisher = kafkaConfig
	? createKafkaEventPublisher(kafkaConfig, { source: "admin-api" })
	: undefined;

const loraRegistryService = new LoraRegistryService({
	eventPublisher,
	logger: console,
	repository: createDrizzleLoraRepository(),
	resolveSource: createLoraSourceResolver({
		civitaiApiKey: env.CIVITAI_API_KEY,
		huggingFaceToken: env.HUGGINGFACE_TOKEN,
	}).resolve,
	s3Config,
});

if (eventPublisher) {
	const shutdown = () => {
		eventPublisher.close().catch((error) => {
			console.error("admin.events-publisher.shutdown.error", {
				message: error instanceof Error ? error.message : "unknown",
			});
		});
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

const usersService = new UsersService({
	repository: createDrizzleUserRepository(),
});

const runtimeConfigSetup = env.CONFIG_MASTER_KEY
	? createRuntimeConfigSetup({
			masterKey: env.CONFIG_MASTER_KEY,
			redisUrl,
		})
	: null;

if (runtimeConfigSetup) {
	// Best-effort backfill from env. Non-blocking: store runs against the same
	// Postgres as the rest of admin, so a transient failure here is logged but
	// shouldn't prevent the API from coming up.
	seedCredentialsFromEnv(runtimeConfigSetup.store, {
		credentials: {
			fal: { apiKey: env.FAL_KEY },
			openrouter: { apiKey: env.OPENROUTER_API_KEY },
			runpod: { apiKey: env.RUNPOD_API_KEY },
			xai: { apiKey: env.XAI_API_KEY },
		},
	}).catch((error) => {
		console.warn("admin.runtime-config.seed_failed_outer", {
			message: error instanceof Error ? error.message : String(error),
		});
	});
} else {
	console.warn("admin.runtime-config.disabled", {
		reason:
			"CONFIG_MASTER_KEY is not set; runtime-config admin routes are disabled.",
	});
}

const app = createApp({
	authHandler: handleAuthRequest,
	corsOrigins: getRequiredCorsOrigins(),
	generatorBaseUrl,
	internalControlToken: env.TRAINING_CONTROL_TOKEN,
	internalTrainingControlService,
	getSession: getRequestSession,
	loadDashboardSnapshot: () =>
		getAdminDashboardSnapshot(
			studioBaseUrl,
			personsApiBaseUrl,
			env.TRAINING_CONTROL_TOKEN
		),
	loadSetupStatus: async () => ({
		setupRequired: await isInitialAdminSetupRequired(),
	}),
	loggerImpl: console,
	loraRegistryService,
	s3Config,
	studioBaseUrl,
	adminSettingsEnvResolver: {
		resolve: () => ({
			PERSONS_DEFAULT_AVATAR_WORKFLOW: env.PERSONS_DEFAULT_AVATAR_WORKFLOW,
			PERSONS_DEFAULT_LORA_WORKFLOW: env.PERSONS_DEFAULT_LORA_WORKFLOW,
			RECONCILE_INTERVAL_MS: env.RECONCILE_INTERVAL_MS,
			RECONCILE_WATCH: env.RECONCILE_WATCH,
			RUNPOD_AI_TOOLKIT_BASE_MODEL: env.RUNPOD_AI_TOOLKIT_BASE_MODEL,
			RUNPOD_AI_TOOLKIT_ENDPOINT_ID: env.RUNPOD_AI_TOOLKIT_ENDPOINT_ID,
			RUNPOD_AI_TOOLKIT_POLL_MS: env.RUNPOD_AI_TOOLKIT_POLL_MS,
			RUNPOD_AI_TOOLKIT_TIMEOUT_MS: env.RUNPOD_AI_TOOLKIT_TIMEOUT_MS,
			RUNPOD_POD_BOOTSTRAP_URL: env.RUNPOD_POD_BOOTSTRAP_URL,
			RUNPOD_POD_GPU_TYPE_IDS: env.RUNPOD_POD_GPU_TYPE_IDS,
			RUNPOD_POD_IMAGE_NAME: env.RUNPOD_POD_IMAGE_NAME,
			RUNPOD_TRAINING_MODE: env.RUNPOD_TRAINING_MODE,
		}),
	},
	promptEnhanceEnv: {
		grokConfigured: Boolean(env.XAI_API_KEY?.trim()),
		openRouterConfigured: Boolean(env.OPENROUTER_API_KEY?.trim()),
		openRouterModelEnvDefault: env.OPENROUTER_MODEL,
	},
	promptEnhanceSettings,
	trainingProviderAvailability: {
		resolve: () => resolveTrainingProviderAvailability(env),
	},
	trainingProviderSettings,
	openRouterModelsApiKey: env.OPENROUTER_API_KEY ?? null,
	runtimeConfig: runtimeConfigSetup
		? {
				deps: runtimeConfigSetup,
				internalToken: env.RUNTIME_CONFIG_INTERNAL_TOKEN ?? undefined,
			}
		: undefined,
	usersService,
	workerSettingsReader,
});

ensureDevUser();

export default {
	maxRequestBodySize: 3_000_000_000,
	port: Number(process.env.PORT ?? 3000),
	fetch: app.fetch,
};
