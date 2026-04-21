import { DEFAULT_PERSON_LORA_REFERENCE_IMAGE_TARGET_COUNT } from "@generator/contracts/persons";
import type { PersonsService } from "@/domain/persons";

const ADORELY_DEBUG_MCP_URL = "https://api.adorely.co/debug/mcp";
const MCP_PROTOCOL_VERSION = "2025-03-26";
const EXTERNAL_SOURCE = "adorely";
const lineBreakPattern = /\r?\n/u;
const sseDataPrefix = "data: ";

export type AdorelyCompanionStatus =
	| "active"
	| "archived"
	| "draft"
	| "pipeline";

interface AdorelyAssetCounts {
	totalAssets: number;
}

interface AdorelyCompanionListItem {
	assetCounts?: AdorelyAssetCounts;
	avatarUrl: string | null;
	id: string;
	mainPhotoUrl: string | null;
	name: string;
	status: string;
	tenantId: string;
}

interface AdorelyCompanionListResult {
	companions: AdorelyCompanionListItem[];
	limit: number;
	nextOffset: number | null;
	offset: number;
	total: number;
}

interface AdorelyCompanionMetadata {
	age: number | null;
	artStyle: string | null;
	bodyType: string | null;
	ethnicity: string | null;
	gender: string | null;
	hairColor: string | null;
	hairStyle: string | null;
	riskLevel: number | null;
	skinTone: string | null;
}

interface AdorelyCompanionDetail {
	assetCounts: AdorelyAssetCounts;
	bio: string | null;
	categories: { id: string; name: string; slug: string }[];
	description: string | null;
	greeting: string;
	id: string;
	mainPhotoUrl: string | null;
	metadata: AdorelyCompanionMetadata;
	name: string;
	promptContext: Record<string, unknown>;
	status: string;
	tagline: string;
	tenantId: string;
	translations: Record<string, unknown>;
}

type AdorelyAssetKind = "dataset" | "gallery" | "main" | "welcome";
type AdorelyAssetType = "audio" | "dataset" | "image" | "video";

export interface AdorelyCompanionAsset {
	assetId: string;
	assetRef: string;
	assetSourceTable: "companion_dataset" | "companion_media";
	caption: string | null;
	createdAt: string;
	isMainPhoto: boolean;
	kind: AdorelyAssetKind;
	order: number | null;
	source: string;
	type: AdorelyAssetType;
	url: string;
	visibility: {
		isDraft: boolean;
		isPremium: boolean;
		isPrivate: boolean;
	} | null;
}

interface AdorelyCompanionAssetsResult {
	assets: AdorelyCompanionAsset[];
	hasMore: boolean;
	nextOffset: number | null;
	total: number;
}

interface McpToolResponse<T> {
	content?: { text?: string; type?: string }[];
	isError?: boolean;
	structuredContent?: T;
}

interface JsonRpcResponse<T> {
	error?: { message?: string };
	result?: McpToolResponse<T>;
}

export interface AdorelyDebugMcpClientOptions {
	fetchImpl?: typeof fetch;
	token: string;
	url?: string;
}

export interface ImportAdorelyCompanionsOptions {
	dryRun?: boolean;
	limit?: number;
	logger?: Pick<Console, "error" | "info" | "warn">;
	riskLevel?: number;
	service?: PersonsService;
	startTraining?: boolean;
	status?: AdorelyCompanionStatus;
	targetDatasetCount?: number;
}

export interface ImportAdorelyCompanionResult {
	companionId: string;
	importedDatasetPhotoCount: number;
	missingDatasetPhotoCount: number;
	name: string;
	personId: string | null;
	skipped: boolean;
	skipReason: string | null;
	startedTraining: boolean;
}

export interface ImportAdorelyCompanionsSummary {
	created: number;
	dryRun: boolean;
	failed: number;
	imported: number;
	results: ImportAdorelyCompanionResult[];
	skipped: number;
	startedTraining: number;
	total: number;
	updated: number;
}

export class AdorelyDebugMcpClient {
	private initialized = false;
	private readonly fetchImpl: typeof fetch;
	private readonly token: string;
	private readonly url: string;

	constructor(options: AdorelyDebugMcpClientOptions) {
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.token = options.token;
		this.url = options.url ?? ADORELY_DEBUG_MCP_URL;
	}

	private async post<T>(
		method: string,
		params?: Record<string, unknown>
	): Promise<T> {
		const response = await this.fetchImpl(this.url, {
			body: JSON.stringify({
				id: crypto.randomUUID(),
				jsonrpc: "2.0",
				method,
				...(params ? { params } : {}),
			}),
			headers: {
				accept: "application/json, text/event-stream",
				authorization: `Bearer ${this.token}`,
				"content-type": "application/json",
				"mcp-protocol-version": MCP_PROTOCOL_VERSION,
			},
			method: "POST",
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(
				`Adorely MCP ${method} failed (${response.status}): ${text.slice(0, 500)}`
			);
		}

		return parseMcpJsonResponse<T>(text);
	}

	async initialize() {
		if (this.initialized) {
			return;
		}
		await this.post("initialize", {
			capabilities: {},
			clientInfo: { name: "generator-adorely-import", version: "1.0.0" },
			protocolVersion: MCP_PROTOCOL_VERSION,
		});
		this.initialized = true;
	}

	async callTool<T>(
		name: string,
		argumentsPayload: Record<string, unknown>
	): Promise<T> {
		await this.initialize();
		const response = await this.post<JsonRpcResponse<T>>("tools/call", {
			arguments: argumentsPayload,
			name,
		});
		if (response.error) {
			throw new Error(response.error.message ?? `Adorely MCP ${name} failed`);
		}
		const result = response.result;
		if (!result) {
			throw new Error(`Adorely MCP ${name} returned no result`);
		}
		if (result.isError) {
			throw new Error(readMcpErrorText(result) ?? `Adorely MCP ${name} failed`);
		}
		if (result.structuredContent) {
			return result.structuredContent;
		}
		const text = result.content?.find((item) => item.type === "text")?.text;
		if (!text) {
			throw new Error(`Adorely MCP ${name} returned no structured content`);
		}
		return JSON.parse(text) as T;
	}

	listCompanions(input: {
		includeCounts?: boolean;
		limit?: number;
		offset?: number;
		riskLevel?: number;
		status?: AdorelyCompanionStatus;
	}) {
		return this.callTool<AdorelyCompanionListResult>("list_companions", input);
	}

	getCompanion(companionId: string) {
		return this.callTool<AdorelyCompanionDetail>("get_companion", {
			companionId,
		});
	}

	listCompanionAssets(companionId: string, offset = 0) {
		return this.callTool<AdorelyCompanionAssetsResult>(
			"list_companion_assets",
			{
				companionId,
				limit: 500,
				offset,
			}
		);
	}
}

function parseMcpJsonResponse<T>(text: string): T {
	const data = text
		.split(lineBreakPattern)
		.filter((line) => line.startsWith(sseDataPrefix))
		.map((line) => line.slice(sseDataPrefix.length))
		.join("\n");
	return JSON.parse(data || text) as T;
}

function readMcpErrorText(result: McpToolResponse<unknown>) {
	return result.content?.find((item) => item.type === "text")?.text ?? null;
}

export function sanitizeExternalId(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/giu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 80);
}

function isReferenceImageAsset(asset: AdorelyCompanionAsset) {
	return asset.type === "image" || asset.type === "dataset";
}

function getAssetRank(asset: AdorelyCompanionAsset) {
	if (asset.isMainPhoto) {
		return 0;
	}
	if (asset.source === "dataset:original") {
		return 1;
	}
	if (asset.source === "dataset:generated") {
		return 2;
	}
	if (asset.kind === "welcome") {
		return 3;
	}
	if (asset.kind === "gallery") {
		return 4;
	}
	return 5;
}

export function getAdorelyAssetVariantId(asset: AdorelyCompanionAsset) {
	return `adorely-${sanitizeExternalId(asset.assetId)}`;
}

export function selectAdorelyReferenceAssets(assets: AdorelyCompanionAsset[]) {
	const seenUrls = new Set<string>();
	return assets
		.filter(isReferenceImageAsset)
		.sort((left, right) => {
			const rankDelta = getAssetRank(left) - getAssetRank(right);
			if (rankDelta !== 0) {
				return rankDelta;
			}
			return (left.order ?? 0) - (right.order ?? 0);
		})
		.filter((asset) => {
			if (seenUrls.has(asset.url)) {
				return false;
			}
			seenUrls.add(asset.url);
			return true;
		});
}

function buildAppearanceDescription(companion: AdorelyCompanionDetail) {
	const metadata = companion.metadata;
	const subject = [
		metadata.age ? `${metadata.age}-year-old` : null,
		metadata.ethnicity,
		metadata.gender ?? "female",
	]
		.filter(Boolean)
		.join(" ");
	const appearance = [
		metadata.skinTone ? `${metadata.skinTone} skin` : null,
		metadata.hairColor || metadata.hairStyle
			? `${[metadata.hairColor, metadata.hairStyle].filter(Boolean).join(" ")} hair`
			: null,
		metadata.bodyType ? `${metadata.bodyType} body type` : null,
		metadata.artStyle ? `${metadata.artStyle} visual style` : null,
	]
		.filter(Boolean)
		.join(", ");
	const base = `${companion.name} is a ${subject || "female"} companion.`;
	return appearance ? `${base} Appearance: ${appearance}.` : base;
}

async function listAllCompanions(
	client: AdorelyDebugMcpClient,
	status: AdorelyCompanionStatus,
	limit: number,
	riskLevel: number
) {
	const companions: AdorelyCompanionListItem[] = [];
	let offset = 0;
	let total = 0;
	for (;;) {
		const page = await client.listCompanions({
			includeCounts: true,
			limit,
			offset,
			riskLevel,
			status,
		});
		companions.push(...page.companions);
		total = page.total;
		if (page.nextOffset === null) {
			break;
		}
		offset = page.nextOffset;
	}
	return { companions, total };
}

export async function listAllAdorelyCompanionAssets(
	client: AdorelyDebugMcpClient,
	companionId: string
) {
	const assets: AdorelyCompanionAsset[] = [];
	let offset = 0;
	for (;;) {
		const page = await client.listCompanionAssets(companionId, offset);
		assets.push(...page.assets);
		if (page.nextOffset === null) {
			break;
		}
		offset = page.nextOffset;
	}
	return assets;
}

interface ImportContext {
	client: AdorelyDebugMcpClient;
	dryRun: boolean;
	riskLevel: number;
	service?: PersonsService;
	startTraining: boolean;
	targetDatasetCount: number;
}

interface ImportOutcome {
	created: boolean;
	imported: boolean;
	result: ImportAdorelyCompanionResult;
	skipped: boolean;
	startedTraining: boolean;
	updated: boolean;
}

interface ImportCounters {
	created: number;
	imported: number;
	skipped: number;
	startedTraining: number;
	updated: number;
}

function applyImportOutcome(
	counters: ImportCounters,
	results: ImportAdorelyCompanionResult[],
	outcome: ImportOutcome
) {
	results.push(outcome.result);
	if (outcome.skipped) {
		counters.skipped += 1;
	}
	if (outcome.imported) {
		counters.imported += 1;
	}
	if (outcome.startedTraining) {
		counters.startedTraining += 1;
	}
	if (outcome.created) {
		counters.created += 1;
	}
	if (outcome.updated) {
		counters.updated += 1;
	}
}

function getCompanionSkipReason(
	companion: AdorelyCompanionDetail,
	referenceAssets: AdorelyCompanionAsset[],
	riskLevel: number
) {
	if (companion.metadata.gender !== "female") {
		return "not female";
	}
	if (companion.metadata.riskLevel !== riskLevel) {
		return `risk level is not ${riskLevel}`;
	}
	if (
		typeof companion.metadata.age === "number" &&
		companion.metadata.age < 18
	) {
		return "under 18";
	}
	if (referenceAssets.length === 0) {
		return "no image assets";
	}
	return null;
}

function buildDryRunResult(input: {
	companion: AdorelyCompanionDetail;
	referenceAssets: AdorelyCompanionAsset[];
	targetDatasetCount: number;
}): ImportOutcome {
	return {
		created: false,
		imported: true,
		result: {
			companionId: input.companion.id,
			importedDatasetPhotoCount: Math.min(
				input.referenceAssets.length,
				input.targetDatasetCount
			),
			missingDatasetPhotoCount: Math.max(
				0,
				input.targetDatasetCount - input.referenceAssets.length
			),
			name: input.companion.name,
			personId: null,
			skipped: false,
			skipReason: null,
			startedTraining: false,
		},
		skipped: false,
		startedTraining: false,
		updated: false,
	};
}

function buildDatasetPhotos(
	companion: AdorelyCompanionDetail,
	referenceAssets: AdorelyCompanionAsset[],
	targetDatasetCount: number
) {
	return referenceAssets.slice(0, targetDatasetCount).map((asset, index) => ({
		caption:
			asset.caption ??
			`a photo of ${companion.name}, Adorely ${asset.kind} reference ${index + 1}`,
		metadata: {
			adorelyAssetId: asset.assetId,
			adorelyAssetRef: asset.assetRef,
			adorelyAssetSource: asset.source,
			adorelyAssetSourceTable: asset.assetSourceTable,
			adorelyVisibility: asset.visibility,
		},
		sourceUrl: asset.url,
		variantId: `adorely-${sanitizeExternalId(asset.assetId)}`,
	}));
}

async function applyCompanionImport(input: {
	companion: AdorelyCompanionDetail;
	referenceAssets: AdorelyCompanionAsset[];
	service: PersonsService;
	startTraining: boolean;
	targetDatasetCount: number;
}): Promise<ImportOutcome> {
	const referenceAsset = input.referenceAssets[0];
	if (!referenceAsset) {
		throw new Error("No reference asset selected");
	}
	const appearanceDescription = buildAppearanceDescription(input.companion);
	const importResult = await input.service.importExternalPerson({
		datasetPhotos: buildDatasetPhotos(
			input.companion,
			input.referenceAssets,
			input.targetDatasetCount
		),
		description: appearanceDescription,
		externalId: input.companion.id,
		externalSource: EXTERNAL_SOURCE,
		metadata: {
			adorely: {
				assetCounts: input.companion.assetCounts,
				bio: input.companion.bio,
				categories: input.companion.categories,
				description: input.companion.description,
				greeting: input.companion.greeting,
				metadata: input.companion.metadata,
				promptContext: input.companion.promptContext,
				status: input.companion.status,
				tagline: input.companion.tagline,
				tenantId: input.companion.tenantId,
				translations: input.companion.translations,
			},
		},
		name: input.companion.name,
		photoUrl: referenceAsset.url,
		referencePhotoUrl: referenceAsset.url,
		slug: `adorely-${sanitizeExternalId(input.companion.id)}`,
		targetDatasetCount: input.targetDatasetCount,
	});

	let didStartTraining = false;
	if (input.startTraining && importResult.missingDatasetPhotoCount > 0) {
		await input.service.startLoraTraining(
			importResult.person.id,
			{ referencePrompt: appearanceDescription },
			{ debugCorrelationId: `adorely-import-${input.companion.id}` }
		);
		didStartTraining = true;
	}

	return {
		created: importResult.created,
		imported: true,
		result: {
			companionId: input.companion.id,
			importedDatasetPhotoCount: importResult.importedDatasetPhotoCount,
			missingDatasetPhotoCount: importResult.missingDatasetPhotoCount,
			name: input.companion.name,
			personId: importResult.person.id,
			skipped: false,
			skipReason: null,
			startedTraining: didStartTraining,
		},
		skipped: false,
		startedTraining: didStartTraining,
		updated: !importResult.created,
	};
}

async function importOneAdorelyCompanion(
	companionListItem: AdorelyCompanionListItem,
	context: ImportContext
): Promise<ImportOutcome> {
	const companion = await context.client.getCompanion(companionListItem.id);
	const assets = await listAllAdorelyCompanionAssets(
		context.client,
		companion.id
	);
	const referenceAssets = selectAdorelyReferenceAssets(assets);
	const skipReason = getCompanionSkipReason(
		companion,
		referenceAssets,
		context.riskLevel
	);
	if (skipReason) {
		return {
			created: false,
			imported: false,
			result: buildSkippedResult(companionListItem, skipReason),
			skipped: true,
			startedTraining: false,
			updated: false,
		};
	}
	if (context.dryRun) {
		return buildDryRunResult({
			companion,
			referenceAssets,
			targetDatasetCount: context.targetDatasetCount,
		});
	}
	if (!context.service) {
		throw new Error("PersonsService is required when dryRun=false");
	}
	return applyCompanionImport({
		companion,
		referenceAssets,
		service: context.service,
		startTraining: context.startTraining,
		targetDatasetCount: context.targetDatasetCount,
	});
}

export async function importAdorelyCompanions(
	client: AdorelyDebugMcpClient,
	options: ImportAdorelyCompanionsOptions = {}
): Promise<ImportAdorelyCompanionsSummary> {
	const logger = options.logger ?? console;
	const dryRun = options.dryRun ?? true;
	const limit = options.limit ?? 100;
	const status = options.status ?? "active";
	const targetDatasetCount =
		options.targetDatasetCount ??
		DEFAULT_PERSON_LORA_REFERENCE_IMAGE_TARGET_COUNT;
	const riskLevel = options.riskLevel ?? 2;
	const { companions, total } = await listAllCompanions(
		client,
		status,
		limit,
		riskLevel
	);
	const results: ImportAdorelyCompanionResult[] = [];
	const context: ImportContext = {
		client,
		dryRun,
		riskLevel,
		startTraining: options.startTraining === true,
		targetDatasetCount,
		...(options.service ? { service: options.service } : {}),
	};
	const counters: ImportCounters = {
		created: 0,
		imported: 0,
		skipped: 0,
		startedTraining: 0,
		updated: 0,
	};
	let failed = 0;

	for (const companionListItem of companions) {
		try {
			applyImportOutcome(
				counters,
				results,
				await importOneAdorelyCompanion(companionListItem, context)
			);
		} catch (error) {
			failed += 1;
			logger.error("adorely.import.companion_failed", {
				companionId: companionListItem.id,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return {
		created: counters.created,
		dryRun,
		failed,
		imported: counters.imported,
		results,
		skipped: counters.skipped,
		startedTraining: counters.startedTraining,
		total,
		updated: counters.updated,
	};
}

function buildSkippedResult(
	companion: AdorelyCompanionListItem,
	reason: string
): ImportAdorelyCompanionResult {
	return {
		companionId: companion.id,
		importedDatasetPhotoCount: 0,
		missingDatasetPhotoCount: 0,
		name: companion.name,
		personId: null,
		skipped: true,
		skipReason: reason,
		startedTraining: false,
	};
}
