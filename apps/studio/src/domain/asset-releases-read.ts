import type {
	AssetReleaseSnapshot,
	AssetReleaseStatus,
	VolumeDistributionStatus,
} from "@generator/contracts/admin";

export interface AssetReleaseRecord {
	bytesTotal: number;
	completedAt: Date | null;
	createdAt: Date;
	errorSummary: string | null;
	filesTotal: number;
	group: AssetReleaseSnapshot["group"];
	id: string;
	label: string;
	status: AssetReleaseStatus;
}

export interface AssetReleaseItemRecord {
	fileName: string;
	id: string;
	sizeBytes: number;
	targetRelativePath: string;
}

export interface VolumeDistributionJobRecord {
	bytesSynced: number;
	bytesTotal: number;
	errorSummary: string | null;
	filesSynced: number;
	filesTotal: number;
	id: string;
	lastHeartbeatAt: Date | null;
	podId: string | null;
	region: string | null;
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

export interface AssetReleaseReadRepository {
	getAssetReleaseById(
		releaseId: string
	): Promise<AssetReleaseDetailsRecord | null>;
	listAssetReleases(limit: number): Promise<AssetReleaseDetailsRecord[]>;
}

function getJobProgress(job: VolumeDistributionJobRecord) {
	switch (job.status) {
		case "queued":
			return 0;
		case "syncing":
			if (job.bytesTotal <= 0) {
				return 0.2;
			}

			return Math.min(0.85, 0.1 + 0.75 * (job.bytesSynced / job.bytesTotal));
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

export class AssetReleaseReadService {
	private readonly repository: AssetReleaseReadRepository;

	constructor(repository: AssetReleaseReadRepository) {
		this.repository = repository;
	}

	async listReleases(limit: number) {
		return (await this.repository.listAssetReleases(limit)).map(toSnapshot);
	}

	async getReleaseById(releaseId: string) {
		const release = await this.repository.getAssetReleaseById(releaseId);
		return release ? toSnapshot(release) : null;
	}
}
