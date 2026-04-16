import { db } from "@generator/db";
import { desc, eq } from "@generator/db/operators";
import {
	assetRelease,
	assetReleaseItem,
	volumeDistributionJob,
} from "@generator/db/schema/assets";

import type {
	AssetReleaseDetailsRecord,
	AssetReleaseItemRecord,
	AssetReleaseRecord,
	AssetReleaseRepository,
	VolumeDistributionJobRecord,
} from "@/domain/asset-releases";

type AssetDatabase = typeof db;

function mapAssetRelease(
	record: typeof assetRelease.$inferSelect
): AssetReleaseRecord {
	return {
		...record,
		completedAt: record.completedAt,
		errorSummary: record.errorSummary,
	};
}

function mapAssetReleaseItem(
	record: typeof assetReleaseItem.$inferSelect
): AssetReleaseItemRecord {
	return record;
}

function mapVolumeDistributionJob(
	record: typeof volumeDistributionJob.$inferSelect
): VolumeDistributionJobRecord {
	return {
		...record,
		completedAt: record.completedAt,
		errorSummary: record.errorSummary,
		lastHeartbeatAt: record.lastHeartbeatAt,
		podId: record.podId,
		region: record.region,
		volumeName: record.volumeName,
	};
}

async function loadReleaseDetails(
	database: AssetDatabase,
	releaseRow: typeof assetRelease.$inferSelect
): Promise<AssetReleaseDetailsRecord> {
	const [itemRows, jobRows] = await Promise.all([
		database
			.select()
			.from(assetReleaseItem)
			.where(eq(assetReleaseItem.releaseId, releaseRow.id)),
		database
			.select()
			.from(volumeDistributionJob)
			.where(eq(volumeDistributionJob.releaseId, releaseRow.id))
			.orderBy(volumeDistributionJob.createdAt),
	]);

	return {
		items: itemRows.map(mapAssetReleaseItem),
		jobs: jobRows.map(mapVolumeDistributionJob),
		release: mapAssetRelease(releaseRow),
	};
}

export function createDrizzleAssetReleaseRepository(
	database: AssetDatabase = db
): AssetReleaseRepository {
	return {
		async createAssetRelease(input) {
			const [row] = await database
				.insert(assetRelease)
				.values(input)
				.returning();
			if (!row) {
				throw new Error("Failed to create asset release.");
			}
			return mapAssetRelease(row);
		},
		async createAssetReleaseItems(items) {
			if (items.length === 0) {
				return [];
			}
			const rows = await database
				.insert(assetReleaseItem)
				.values(items)
				.returning();
			return rows.map(mapAssetReleaseItem);
		},
		async createVolumeDistributionJobs(jobs) {
			if (jobs.length === 0) {
				return [];
			}
			const rows = await database
				.insert(volumeDistributionJob)
				.values(jobs)
				.returning();
			return rows.map(mapVolumeDistributionJob);
		},
		async getAssetReleaseById(releaseId) {
			const [row] = await database
				.select()
				.from(assetRelease)
				.where(eq(assetRelease.id, releaseId));
			return row ? loadReleaseDetails(database, row) : null;
		},
		async listAssetReleases(limit) {
			const rows = await database
				.select()
				.from(assetRelease)
				.orderBy(desc(assetRelease.createdAt))
				.limit(limit);

			return Promise.all(rows.map((row) => loadReleaseDetails(database, row)));
		},
		async updateAssetRelease(releaseId, input) {
			const [row] = await database
				.update(assetRelease)
				.set(input)
				.where(eq(assetRelease.id, releaseId))
				.returning();
			return row ? mapAssetRelease(row) : null;
		},
		async updateVolumeDistributionJob(jobId, input) {
			const [row] = await database
				.update(volumeDistributionJob)
				.set(input)
				.where(eq(volumeDistributionJob.id, jobId))
				.returning();
			return row ? mapVolumeDistributionJob(row) : null;
		},
	};
}
