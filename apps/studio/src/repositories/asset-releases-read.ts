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
	AssetReleaseReadRepository,
	AssetReleaseRecord,
	VolumeDistributionJobRecord,
} from "@/domain/asset-releases-read";

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
	return {
		fileName: record.fileName,
		id: record.id,
		sizeBytes: record.sizeBytes,
		targetRelativePath: record.targetRelativePath,
	};
}

function mapVolumeDistributionJob(
	record: typeof volumeDistributionJob.$inferSelect
): VolumeDistributionJobRecord {
	return {
		bytesSynced: record.bytesSynced,
		bytesTotal: record.bytesTotal,
		errorSummary: record.errorSummary,
		filesSynced: record.filesSynced,
		filesTotal: record.filesTotal,
		id: record.id,
		lastHeartbeatAt: record.lastHeartbeatAt,
		podId: record.podId,
		region: record.region,
		status: record.status,
		updatedAt: record.updatedAt,
		volumeId: record.volumeId,
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

export function createDrizzleAssetReleaseReadRepository(
	database: AssetDatabase = db
): AssetReleaseReadRepository {
	return {
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
	};
}
