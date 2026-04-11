import { relations } from "drizzle-orm";
import {
	bigint,
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

export const assetReleaseGroupEnum = pgEnum("asset_release_group", [
	"checkpoints",
	"models",
	"loras",
	"vae",
	"workflows",
]);

export const assetReleaseStatusEnum = pgEnum("asset_release_status", [
	"distributing",
	"ready",
	"degraded",
	"failed",
]);

export const volumeDistributionStatusEnum = pgEnum(
	"volume_distribution_status",
	["queued", "syncing", "verifying", "succeeded", "failed"]
);

export const assetRelease = pgTable(
	"asset_release",
	{
		id: text("id").primaryKey(),
		label: text("label").notNull(),
		group: assetReleaseGroupEnum("group").notNull(),
		status: assetReleaseStatusEnum("status").notNull().default("distributing"),
		storagePrefix: text("storage_prefix").notNull(),
		bucket: text("bucket").notNull(),
		filesTotal: bigint("files_total", { mode: "number" }).notNull().default(0),
		bytesTotal: bigint("bytes_total", { mode: "number" }).notNull().default(0),
		errorSummary: text("error_summary"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		completedAt: timestamp("completed_at"),
	},
	(table) => [
		index("asset_release_status_idx").on(table.status),
		index("asset_release_created_at_idx").on(table.createdAt),
	]
);

export const assetReleaseItem = pgTable(
	"asset_release_item",
	{
		id: text("id").primaryKey(),
		releaseId: text("release_id")
			.notNull()
			.references(() => assetRelease.id, { onDelete: "cascade" }),
		fileName: text("file_name").notNull(),
		contentType: text("content_type").notNull(),
		sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
		storageKey: text("storage_key").notNull(),
		targetRelativePath: text("target_relative_path").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("asset_release_item_release_id_idx").on(table.releaseId),
		index("asset_release_item_storage_key_idx").on(table.storageKey),
	]
);

export const volumeDistributionJob = pgTable(
	"volume_distribution_job",
	{
		id: text("id").primaryKey(),
		releaseId: text("release_id")
			.notNull()
			.references(() => assetRelease.id, { onDelete: "cascade" }),
		volumeId: text("volume_id").notNull(),
		volumeName: text("volume_name"),
		region: text("region"),
		status: volumeDistributionStatusEnum("status").notNull().default("queued"),
		podId: text("pod_id"),
		progressKey: text("progress_key").notNull(),
		filesTotal: bigint("files_total", { mode: "number" }).notNull().default(0),
		filesSynced: bigint("files_synced", { mode: "number" })
			.notNull()
			.default(0),
		bytesTotal: bigint("bytes_total", { mode: "number" }).notNull().default(0),
		bytesSynced: bigint("bytes_synced", { mode: "number" })
			.notNull()
			.default(0),
		errorSummary: text("error_summary"),
		lastHeartbeatAt: timestamp("last_heartbeat_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		completedAt: timestamp("completed_at"),
	},
	(table) => [
		index("volume_distribution_job_release_id_idx").on(table.releaseId),
		index("volume_distribution_job_status_idx").on(table.status),
		index("volume_distribution_job_volume_id_idx").on(table.volumeId),
	]
);

export const assetReleaseRelations = relations(assetRelease, ({ many }) => ({
	items: many(assetReleaseItem),
	jobs: many(volumeDistributionJob),
}));

export const assetReleaseItemRelations = relations(
	assetReleaseItem,
	({ one }) => ({
		release: one(assetRelease, {
			fields: [assetReleaseItem.releaseId],
			references: [assetRelease.id],
		}),
	})
);

export const volumeDistributionJobRelations = relations(
	volumeDistributionJob,
	({ one }) => ({
		release: one(assetRelease, {
			fields: [volumeDistributionJob.releaseId],
			references: [assetRelease.id],
		}),
	})
);
