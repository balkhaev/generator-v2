import type { RunStatus } from "./generator";
import type { PersonLoraTrainingMeta } from "./persons";

export interface DashboardRecentRun {
	artifactCount: number;
	createdAt: string;
	errorSummary: string | null;
	/** ID generator execution (если есть) — для debug / ссылок. */
	generatorRunId: string | null;
	id: string;
	inputImageUrl: string;
	inputLabel: string;
	primaryArtifactUrl: string | null;
	providerEndpointId: string | null;
	providerJobId: string | null;
	scenarioId: string;
	scenarioName: string;
	status: RunStatus;
	workflowKey: string;
}

export interface DashboardRunStatusSummary {
	failed: number;
	queued: number;
	running: number;
	succeeded: number;
}

export interface DashboardScenarioSummary {
	id: string;
	lastRunAt: string | null;
	lastRunStatus: RunStatus | null;
	name: string;
	runCount: number;
	updatedAt: string;
	workflowKey: string;
}

export interface DashboardLoraTrainingSnapshot {
	datasetUrl: string | null;
	loraUrl: string | null;
	personId: string;
	personName: string;
	personSlug: string;
	referencePhotoUrl: string;
	training: PersonLoraTrainingMeta | null;
	updatedAt: string;
}

export interface AdminDashboardSnapshot {
	loraTrainings: DashboardLoraTrainingSnapshot[];
	notices: string[];
	recentRuns: DashboardRecentRun[];
	runStatus: DashboardRunStatusSummary;
	scenarios: DashboardScenarioSummary[];
	snapshotAt: string;
}

export interface AdminSetupStatus {
	setupRequired: boolean;
}

export interface AdminUser {
	accountsCount: number;
	createdAt: string;
	email: string;
	emailVerified: boolean;
	hasPassword: boolean;
	id: string;
	image: string | null;
	name: string;
	sessionsCount: number;
	updatedAt: string;
}

export interface CreateAdminUserInput {
	email: string;
	emailVerified?: boolean;
	image?: string | null;
	name: string;
	password: string;
}

export interface UpdateAdminUserInput {
	email?: string;
	emailVerified?: boolean;
	image?: string | null;
	name?: string;
}

export interface ResetAdminUserPasswordInput {
	password: string;
}

export interface ListAdminUsersQuery {
	search?: string;
}

export const PROMPT_ENHANCE_PROVIDER_NAMES = ["grok", "openrouter"] as const;
export type PromptEnhanceProviderName =
	(typeof PROMPT_ENHANCE_PROVIDER_NAMES)[number];

export type TrainingProviderName = "fal" | "runpod";

export interface TrainingProviderAvailability {
	configured: boolean;
	missing: string[];
	provider: TrainingProviderName;
}

export interface TrainingProviderSettingsSnapshot {
	availability: TrainingProviderAvailability[];
	provider: TrainingProviderName;
}

export interface DatasetEditorModelOption {
	description: string;
	id: string;
	label: string;
	supportsNegativePrompt: boolean;
}

export interface DatasetBuilderSettings {
	availableModels: DatasetEditorModelOption[];
	model: string;
	negativePromptPreview: string;
	note: string;
	pollMs: number;
	timeoutMs: number;
}

export interface RunpodTrainingSettings {
	baseModel: string;
	bootstrapUrl: string | null;
	endpointConfigured: boolean;
	endpointId: string | null;
	mode: "serverless" | "pod";
	podGpuTypeIds: string[];
	podImageName: string | null;
	podTemplateId: string | null;
	pollMs: number;
	timeoutMs: number;
}

export interface PersonsWorkflowDefaults {
	avatarPreviewWorkflow: string;
	avatarRefineWorkflow: string;
	avatarWorkflow: string;
	loraWorkflow: string;
}

export interface GeneratorRuntimeSettings {
	reconcileIntervalMs: number;
	reconcileWatch: boolean;
}

/**
 * Heartbeat-based health snapshot of the training worker. The gateway reads it
 * from Redis to decide whose env values to trust for availability/runpod
 * sections. If the worker hasn't published a heartbeat recently, UI shows a
 * warning and falls back to gateway-local env (so single-process dev still
 * works).
 */
export interface AdminWorkerHealthStatus {
	ageSeconds: number | null;
	isFresh: boolean;
	lastSeenAt: string | null;
	source: "worker" | "gateway-fallback";
}

/**
 * Discriminator for which surface a prompt-enhance setting belongs to. Each
 * surface owns an independent runtime-config domain so studio and persons
 * can run on different LLMs (e.g. studio on Qwen, persons on Grok).
 */
export const PROMPT_ENHANCE_TARGETS = ["studio", "persons"] as const;
export type PromptEnhanceTarget = (typeof PROMPT_ENHANCE_TARGETS)[number];

export interface PromptEnhanceSettingsSnapshot {
	/** Ключи (XAI / OpenRouter) должны быть в env consumer-сервиса (studio-api / persons-api); провайдер и модель OpenRouter — в runtime-config (Postgres + Redis pub/sub). */
	grokConfigured: boolean;
	openRouterConfigured: boolean;
	/**
	 * Фактический slug модели для enhance (runtime-config setting,
	 * иначе совпадает с `openRouterModelEnvDefault`).
	 */
	openRouterModel: string;
	/** Значение OPENROUTER_MODEL в env consumer-сервиса (fallback при пустом runtime-config). */
	openRouterModelEnvDefault: string;
	provider: PromptEnhanceProviderName;
	target: PromptEnhanceTarget;
}

export interface PromptEnhanceSettingsBundle {
	persons: PromptEnhanceSettingsSnapshot;
	studio: PromptEnhanceSettingsSnapshot;
}

export interface AdminSettingsSnapshot {
	datasetBuilder: DatasetBuilderSettings;
	generatorRuntime: GeneratorRuntimeSettings;
	personsDefaults: PersonsWorkflowDefaults;
	promptEnhance: PromptEnhanceSettingsBundle;
	runpodTraining: RunpodTrainingSettings;
	trainingProvider: TrainingProviderSettingsSnapshot;
	workerHealth: AdminWorkerHealthStatus;
}

export type StorageObjectCategory =
	| "all"
	| "datasets"
	| "loras"
	| "persons-inputs"
	| "run-outputs"
	| "runpod-logs"
	| "studio-inputs"
	| "unknown";

export interface StorageCategorySummary {
	description: string;
	id: Exclude<StorageObjectCategory, "unknown">;
	label: string;
	prefix: string;
}

export interface StorageConfigSnapshot {
	accessKeyConfigured: boolean;
	bucket: string | null;
	configured: boolean;
	endpoint: string | null;
	missing: string[];
	publicBaseUrl: string | null;
	region: string | null;
	secretAccessKeyConfigured: boolean;
}

export interface StorageOverviewSnapshot {
	categories: StorageCategorySummary[];
	checkedAt: string;
	config: StorageConfigSnapshot;
}

export interface StorageObjectSummary {
	category: StorageObjectCategory;
	contentType: string | null;
	etag: string | null;
	key: string;
	lastModified: string | null;
	sizeBytes: number;
	url: string;
}

export interface StorageListObjectsQuery {
	cursor?: string;
	maxKeys?: number;
	prefix?: string;
}

export interface StorageListObjectsResponse {
	config: StorageConfigSnapshot;
	cursor: string | null;
	isTruncated: boolean;
	nextCursor: string | null;
	objects: StorageObjectSummary[];
	prefix: string;
	scannedCount: number;
	totalSizeBytes: number;
}

export interface StorageHealthSnapshot {
	checkedAt: string;
	error: string | null;
	latencyMs: number;
	ok: boolean;
	sampleCount: number;
}

export interface StorageUploadResponse {
	object: StorageObjectSummary;
}

export interface StoragePresignUploadInput {
	contentType?: string;
	expiresInSeconds?: number;
	key: string;
}

export interface StoragePresignUploadResponse {
	expiresInSeconds: number;
	key: string;
	method: "PUT";
	publicUrl: string;
	requiredHeaders: Record<string, string>;
	url: string;
}
