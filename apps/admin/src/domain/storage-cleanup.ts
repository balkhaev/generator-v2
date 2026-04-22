import type {
	StorageObjectSummary,
	StorageOrphanDeleteResponse,
	StorageOrphanScanInput,
	StorageOrphanScanResponse,
} from "@generator/contracts/admin";
import { db } from "@generator/db";
import { generatorExecution } from "@generator/db/schema/generator";
import { lora } from "@generator/db/schema/loras";
import { person, personGeneration } from "@generator/db/schema/persons";
import {
	studioArtifact,
	studioRun,
	studioScenario,
	studioScenarioShot,
} from "@generator/db/schema/studio";
import {
	buildPublicAssetUrl,
	deleteObjectFromS3,
	extractS3KeyFromPublicUrl,
	listS3Objects,
	type S3ListedObject,
	type S3StorageConfig,
	statS3Object,
} from "@generator/storage";
import {
	DEFAULT_CLEANUP_PREFIXES,
	toStorageObjectSummary,
} from "@/domain/storage-metadata";

const DEFAULT_CLEANUP_MAX_KEYS = 100;
const DEFAULT_CLEANUP_MAX_PAGES = 20;
const DEFAULT_MINIMUM_AGE_HOURS = 24;
const MAX_CLEANUP_MAX_KEYS = 1000;
const MAX_CLEANUP_MAX_PAGES = 100;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const leadingSlashesPattern = /^\/+/u;
const trailingSlashesPattern = /\/+$/u;

type StorageCleanupDatabase = typeof db;

export interface StorageCleanupConfigSnapshot {
	accessKeyConfigured: boolean;
	bucket: string | null;
	configured: boolean;
	endpoint: string | null;
	missing: string[];
	publicBaseUrl: string | null;
	region: string | null;
	secretAccessKeyConfigured: boolean;
}

export interface StorageCleanupService {
	deleteOrphans(
		input: StorageOrphanScanInput & { keys: string[] }
	): Promise<StorageOrphanDeleteResponse>;
	scanOrphans(
		input?: StorageOrphanScanInput
	): Promise<StorageOrphanScanResponse>;
}

interface NormalizedScanInput {
	maxKeys: number;
	maxPages: number;
	minimumAgeHours: number;
	prefixes: string[];
}

interface OrphanAnalysis {
	objects: StorageObjectSummary[];
	orphanSizeBytes: number;
	protectedRecentCount: number;
	unknownAgeCount: number;
}

function clampInteger(input: unknown, fallback: number, max: number): number {
	const parsed = typeof input === "number" ? input : Number(input);
	if (!(Number.isFinite(parsed) && parsed > 0)) {
		return fallback;
	}
	return Math.min(Math.trunc(parsed), max);
}

function normalizeMinimumAgeHours(input: unknown): number {
	const parsed = typeof input === "number" ? input : Number(input);
	if (!(Number.isFinite(parsed) && parsed >= 0)) {
		return DEFAULT_MINIMUM_AGE_HOURS;
	}
	return Math.min(parsed, 24 * 365);
}

function normalizePrefix(value: string): string {
	const prefix = value.trim().replace(leadingSlashesPattern, "");
	if (!prefix) {
		return "";
	}
	return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function normalizeStorageKey(value: string): string {
	return value
		.trim()
		.replace(leadingSlashesPattern, "")
		.replace(trailingSlashesPattern, "");
}

function normalizeScanInput(
	input?: StorageOrphanScanInput
): NormalizedScanInput {
	const requestedPrefixes =
		input?.prefixes
			?.filter((value): value is string => typeof value === "string")
			.map(normalizePrefix)
			.filter((value) => value.length > 0) ?? [];
	const prefixes =
		requestedPrefixes.length > 0
			? [...new Set(requestedPrefixes)]
			: [...DEFAULT_CLEANUP_PREFIXES];

	return {
		maxKeys: clampInteger(
			input?.maxKeys,
			DEFAULT_CLEANUP_MAX_KEYS,
			MAX_CLEANUP_MAX_KEYS
		),
		maxPages: clampInteger(
			input?.maxPages,
			DEFAULT_CLEANUP_MAX_PAGES,
			MAX_CLEANUP_MAX_PAGES
		),
		minimumAgeHours: normalizeMinimumAgeHours(input?.minimumAgeHours),
		prefixes,
	};
}

function addKeyForValue(
	keys: Set<string>,
	value: unknown,
	config: S3StorageConfig
) {
	if (typeof value !== "string") {
		return;
	}
	const key = extractS3KeyFromPublicUrl(value, config);
	if (key) {
		keys.add(key);
		return;
	}
	if (
		DEFAULT_CLEANUP_PREFIXES.some((prefix) => value.startsWith(prefix)) &&
		!value.endsWith("/")
	) {
		keys.add(value);
	}
}

function collectKeysFromValue(
	keys: Set<string>,
	value: unknown,
	config: S3StorageConfig
) {
	addKeyForValue(keys, value, config);
	if (!value || typeof value !== "object") {
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) {
			collectKeysFromValue(keys, entry, config);
		}
		return;
	}
	for (const entry of Object.values(value as Record<string, unknown>)) {
		collectKeysFromValue(keys, entry, config);
	}
}

async function collectReferencedKeys(
	config: S3StorageConfig,
	database: StorageCleanupDatabase
): Promise<Set<string>> {
	const keys = new Set<string>();
	const [
		generatorRows,
		loraRows,
		personRows,
		personGenerationRows,
		studioArtifactRows,
		studioRunRows,
		studioScenarioRows,
		studioShotRows,
	] = await Promise.all([
		database
			.select({
				artifacts: generatorExecution.artifacts,
				callback: generatorExecution.callback,
				inputImageUrl: generatorExecution.inputImageUrl,
				params: generatorExecution.params,
			})
			.from(generatorExecution),
		database
			.select({
				s3Key: lora.s3Key,
				s3Url: lora.s3Url,
				sourceUrl: lora.sourceUrl,
			})
			.from(lora),
		database
			.select({
				datasetUrl: person.datasetUrl,
				loraUrl: person.loraUrl,
				metadata: person.metadata,
				photoUrl: person.photoUrl,
				referencePhotoUrl: person.referencePhotoUrl,
				videoUrl: person.videoUrl,
				voiceWavUrl: person.voiceWavUrl,
			})
			.from(person),
		database
			.select({
				metadata: personGeneration.metadata,
				previewUrl: personGeneration.previewUrl,
				sourceUrl: personGeneration.sourceUrl,
			})
			.from(personGeneration),
		database
			.select({
				metadata: studioArtifact.metadata,
				url: studioArtifact.url,
			})
			.from(studioArtifact),
		database
			.select({
				inputImageUrl: studioRun.inputImageUrl,
			})
			.from(studioRun),
		database
			.select({
				params: studioScenario.params,
			})
			.from(studioScenario),
		database
			.select({
				artifactUrl: studioScenarioShot.artifactUrl,
			})
			.from(studioScenarioShot),
	]);

	for (const row of generatorRows) {
		collectKeysFromValue(keys, row, config);
	}
	for (const row of loraRows) {
		collectKeysFromValue(keys, row, config);
	}
	for (const row of personRows) {
		collectKeysFromValue(keys, row, config);
	}
	for (const row of personGenerationRows) {
		collectKeysFromValue(keys, row, config);
	}
	for (const row of studioArtifactRows) {
		collectKeysFromValue(keys, row, config);
	}
	for (const row of studioRunRows) {
		collectKeysFromValue(keys, row, config);
	}
	for (const row of studioScenarioRows) {
		collectKeysFromValue(keys, row, config);
	}
	for (const row of studioShotRows) {
		collectKeysFromValue(keys, row, config);
	}

	return keys;
}

async function listCleanupObjects(
	config: S3StorageConfig,
	input: NormalizedScanInput
): Promise<{
	isTruncated: boolean;
	objects: S3ListedObject[];
	pagesScanned: number;
	scannedSizeBytes: number;
}> {
	const objectsByKey = new Map<string, S3ListedObject>();
	let isTruncated = false;
	let pagesScanned = 0;

	for (const prefix of input.prefixes) {
		let cursor: string | undefined;
		for (let page = 0; page < input.maxPages; page += 1) {
			const listed = await listS3Objects(
				{
					...(cursor ? { startAfter: cursor } : {}),
					maxKeys: input.maxKeys,
					prefix,
				},
				config
			);
			pagesScanned += 1;
			for (const object of listed.contents) {
				objectsByKey.set(object.key, object);
			}
			if (!(listed.isTruncated && listed.nextStartAfter)) {
				break;
			}
			cursor = listed.nextStartAfter;
			if (page === input.maxPages - 1) {
				isTruncated = true;
			}
		}
	}

	const objects = [...objectsByKey.values()];
	return {
		isTruncated,
		objects,
		pagesScanned,
		scannedSizeBytes: objects.reduce(
			(total, object) => total + object.sizeBytes,
			0
		),
	};
}

export function analyzeOrphanObjects(input: {
	minimumAgeHours: number;
	now: Date;
	objects: S3ListedObject[];
	referencedKeys: Set<string>;
}): OrphanAnalysis {
	const minimumAgeMs = input.minimumAgeHours * MILLISECONDS_PER_HOUR;
	const orphanObjects: StorageObjectSummary[] = [];
	let orphanSizeBytes = 0;
	let protectedRecentCount = 0;
	let unknownAgeCount = 0;

	for (const object of input.objects) {
		if (input.referencedKeys.has(object.key)) {
			continue;
		}
		if (!object.lastModified) {
			unknownAgeCount += 1;
			continue;
		}
		if (input.now.getTime() - object.lastModified.getTime() < minimumAgeMs) {
			protectedRecentCount += 1;
			continue;
		}
		orphanObjects.push(toStorageObjectSummary(object));
		orphanSizeBytes += object.sizeBytes;
	}

	return {
		objects: orphanObjects,
		orphanSizeBytes,
		protectedRecentCount,
		unknownAgeCount,
	};
}

export function createStorageCleanupService(options: {
	config: S3StorageConfig;
	configSnapshot: StorageCleanupConfigSnapshot;
	database?: StorageCleanupDatabase;
}): StorageCleanupService {
	const database = options.database ?? db;

	return {
		async scanOrphans(input) {
			const normalized = normalizeScanInput(input);
			const [referencedKeys, listed] = await Promise.all([
				collectReferencedKeys(options.config, database),
				listCleanupObjects(options.config, normalized),
			]);
			const analysis = analyzeOrphanObjects({
				minimumAgeHours: normalized.minimumAgeHours,
				now: new Date(),
				objects: listed.objects,
				referencedKeys,
			});

			return {
				checkedAt: new Date().toISOString(),
				config: options.configSnapshot,
				isTruncated: listed.isTruncated,
				minimumAgeHours: normalized.minimumAgeHours,
				objects: analysis.objects,
				orphanCount: analysis.objects.length,
				orphanSizeBytes: analysis.orphanSizeBytes,
				pagesScanned: listed.pagesScanned,
				prefixes: normalized.prefixes,
				protectedRecentCount: analysis.protectedRecentCount,
				referencedKeyCount: referencedKeys.size,
				scannedCount: listed.objects.length,
				scannedSizeBytes: listed.scannedSizeBytes,
				unknownAgeCount: analysis.unknownAgeCount,
			};
		},
		async deleteOrphans(input) {
			const normalized = normalizeScanInput(input);
			const requestedKeys = [
				...new Set(input.keys.map(normalizeStorageKey)),
			].filter((key) => key.length > 0);
			const referencedKeys = await collectReferencedKeys(
				options.config,
				database
			);
			const listed = await Promise.all(
				requestedKeys.map(async (key): Promise<S3ListedObject | null> => {
					try {
						return await statS3Object(key, options.config);
					} catch {
						return {
							etag: null,
							key,
							lastModified: null,
							sizeBytes: 0,
							type: null,
							url: buildPublicAssetUrl(options.config, key),
						};
					}
				})
			);
			const objects = listed.filter(
				(object): object is S3ListedObject => object !== null
			);
			const minimumAgeMs = normalized.minimumAgeHours * MILLISECONDS_PER_HOUR;
			const skippedReferenced: StorageObjectSummary[] = [];
			const skippedRecent: StorageObjectSummary[] = [];
			const deleted: StorageObjectSummary[] = [];
			const failed: StorageOrphanDeleteResponse["failed"] = [];

			for (const object of objects) {
				const summary = toStorageObjectSummary(object);
				if (referencedKeys.has(object.key)) {
					skippedReferenced.push(summary);
					continue;
				}
				if (!(object.lastModified || minimumAgeMs === 0)) {
					skippedRecent.push(summary);
					continue;
				}
				if (
					object.lastModified &&
					Date.now() - object.lastModified.getTime() < minimumAgeMs
				) {
					skippedRecent.push(summary);
					continue;
				}
				try {
					await deleteObjectFromS3(object.key, options.config);
					deleted.push(summary);
				} catch (error) {
					failed.push({
						error: error instanceof Error ? error.message : "Delete failed",
						key: object.key,
					});
				}
			}

			return {
				checkedAt: new Date().toISOString(),
				deleted,
				deletedCount: deleted.length,
				deletedSizeBytes: deleted.reduce(
					(total, object) => total + object.sizeBytes,
					0
				),
				failed,
				minimumAgeHours: normalized.minimumAgeHours,
				skippedRecent,
				skippedReferenced,
			};
		},
	};
}
