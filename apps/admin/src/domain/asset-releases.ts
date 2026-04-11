import type {
	AssetReleaseGroup,
	AssetReleaseSnapshot,
	AssetReleaseStatus,
	VolumeDistributionStatus,
} from "@generator/contracts/admin";
import { z } from "zod";

export const assetReleaseGroupSchema = z.enum([
	"checkpoints",
	"models",
	"loras",
	"vae",
	"workflows",
]);

export const assetReleaseStatusSchema = z.enum([
	"distributing",
	"ready",
	"degraded",
	"failed",
]);

export const volumeDistributionStatusSchema = z.enum([
	"queued",
	"syncing",
	"verifying",
	"succeeded",
	"failed",
]);

export const createAssetReleaseInputSchema = z.object({
	group: assetReleaseGroupSchema,
	label: z.string().trim().min(1, "Release label is required"),
});

export interface AssetReleaseRecord {
	bucket: string;
	bytesTotal: number;
	completedAt: Date | null;
	createdAt: Date;
	errorSummary: string | null;
	filesTotal: number;
	group: AssetReleaseGroup;
	id: string;
	label: string;
	status: AssetReleaseStatus;
	storagePrefix: string;
	updatedAt: Date;
}

export interface AssetReleaseItemRecord {
	contentType: string;
	createdAt: Date;
	fileName: string;
	id: string;
	releaseId: string;
	sizeBytes: number;
	storageKey: string;
	targetRelativePath: string;
}

export interface VolumeDistributionJobRecord {
	bytesSynced: number;
	bytesTotal: number;
	completedAt: Date | null;
	createdAt: Date;
	errorSummary: string | null;
	filesSynced: number;
	filesTotal: number;
	id: string;
	lastHeartbeatAt: Date | null;
	podId: string | null;
	progressKey: string;
	region: string | null;
	releaseId: string;
	status: VolumeDistributionStatus;
	updatedAt: Date;
	volumeId: string;
	volumeName: string | null;
}

export interface AssetReleaseDetailsRecord {
	items: AssetReleaseItemRecord[];
	jobs: VolumeDistributionJobRecord[];
	release: AssetReleaseRecord;
}

export type {
	AssetReleaseGroup,
	AssetReleaseItemSnapshot,
	AssetReleasePreset,
	AssetReleaseSnapshot,
	AssetReleaseStatus,
	VolumeDistributionJobSnapshot,
	VolumeDistributionStatus,
} from "@generator/contracts/admin";

export interface AssetReleaseRepository {
	createAssetRelease(
		input: Omit<AssetReleaseRecord, "createdAt" | "updatedAt" | "completedAt">
	): Promise<AssetReleaseRecord>;
	createAssetReleaseItems(
		items: Omit<AssetReleaseItemRecord, "createdAt">[]
	): Promise<AssetReleaseItemRecord[]>;
	createVolumeDistributionJobs(
		jobs: Omit<
			VolumeDistributionJobRecord,
			"createdAt" | "updatedAt" | "completedAt" | "lastHeartbeatAt"
		>[]
	): Promise<VolumeDistributionJobRecord[]>;
	getAssetReleaseById(
		releaseId: string
	): Promise<AssetReleaseDetailsRecord | null>;
	listAssetReleases(limit: number): Promise<AssetReleaseDetailsRecord[]>;
	updateAssetRelease(
		releaseId: string,
		input: Partial<
			Pick<AssetReleaseRecord, "completedAt" | "errorSummary" | "status">
		>
	): Promise<AssetReleaseRecord | null>;
	updateVolumeDistributionJob(
		jobId: string,
		input: Partial<
			Pick<
				VolumeDistributionJobRecord,
				| "bytesSynced"
				| "completedAt"
				| "errorSummary"
				| "filesSynced"
				| "lastHeartbeatAt"
				| "podId"
				| "status"
			>
		>
	): Promise<VolumeDistributionJobRecord | null>;
}

export interface AssetStorageObjectWrite {
	body: ArrayBuffer | Blob | Uint8Array | string;
	key: string;
}

export interface AssetStorage {
	readJson<T>(key: string): Promise<T | null>;
	writeJson(key: string, payload: unknown): Promise<void>;
	writeObject(input: AssetStorageObjectWrite): Promise<void>;
}

export interface VolumeSyncLaunchRequest {
	items: AssetReleaseItemRecord[];
	job: VolumeDistributionJobRecord;
	release: AssetReleaseRecord;
}

export interface VolumeSyncLauncher {
	launchJob(input: VolumeSyncLaunchRequest): Promise<{ podId: string }>;
}

interface VolumeSyncProgressMarker {
	bytesSynced: number;
	bytesTotal: number;
	errorSummary?: string | null;
	filesSynced: number;
	filesTotal: number;
	status: VolumeDistributionStatus;
	updatedAt: string;
}

const TERMINAL_JOB_STATUSES = new Set<VolumeDistributionStatus>([
	"succeeded",
	"failed",
]);

function createStoragePrefix(group: AssetReleaseGroup, releaseId: string) {
	return `admin-releases/${group}/${releaseId}`;
}

function createTargetRelativePath(group: AssetReleaseGroup, fileName: string) {
	switch (group) {
		case "checkpoints":
			return `models/checkpoints/${fileName}`;
		case "loras":
			return `models/loras/${fileName}`;
		case "models":
			return `models/${fileName}`;
		case "vae":
			return `models/vae/${fileName}`;
		case "workflows":
			return `workflows/${fileName}`;
		default:
			return `${group}/${fileName}`;
	}
}

function getJobProgress(job: VolumeDistributionJobRecord) {
	switch (job.status) {
		case "queued":
			return 0;
		case "syncing": {
			if (job.bytesTotal <= 0) {
				return 0.2;
			}

			return Math.min(0.85, 0.1 + 0.75 * (job.bytesSynced / job.bytesTotal));
		}
		case "verifying":
			return 0.95;
		case "succeeded":
		case "failed":
			return 1;
		default:
			return 0;
	}
}

function toSnapshot(details: AssetReleaseDetailsRecord): AssetReleaseSnapshot {
	const jobs = details.jobs.map((job) => ({
		bytesSynced: job.bytesSynced,
		bytesTotal: job.bytesTotal,
		errorSummary: job.errorSummary,
		filesSynced: job.filesSynced,
		filesTotal: job.filesTotal,
		id: job.id,
		lastHeartbeatAt: job.lastHeartbeatAt?.toISOString() ?? null,
		podId: job.podId,
		progressPct: Math.round(getJobProgress(job) * 100),
		region: job.region,
		status: job.status,
		updatedAt: job.updatedAt.toISOString(),
		volumeId: job.volumeId,
		volumeName: job.volumeName,
	}));
	const volumesReady = jobs.filter((job) => job.status === "succeeded").length;
	const volumesFailed = jobs.filter((job) => job.status === "failed").length;
	const volumesTotal = jobs.length;
	const totalJobProgress =
		volumesTotal === 0
			? 1
			: details.jobs.reduce((total, job) => total + getJobProgress(job), 0) /
				volumesTotal;

	return {
		bytesTotal: details.release.bytesTotal,
		completedAt: details.release.completedAt?.toISOString() ?? null,
		createdAt: details.release.createdAt.toISOString(),
		errorSummary: details.release.errorSummary,
		filesTotal: details.release.filesTotal,
		group: details.release.group,
		id: details.release.id,
		items: details.items.map((item) => ({
			fileName: item.fileName,
			id: item.id,
			sizeBytes: item.sizeBytes,
			targetRelativePath: item.targetRelativePath,
		})),
		jobs,
		label: details.release.label,
		progressPct: Math.round(totalJobProgress * 100),
		status: details.release.status,
		volumesFailed,
		volumesReady,
		volumesTotal,
	};
}

export class AssetReleaseService {
	private readonly repository: AssetReleaseRepository;
	private readonly storage: AssetStorage;
	private readonly syncLauncher: VolumeSyncLauncher;
	private readonly storageBucket: string;
	private readonly volumes: Array<{
		id: string;
		label?: string;
		networkVolumeId?: string;
		region?: string;
	}>;

	constructor(
		repository: AssetReleaseRepository,
		storage: AssetStorage,
		syncLauncher: VolumeSyncLauncher,
		storageBucket: string,
		volumes: Array<{
			id: string;
			label?: string;
			networkVolumeId?: string;
			region?: string;
		}>
	) {
		this.repository = repository;
		this.storage = storage;
		this.syncLauncher = syncLauncher;
		this.storageBucket = storageBucket;
		this.volumes = volumes;
	}

	async createRelease(input: {
		files: File[];
		group: AssetReleaseGroup;
		label: string;
	}) {
		const parsed = createAssetReleaseInputSchema.parse({
			group: input.group,
			label: input.label,
		});

		if (input.files.length === 0) {
			throw new Error("Select at least one file to create a release.");
		}

		const releaseId = crypto.randomUUID();
		const storagePrefix = createStoragePrefix(parsed.group, releaseId);
		const itemsToInsert: Omit<AssetReleaseItemRecord, "createdAt">[] = [];
		let bytesTotal = 0;

		for (const file of input.files) {
			const fileName = file.name.trim();

			if (!fileName) {
				throw new Error("Every uploaded file must have a name.");
			}

			const storageKey = `${storagePrefix}/${fileName}`;
			const body = await file.arrayBuffer();
			await this.storage.writeObject({
				body,
				key: storageKey,
			});

			bytesTotal += file.size;
			itemsToInsert.push({
				contentType: file.type || "application/octet-stream",
				fileName,
				id: crypto.randomUUID(),
				releaseId,
				sizeBytes: file.size,
				storageKey,
				targetRelativePath: createTargetRelativePath(parsed.group, fileName),
			});
		}

		const release = await this.repository.createAssetRelease({
			bucket: this.storageBucket,
			bytesTotal,
			errorSummary: null,
			filesTotal: itemsToInsert.length,
			group: parsed.group,
			id: releaseId,
			label: parsed.label,
			status: "distributing",
			storagePrefix,
		});
		const items = await this.repository.createAssetReleaseItems(itemsToInsert);

		const jobs = await this.repository.createVolumeDistributionJobs(
			this.volumes.map((volume) => ({
				bytesSynced: 0,
				bytesTotal,
				errorSummary: null,
				filesSynced: 0,
				filesTotal: items.length,
				id: crypto.randomUUID(),
				podId: null,
				progressKey: `${storagePrefix}/status/${volume.id}.json`,
				region: volume.region ?? null,
				releaseId,
				status: "queued",
				volumeId: volume.networkVolumeId ?? volume.id,
				volumeName: volume.label ?? volume.region ?? volume.id,
			}))
		);

		for (const job of jobs) {
			const launchResult = await this.syncLauncher.launchJob({
				items,
				job,
				release,
			});
			await this.repository.updateVolumeDistributionJob(job.id, {
				lastHeartbeatAt: new Date(),
				podId: launchResult.podId,
				status: "syncing",
			});
		}

		const details = await this.repository.getAssetReleaseById(releaseId);
		if (!details) {
			throw new Error("Failed to load created asset release.");
		}

		return toSnapshot(details);
	}

	async listReleases(limit: number) {
		await this.refreshReleaseProgress();
		return (await this.repository.listAssetReleases(limit)).map(toSnapshot);
	}

	async getReleaseById(releaseId: string) {
		await this.refreshReleaseProgress();
		const release = await this.repository.getAssetReleaseById(releaseId);
		return release ? toSnapshot(release) : null;
	}

	private async refreshReleaseProgress() {
		const releases = await this.repository.listAssetReleases(20);

		await Promise.all(
			releases.flatMap((release) =>
				release.jobs.map(async (job) => {
					if (!(job.podId && !TERMINAL_JOB_STATUSES.has(job.status))) {
						return;
					}

					const marker = await this.storage.readJson<VolumeSyncProgressMarker>(
						job.progressKey
					);
					if (!marker) {
						return;
					}

					await this.repository.updateVolumeDistributionJob(job.id, {
						bytesSynced: marker.bytesSynced,
						completedAt:
							marker.status === "succeeded" || marker.status === "failed"
								? new Date()
								: undefined,
						errorSummary: marker.errorSummary ?? null,
						filesSynced: marker.filesSynced,
						lastHeartbeatAt: new Date(marker.updatedAt),
						status: marker.status,
					});
				})
			)
		);

		const refreshed = await this.repository.listAssetReleases(20);
		for (const release of refreshed) {
			const completedJobs = release.jobs.filter((job) =>
				TERMINAL_JOB_STATUSES.has(job.status)
			);
			if (
				completedJobs.length === release.jobs.length &&
				release.jobs.length > 0
			) {
				const hasFailure = completedJobs.some((job) => job.status === "failed");
				const hasAllSucceeded = completedJobs.every(
					(job) => job.status === "succeeded"
				);
				let nextStatus: AssetReleaseStatus = "degraded";
				if (hasFailure) {
					nextStatus = "failed";
				} else if (hasAllSucceeded) {
					nextStatus = "ready";
				}

				if (release.release.status !== nextStatus) {
					await this.repository.updateAssetRelease(release.release.id, {
						completedAt: new Date(),
						errorSummary: hasFailure
							? (completedJobs.find((job) => job.errorSummary)?.errorSummary ??
								null)
							: null,
						status: nextStatus,
					});
				}
			}
		}
	}
}
