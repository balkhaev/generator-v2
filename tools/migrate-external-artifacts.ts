/**
 * One-shot migration: rewrite every artifact/asset URL stored in the database
 * to live inside our internal S3 bucket. Any HTTP(S) URL whose host is not
 * `S3_PUBLIC_BASE_URL` is downloaded and re-uploaded under a deterministic key
 * via `@generator/storage`'s ArtifactPersister.
 *
 * Tables and columns covered:
 *   - generator_execution.input_image_url      (text)
 *   - generator_execution.artifacts            (jsonb [{url}])
 *   - person.reference_photo_url               (text, mandatory)
 *   - person.dataset_url                       (text)
 *   - person.lora_url                          (text)
 *   - person.photo_url                         (text)
 *   - person.video_url                         (text)
 *   - person.voice_wav_url                     (text)
 *   - person_generation.preview_url            (text)
 *   - person_generation.source_url             (text, mandatory)
 *   - studio_run.input_image_url               (text, mandatory)
 *   - studio_artifact.url                      (text, mandatory)
 *
 * Note: lora.s3_url is intentionally skipped — every LoRA is uploaded to S3
 * by the admin LoraRegistryService before the row is created, so its URL is
 * always already inside our bucket.
 *
 * Usage:
 *   bun run tools/migrate-external-artifacts.ts            # dry-run
 *   bun run tools/migrate-external-artifacts.ts --apply    # actually migrate
 *
 * The script is idempotent: URLs that already point at the configured public
 * S3 base are skipped. Failures per row are logged but do not abort the run;
 * the row keeps its previous external URL so it can be retried later.
 */
import { createDb } from "@generator/db";
import { generatorExecution } from "@generator/db/schema/generator";
import { person, personGeneration } from "@generator/db/schema/persons";
import { studioArtifact, studioRun } from "@generator/db/schema/studio";
import { getDatabaseUrl } from "@generator/env/server";
import {
	createArtifactPersister,
	createS3Client,
	isOwnedAssetUrl,
	resolveS3StorageConfig,
} from "@generator/storage";
import { eq } from "drizzle-orm";

const APPLY_FLAG = "--apply";
const apply = process.argv.includes(APPLY_FLAG);

const httpUrlPattern = /^https?:\/\//iu;

const config = resolveS3StorageConfig(process.env);
const client = createS3Client(config);
const persister = createArtifactPersister({
	client,
	config,
	logger: console,
});

const db = createDb(getDatabaseUrl());

interface MigrationStats {
	failed: number;
	rewritten: number;
	scanned: number;
	skipped: number;
}

function createStats(): MigrationStats {
	return { failed: 0, rewritten: 0, scanned: 0, skipped: 0 };
}

function shouldRewrite(url: string | null | undefined): url is string {
	if (!url) {
		return false;
	}
	if (url.startsWith("data:")) {
		return false;
	}
	if (!httpUrlPattern.test(url)) {
		return false;
	}
	return !isOwnedAssetUrl(config, url);
}

async function rewriteOne(input: {
	executionId: string;
	index?: number;
	url: string;
}): Promise<string | null> {
	try {
		return await persister.persistArtifactUrl(input);
	} catch (error) {
		console.error("migrate.persist.failed", {
			executionId: input.executionId,
			index: input.index,
			message: error instanceof Error ? error.message : "unknown",
			url: input.url,
		});
		return null;
	}
}

async function migrateGeneratorExecutions(stats: MigrationStats) {
	const rows = await db
		.select({
			artifacts: generatorExecution.artifacts,
			id: generatorExecution.id,
			inputImageUrl: generatorExecution.inputImageUrl,
		})
		.from(generatorExecution);
	for (const row of rows) {
		stats.scanned += 1;
		let nextInputImageUrl = row.inputImageUrl;
		if (shouldRewrite(row.inputImageUrl)) {
			const rewritten = await rewriteOne({
				executionId: `gen-exec-${row.id}-input`,
				url: row.inputImageUrl,
			});
			if (rewritten) {
				nextInputImageUrl = rewritten;
				stats.rewritten += 1;
			} else {
				stats.failed += 1;
			}
		}
		const artifacts = row.artifacts ?? [];
		const nextArtifacts = await Promise.all(
			artifacts.map(async (artifact, index) => {
				if (!shouldRewrite(artifact.url)) {
					return artifact;
				}
				const rewritten = await rewriteOne({
					executionId: `gen-exec-${row.id}`,
					index,
					url: artifact.url,
				});
				if (rewritten) {
					stats.rewritten += 1;
					return { ...artifact, url: rewritten };
				}
				stats.failed += 1;
				return artifact;
			})
		);
		const inputChanged = nextInputImageUrl !== row.inputImageUrl;
		const artifactsChanged = nextArtifacts.some(
			(artifact, index) => artifact.url !== artifacts[index]?.url
		);
		if (!(inputChanged || artifactsChanged)) {
			stats.skipped += 1;
			continue;
		}
		if (apply) {
			await db
				.update(generatorExecution)
				.set({
					artifacts: nextArtifacts,
					inputImageUrl: nextInputImageUrl,
				})
				.where(eq(generatorExecution.id, row.id));
		}
	}
}

async function migrateTextColumn<TRow extends { id: string }>(
	rows: TRow[],
	field: keyof TRow,
	tableName: string,
	updateRow: (id: string, value: string) => Promise<void>,
	stats: MigrationStats
) {
	for (const row of rows) {
		stats.scanned += 1;
		const url = row[field] as unknown;
		if (typeof url !== "string" || !shouldRewrite(url)) {
			stats.skipped += 1;
			continue;
		}
		const rewritten = await rewriteOne({
			executionId: `${tableName}-${row.id}-${String(field)}`,
			url,
		});
		if (!rewritten) {
			stats.failed += 1;
			continue;
		}
		stats.rewritten += 1;
		if (apply) {
			await updateRow(row.id, rewritten);
		}
	}
}

async function migratePersons(stats: MigrationStats) {
	const rows = await db.select().from(person);
	for (const row of rows) {
		stats.scanned += 1;
		const updates: Partial<typeof row> = {};
		const fields = [
			"referencePhotoUrl",
			"datasetUrl",
			"loraUrl",
			"photoUrl",
			"videoUrl",
			"voiceWavUrl",
		] as const;
		for (const field of fields) {
			const url = row[field];
			if (!shouldRewrite(url)) {
				continue;
			}
			const rewritten = await rewriteOne({
				executionId: `person-${row.id}-${field}`,
				url,
			});
			if (rewritten) {
				updates[field] = rewritten;
				stats.rewritten += 1;
			} else {
				stats.failed += 1;
			}
		}
		if (Object.keys(updates).length === 0) {
			stats.skipped += 1;
			continue;
		}
		if (apply) {
			await db.update(person).set(updates).where(eq(person.id, row.id));
		}
	}
}

async function migratePersonGenerations(stats: MigrationStats) {
	const rows = await db
		.select({
			id: personGeneration.id,
			previewUrl: personGeneration.previewUrl,
			sourceUrl: personGeneration.sourceUrl,
		})
		.from(personGeneration);
	for (const row of rows) {
		stats.scanned += 1;
		const updates: { previewUrl?: string | null; sourceUrl?: string } = {};
		if (shouldRewrite(row.previewUrl)) {
			const rewritten = await rewriteOne({
				executionId: `person-generation-${row.id}-preview`,
				url: row.previewUrl,
			});
			if (rewritten) {
				updates.previewUrl = rewritten;
				stats.rewritten += 1;
			} else {
				stats.failed += 1;
			}
		}
		if (shouldRewrite(row.sourceUrl)) {
			const rewritten = await rewriteOne({
				executionId: `person-generation-${row.id}-source`,
				url: row.sourceUrl,
			});
			if (rewritten) {
				updates.sourceUrl = rewritten;
				stats.rewritten += 1;
			} else {
				stats.failed += 1;
			}
		}
		if (Object.keys(updates).length === 0) {
			stats.skipped += 1;
			continue;
		}
		if (apply) {
			await db
				.update(personGeneration)
				.set(updates)
				.where(eq(personGeneration.id, row.id));
		}
	}
}

async function migrateStudioRuns(stats: MigrationStats) {
	const rows = await db
		.select({
			id: studioRun.id,
			inputImageUrl: studioRun.inputImageUrl,
		})
		.from(studioRun);
	await migrateTextColumn(
		rows,
		"inputImageUrl",
		"studio-run",
		(id, value) =>
			db
				.update(studioRun)
				.set({ inputImageUrl: value })
				.where(eq(studioRun.id, id))
				.then(() => undefined),
		stats
	);
}

async function migrateStudioArtifacts(stats: MigrationStats) {
	const rows = await db
		.select({ id: studioArtifact.id, url: studioArtifact.url })
		.from(studioArtifact);
	await migrateTextColumn(
		rows,
		"url",
		"studio-artifact",
		(id, value) =>
			db
				.update(studioArtifact)
				.set({ url: value })
				.where(eq(studioArtifact.id, id))
				.then(() => undefined),
		stats
	);
}

const sections: Array<{
	name: string;
	run: (stats: MigrationStats) => Promise<void>;
}> = [
	{ name: "generator_execution", run: migrateGeneratorExecutions },
	{ name: "person", run: migratePersons },
	{ name: "person_generation", run: migratePersonGenerations },
	{ name: "studio_run", run: migrateStudioRuns },
	{ name: "studio_artifact", run: migrateStudioArtifacts },
];

console.info(`migrate-external-artifacts: mode=${apply ? "apply" : "dry-run"}`);
console.info(`migrate-external-artifacts: bucket=${config.bucket}`);

let totalFailed = 0;
for (const section of sections) {
	const stats = createStats();
	console.info(`-- ${section.name}: starting --`);
	await section.run(stats);
	console.info(
		`-- ${section.name}: scanned=${stats.scanned} rewritten=${stats.rewritten} skipped=${stats.skipped} failed=${stats.failed} --`
	);
	totalFailed += stats.failed;
}

if (totalFailed > 0) {
	console.error(`migrate-external-artifacts: ${totalFailed} row(s) failed`);
	process.exit(1);
}

console.info("migrate-external-artifacts: done");
