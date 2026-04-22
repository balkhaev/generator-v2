"use client";

import type {
	StorageCategorySummary,
	StorageHealthSnapshot,
	StorageObjectSummary,
	StorageOrphanDeleteResponse,
	StorageOrphanScanResponse,
	StorageOverviewSnapshot,
} from "@generator/contracts/admin";
import { Button, buttonVariants } from "@generator/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@generator/ui/components/card";
import { EmptyState } from "@generator/ui/components/empty-state";
import { Input } from "@generator/ui/components/input";
import { PageHeader } from "@generator/ui/components/page-header";
import { formatBytes, formatDateTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import {
	CheckCircle2,
	Clipboard,
	ExternalLink,
	HardDrive,
	Link2,
	Loader2,
	RefreshCw,
	ShieldAlert,
	Trash2,
	Upload,
} from "lucide-react";
import { useId, useMemo, useState } from "react";

import {
	useCreateStoragePresignedUpload,
	useDeleteStorageObject,
	useDeleteStorageOrphans,
	useScanStorageOrphans,
	useStorageHealthCheck,
	useStorageObjects,
	useStorageOverview,
	useUploadStorageObject,
} from "@/hooks/use-storage";

const OBJECT_PAGE_SIZE = 100;
const DEFAULT_CLEANUP_PREFIXES =
	"admin-uploads/, datasets/, generator-artifacts/, loras/, persons-inputs/, studio-inputs/";
const cleanupPrefixSplitPattern = /[,\n]/u;
const safeFileNamePattern = /[^a-z0-9._-]+/gu;
const trimDashPattern = /^-+|-+$/gu;

function buildDefaultUploadKey(file: File): string {
	const safeName =
		file.name
			.toLowerCase()
			.replace(safeFileNamePattern, "-")
			.replace(trimDashPattern, "")
			.slice(0, 96) || "object.bin";
	const date = new Date().toISOString().slice(0, 10);
	return `admin-uploads/${date}/${crypto.randomUUID()}-${safeName}`;
}

function copyText(value: string) {
	navigator.clipboard?.writeText(value).catch(() => {
		// Clipboard permission is browser-dependent; the visible URL remains copyable.
	});
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Request failed";
}

function parsePrefixes(value: string): string[] {
	return value
		.split(cleanupPrefixSplitPattern)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

export default function StorageContent({
	initialOverview,
}: {
	initialOverview: StorageOverviewSnapshot | null;
}) {
	const overviewQuery = useStorageOverview(initialOverview);
	const overview = overviewQuery.data ?? initialOverview;
	const [prefix, setPrefix] = useState("");
	const [cursor, setCursor] = useState<string | undefined>();
	const [cursorHistory, setCursorHistory] = useState<string[]>([]);
	const objectsQueryInput = useMemo(
		() => ({ cursor, maxKeys: OBJECT_PAGE_SIZE, prefix }),
		[cursor, prefix]
	);
	const objectsQuery = useStorageObjects(
		objectsQueryInput,
		Boolean(overview?.config.configured)
	);
	const health = useStorageHealthCheck();

	function selectPrefix(nextPrefix: string) {
		setPrefix(nextPrefix);
		setCursor(undefined);
		setCursorHistory([]);
	}

	function refresh() {
		overviewQuery.refetch();
		objectsQuery.refetch();
	}

	return (
		<div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
			<PageHeader
				actions={
					<>
						<Button
							disabled={health.isPending || !overview?.config.configured}
							onClick={() => health.mutate()}
							size="sm"
							type="button"
							variant="outline"
						>
							{health.isPending ? (
								<Loader2 className="animate-spin" data-icon="inline-start" />
							) : (
								<CheckCircle2 data-icon="inline-start" />
							)}
							Check
						</Button>
						<Button
							disabled={overviewQuery.isFetching || objectsQuery.isFetching}
							onClick={refresh}
							size="sm"
							type="button"
							variant="outline"
						>
							<RefreshCw
								className={cn(
									overviewQuery.isFetching || objectsQuery.isFetching
										? "animate-spin"
										: ""
								)}
								data-icon="inline-start"
							/>
							Refresh
						</Button>
					</>
				}
				description="Browse, upload, sign, and remove objects in the configured S3-compatible bucket."
				eyebrow="Admin"
				title="Storage"
			/>

			<div className="min-h-0 overflow-y-auto px-4 py-4">
				{overview ? (
					<div className="mx-auto grid w-full max-w-7xl gap-4">
						<StorageConfigCard
							health={health.data ?? null}
							isChecking={health.isPending}
							onCheck={() => health.mutate()}
							overview={overview}
						/>

						{overview.config.configured ? (
							<>
								<StorageBrowser
									categories={overview.categories}
									cursor={cursor}
									cursorHistory={cursorHistory}
									isFetching={objectsQuery.isFetching}
									isLoading={objectsQuery.isLoading}
									list={objectsQuery.data ?? null}
									onBack={() => {
										const previous = cursorHistory.at(-1);
										setCursor(previous);
										setCursorHistory((history) => history.slice(0, -1));
									}}
									onNext={() => {
										if (objectsQuery.data?.nextCursor) {
											setCursorHistory((history) => [...history, cursor ?? ""]);
											setCursor(objectsQuery.data.nextCursor);
										}
									}}
									onPrefixChange={selectPrefix}
									prefix={prefix}
								/>
								<StorageCleanupCard currentPrefix={prefix} />
								<div className="grid gap-4 lg:grid-cols-2">
									<StorageUploadCard currentPrefix={prefix} />
									<PresignedUploadCard currentPrefix={prefix} />
								</div>
							</>
						) : (
							<EmptyState
								hint={overview.config.missing.join(", ")}
								icon={ShieldAlert}
								message="S3 is not configured for admin-api"
							/>
						)}
					</div>
				) : (
					<EmptyState
						hint="Make sure the admin gateway is reachable and you are signed in."
						icon={HardDrive}
						message="Storage unavailable"
					/>
				)}
			</div>
		</div>
	);
}

function StorageCleanupCard({ currentPrefix }: { currentPrefix: string }) {
	const scanMutation = useScanStorageOrphans();
	const deleteMutation = useDeleteStorageOrphans();
	const [minimumAgeHours, setMinimumAgeHours] = useState("24");
	const [maxPages, setMaxPages] = useState("20");
	const [prefixes, setPrefixes] = useState(DEFAULT_CLEANUP_PREFIXES);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const ageInputId = useId();
	const maxPagesInputId = useId();
	const prefixesInputId = useId();
	const scanResult = scanMutation.data ?? null;
	const scannedObjects = scanResult?.objects ?? [];

	function scan() {
		setConfirmingDelete(false);
		scanMutation.mutate({
			maxKeys: OBJECT_PAGE_SIZE,
			maxPages: Number(maxPages),
			minimumAgeHours: Number(minimumAgeHours),
			prefixes: parsePrefixes(prefixes),
		});
	}

	function deleteListed() {
		if (!scanMutation.data) {
			return;
		}
		deleteMutation.mutate({
			keys: scanMutation.data.objects.map((object) => object.key),
			maxKeys: OBJECT_PAGE_SIZE,
			maxPages: Number(maxPages),
			minimumAgeHours: scanMutation.data.minimumAgeHours,
			prefixes: scanMutation.data.prefixes,
		});
		setConfirmingDelete(false);
	}

	return (
		<Card size="sm">
			<CardHeader>
				<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
					<div className="grid gap-1">
						<CardTitle>Orphan cleanup</CardTitle>
						<CardDescription>
							Dry-run scans app-owned prefixes, compares objects with DB
							references, and protects recent uploads.
						</CardDescription>
					</div>
					{scanMutation.data ? (
						<StatusPill
							tone={scanMutation.data.orphanCount > 0 ? "warning" : "success"}
							value={`${scanMutation.data.orphanCount} orphan${scanMutation.data.orphanCount === 1 ? "" : "s"}`}
						/>
					) : null}
				</div>
			</CardHeader>
			<CardContent>
				<div className="grid gap-3">
					<div className="grid gap-3 lg:grid-cols-[120px_120px_minmax(0,1fr)_auto]">
						<label className="grid gap-1" htmlFor={ageInputId}>
							<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
								Min age h
							</span>
							<Input
								id={ageInputId}
								inputMode="numeric"
								onChange={(event) => setMinimumAgeHours(event.target.value)}
								value={minimumAgeHours}
							/>
						</label>
						<label className="grid gap-1" htmlFor={maxPagesInputId}>
							<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
								Max pages
							</span>
							<Input
								id={maxPagesInputId}
								inputMode="numeric"
								onChange={(event) => setMaxPages(event.target.value)}
								value={maxPages}
							/>
						</label>
						<label className="grid gap-1" htmlFor={prefixesInputId}>
							<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
								Prefixes
							</span>
							<Input
								className="font-mono"
								id={prefixesInputId}
								onChange={(event) => setPrefixes(event.target.value)}
								value={prefixes}
							/>
						</label>
						<div className="flex items-end gap-2">
							<Button
								disabled={scanMutation.isPending}
								onClick={scan}
								type="button"
								variant="outline"
							>
								{scanMutation.isPending ? (
									<Loader2 className="animate-spin" data-icon="inline-start" />
								) : (
									<RefreshCw data-icon="inline-start" />
								)}
								Scan
							</Button>
							<Button
								disabled={!currentPrefix}
								onClick={() => setPrefixes(currentPrefix)}
								type="button"
								variant="ghost"
							>
								Current
							</Button>
						</div>
					</div>

					{scanMutation.data ? (
						<StorageCleanupSummary scan={scanMutation.data} />
					) : null}

					<StorageCleanupDeletePanel
						confirmingDelete={confirmingDelete}
						isDeleting={deleteMutation.isPending}
						isScanning={scanMutation.isPending}
						objects={scannedObjects}
						onCancel={() => setConfirmingDelete(false)}
						onConfirm={deleteListed}
						onRequestConfirm={() => setConfirmingDelete(true)}
					/>

					{deleteMutation.data ? (
						<StorageCleanupDeleteResult result={deleteMutation.data} />
					) : null}

					{(scanMutation.error ?? deleteMutation.error) ? (
						<p className="text-destructive text-xs">
							{getErrorMessage(scanMutation.error ?? deleteMutation.error)}
						</p>
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}

function StorageCleanupDeletePanel({
	confirmingDelete,
	isDeleting,
	isScanning,
	objects,
	onCancel,
	onConfirm,
	onRequestConfirm,
}: {
	confirmingDelete: boolean;
	isDeleting: boolean;
	isScanning: boolean;
	objects: StorageObjectSummary[];
	onCancel: () => void;
	onConfirm: () => void;
	onRequestConfirm: () => void;
}) {
	if (objects.length === 0) {
		return null;
	}
	const canDelete = !(isScanning || isDeleting);
	return (
		<div className="grid gap-2">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<p className="text-muted-foreground text-xs">
					Delete rechecks DB references before removing each object.
				</p>
				{confirmingDelete ? (
					<div className="flex items-center gap-2">
						<Button
							disabled={!canDelete}
							onClick={onConfirm}
							type="button"
							variant="destructive"
						>
							{isDeleting ? (
								<Loader2 className="animate-spin" data-icon="inline-start" />
							) : (
								<Trash2 data-icon="inline-start" />
							)}
							Delete
						</Button>
						<Button
							disabled={isDeleting}
							onClick={onCancel}
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
					</div>
				) : (
					<Button
						disabled={!canDelete}
						onClick={onRequestConfirm}
						type="button"
						variant="destructive"
					>
						<Trash2 data-icon="inline-start" />
						Delete listed
					</Button>
				)}
			</div>
			<StorageOrphanList objects={objects} />
		</div>
	);
}

function StorageCleanupDeleteResult({
	result,
}: {
	result: StorageOrphanDeleteResponse;
}) {
	return (
		<div className="grid gap-1 rounded-sm bg-muted/25 p-3 text-xs">
			<p className="font-medium">
				Deleted {result.deletedCount} objects ·{" "}
				{formatBytes(result.deletedSizeBytes)}
			</p>
			{result.skippedReferenced.length > 0 ? (
				<p className="text-muted-foreground">
					Skipped referenced: {result.skippedReferenced.length}
				</p>
			) : null}
			{result.failed.length > 0 ? (
				<p className="text-destructive">Failed: {result.failed.length}</p>
			) : null}
		</div>
	);
}

function StorageCleanupSummary({ scan }: { scan: StorageOrphanScanResponse }) {
	return (
		<div className="grid gap-2 rounded-sm bg-muted/25 p-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
			<SummaryMetric label="Scanned" value={String(scan.scannedCount)} />
			<SummaryMetric
				label="Referenced"
				value={String(scan.referencedKeyCount)}
			/>
			<SummaryMetric
				label="Orphan size"
				value={formatBytes(scan.orphanSizeBytes)}
			/>
			<SummaryMetric
				label="Protected"
				value={`${scan.protectedRecentCount} recent · ${scan.unknownAgeCount} unknown age`}
			/>
		</div>
	);
}

function StorageOrphanList({ objects }: { objects: StorageObjectSummary[] }) {
	return (
		<div className="grid max-h-80 gap-1.5 overflow-y-auto rounded-sm border border-foreground/10 p-2">
			{objects.map((object) => (
				<div
					className="grid gap-1 rounded-sm bg-background px-2 py-1.5"
					key={object.key}
				>
					<p className="break-all font-mono text-xs">{object.key}</p>
					<div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
						<span>{formatBytes(object.sizeBytes)}</span>
						<span>{object.category}</span>
						<span>
							{object.lastModified ? formatDateTime(object.lastModified) : "—"}
						</span>
					</div>
				</div>
			))}
		</div>
	);
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-0.5">
			<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
				{label}
			</span>
			<span className="font-medium">{value}</span>
		</div>
	);
}

function StorageConfigCard({
	health,
	isChecking,
	onCheck,
	overview,
}: {
	health: StorageHealthSnapshot | null;
	isChecking: boolean;
	onCheck: () => void;
	overview: StorageOverviewSnapshot;
}) {
	const config = overview.config;
	return (
		<Card size="sm">
			<CardHeader>
				<div className="flex items-start justify-between gap-4">
					<div className="grid gap-1">
						<CardTitle>S3 connection</CardTitle>
						<CardDescription>
							{config.configured
								? "Configured bucket and public asset base."
								: "Missing required admin-api environment values."}
						</CardDescription>
					</div>
					<StatusPill
						tone={config.configured ? "success" : "warning"}
						value={config.configured ? "Configured" : "Missing env"}
					/>
				</div>
			</CardHeader>
			<CardContent>
				<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
					<div className="grid gap-1">
						<ConfigRow label="Bucket" value={config.bucket ?? "—"} />
						<ConfigRow label="Region" value={config.region ?? "—"} />
						<ConfigRow label="Endpoint" value={config.endpoint ?? "—"} />
						<ConfigRow
							label="Public base"
							value={config.publicBaseUrl ?? "—"}
						/>
						<ConfigRow
							label="Credentials"
							value={
								config.accessKeyConfigured && config.secretAccessKeyConfigured
									? "present"
									: "missing"
							}
						/>
					</div>
					<div className="grid content-start gap-3 rounded-sm bg-muted/20 p-3">
						<div className="flex items-center justify-between gap-3">
							<div className="grid gap-0.5">
								<p className="font-medium text-sm">Health</p>
								<p className="text-muted-foreground text-xs">
									{health
										? `${health.latencyMs}ms · ${formatDateTime(health.checkedAt)}`
										: "Not checked"}
								</p>
							</div>
							<Button
								disabled={!config.configured || isChecking}
								onClick={onCheck}
								size="sm"
								type="button"
								variant="outline"
							>
								{isChecking ? (
									<Loader2 className="animate-spin" data-icon="inline-start" />
								) : (
									<CheckCircle2 data-icon="inline-start" />
								)}
								Check
							</Button>
						</div>
						{health ? (
							<div
								className={cn(
									"rounded-sm px-2 py-1.5 text-xs",
									health.ok
										? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
										: "bg-destructive/10 text-destructive"
								)}
							>
								{health.ok
									? `OK · ${health.sampleCount} sample object${health.sampleCount === 1 ? "" : "s"}`
									: health.error}
							</div>
						) : null}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

function StorageBrowser({
	categories,
	cursor,
	cursorHistory,
	isFetching,
	isLoading,
	list,
	onBack,
	onNext,
	onPrefixChange,
	prefix,
}: {
	categories: StorageCategorySummary[];
	cursor: string | undefined;
	cursorHistory: string[];
	isFetching: boolean;
	isLoading: boolean;
	list: {
		isTruncated: boolean;
		nextCursor: string | null;
		objects: StorageObjectSummary[];
		scannedCount: number;
		totalSizeBytes: number;
	} | null;
	onBack: () => void;
	onNext: () => void;
	onPrefixChange: (prefix: string) => void;
	prefix: string;
}) {
	const selectedCategory =
		categories.find((category) => category.prefix === prefix)?.id ?? null;
	const objects = list?.objects ?? [];
	const prefixInputId = useId();

	return (
		<Card size="sm">
			<CardHeader>
				<div className="grid gap-3">
					<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
						<div className="grid gap-1">
							<CardTitle>Object browser</CardTitle>
							<CardDescription>
								{list
									? `${list.scannedCount} objects · ${formatBytes(list.totalSizeBytes)} on this page`
									: "Bucket listing"}
							</CardDescription>
						</div>
						<div className="flex items-center gap-2">
							<Button
								disabled={cursorHistory.length === 0 && !cursor}
								onClick={onBack}
								size="sm"
								type="button"
								variant="outline"
							>
								Back
							</Button>
							<Button
								disabled={!(list?.isTruncated && list.nextCursor)}
								onClick={onNext}
								size="sm"
								type="button"
								variant="outline"
							>
								Next
							</Button>
						</div>
					</div>
					<div className="flex flex-wrap gap-2">
						{categories.map((category) => (
							<Button
								key={category.id}
								onClick={() => onPrefixChange(category.prefix)}
								size="xs"
								type="button"
								variant={
									selectedCategory === category.id ? "default" : "outline"
								}
							>
								{category.label}
							</Button>
						))}
					</div>
					<label className="grid gap-1" htmlFor={prefixInputId}>
						<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
							Prefix
						</span>
						<Input
							className="font-mono"
							id={prefixInputId}
							onChange={(event) => onPrefixChange(event.target.value)}
							placeholder="generator-artifacts/"
							value={prefix}
						/>
					</label>
				</div>
			</CardHeader>
			<CardContent>
				<StorageBrowserBody
					isFetching={isFetching}
					isLoading={isLoading}
					objects={objects}
					prefix={prefix}
				/>
			</CardContent>
		</Card>
	);
}

function StorageBrowserBody({
	isFetching,
	isLoading,
	objects,
	prefix,
}: {
	isFetching: boolean;
	isLoading: boolean;
	objects: StorageObjectSummary[];
	prefix: string;
}) {
	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
				<Loader2 className="mr-2 size-4 animate-spin" />
				Loading…
			</div>
		);
	}

	if (objects.length === 0) {
		return (
			<EmptyState
				hint={prefix || "bucket root"}
				icon={HardDrive}
				message="No objects found"
			/>
		);
	}

	return (
		<div className="grid gap-1.5">
			{isFetching ? (
				<div className="text-muted-foreground text-xs">Refreshing…</div>
			) : null}
			{objects.map((object) => (
				<StorageObjectRow key={object.key} object={object} />
			))}
		</div>
	);
}

function StorageObjectRow({ object }: { object: StorageObjectSummary }) {
	const deleteMutation = useDeleteStorageObject();
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const isDeleting =
		deleteMutation.isPending && deleteMutation.variables === object.key;

	return (
		<div className="grid gap-3 rounded-sm border border-foreground/10 bg-background px-3 py-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
			<div className="min-w-0">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<p className="break-all font-mono text-xs">{object.key}</p>
					<StatusPill tone="neutral" value={object.category} />
				</div>
				<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
					<span>{formatBytes(object.sizeBytes)}</span>
					<span>{object.contentType ?? "application/octet-stream"}</span>
					<span>
						{object.lastModified ? formatDateTime(object.lastModified) : "—"}
					</span>
					{object.etag ? (
						<span className="font-mono">{object.etag}</span>
					) : null}
				</div>
				{deleteMutation.isError ? (
					<p className="mt-2 text-destructive text-xs">
						{getErrorMessage(deleteMutation.error)}
					</p>
				) : null}
			</div>
			<div className="flex flex-wrap items-center gap-1 lg:justify-end">
				<Button
					aria-label="Copy public URL"
					onClick={() => copyText(object.url)}
					size="icon-sm"
					type="button"
					variant="ghost"
				>
					<Clipboard />
				</Button>
				<a
					aria-label="Open public URL"
					className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
					href={object.url}
					rel="noopener"
					target="_blank"
				>
					<ExternalLink />
				</a>
				{confirmingDelete ? (
					<>
						<Button
							disabled={isDeleting}
							onClick={() => deleteMutation.mutate(object.key)}
							size="sm"
							type="button"
							variant="destructive"
						>
							{isDeleting ? (
								<Loader2 className="animate-spin" data-icon="inline-start" />
							) : (
								<Trash2 data-icon="inline-start" />
							)}
							Confirm
						</Button>
						<Button
							disabled={isDeleting}
							onClick={() => setConfirmingDelete(false)}
							size="sm"
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
					</>
				) : (
					<Button
						aria-label="Delete object"
						onClick={() => setConfirmingDelete(true)}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<Trash2 />
					</Button>
				)}
			</div>
		</div>
	);
}

function StorageUploadCard({ currentPrefix }: { currentPrefix: string }) {
	const uploadMutation = useUploadStorageObject();
	const [file, setFile] = useState<File | null>(null);
	const [key, setKey] = useState("");
	const [contentType, setContentType] = useState("");
	const fileInputId = useId();
	const keyInputId = useId();
	const contentTypeInputId = useId();

	function handleFileChange(files: FileList | null) {
		const selected = files?.item(0) ?? null;
		setFile(selected);
		if (selected && !key) {
			setKey(buildDefaultUploadKey(selected));
			setContentType(selected.type);
		}
	}

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle>Upload object</CardTitle>
				<CardDescription>
					Server-side upload through admin-api into the selected S3 bucket.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="grid gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						if (!file) {
							return;
						}
						uploadMutation.mutate({
							contentType: contentType.trim() || file.type,
							file,
							key: key.trim(),
						});
					}}
				>
					<label className="grid gap-1" htmlFor={fileInputId}>
						<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
							File
						</span>
						<Input
							id={fileInputId}
							onChange={(event) => handleFileChange(event.target.files)}
							type="file"
						/>
					</label>
					<label className="grid gap-1" htmlFor={keyInputId}>
						<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
							Key
						</span>
						<Input
							className="font-mono"
							id={keyInputId}
							onChange={(event) => setKey(event.target.value)}
							placeholder={`${currentPrefix || "admin-uploads/"}file.bin`}
							value={key}
						/>
					</label>
					<label className="grid gap-1" htmlFor={contentTypeInputId}>
						<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
							Content type
						</span>
						<Input
							className="font-mono"
							id={contentTypeInputId}
							onChange={(event) => setContentType(event.target.value)}
							placeholder="application/octet-stream"
							value={contentType}
						/>
					</label>
					<Button
						disabled={
							!file || key.trim().length === 0 || uploadMutation.isPending
						}
						type="submit"
					>
						{uploadMutation.isPending ? (
							<Loader2 className="animate-spin" data-icon="inline-start" />
						) : (
							<Upload data-icon="inline-start" />
						)}
						Upload
					</Button>
					{uploadMutation.data ? (
						<p className="break-all text-emerald-700 text-xs dark:text-emerald-300">
							{uploadMutation.data.object.url}
						</p>
					) : null}
					{uploadMutation.isError ? (
						<p className="text-destructive text-xs">
							{getErrorMessage(uploadMutation.error)}
						</p>
					) : null}
				</form>
			</CardContent>
		</Card>
	);
}

function PresignedUploadCard({ currentPrefix }: { currentPrefix: string }) {
	const presignMutation = useCreateStoragePresignedUpload();
	const [key, setKey] = useState(
		`${currentPrefix || "admin-uploads/"}external-object.bin`
	);
	const [contentType, setContentType] = useState(DEFAULT_PRESIGN_CONTENT_TYPE);
	const [expiresInSeconds, setExpiresInSeconds] = useState("3600");
	const keyInputId = useId();
	const contentTypeInputId = useId();
	const expiresInputId = useId();

	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle>Signed PUT</CardTitle>
				<CardDescription>
					Short-lived upload URL for workers and external tooling.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="grid gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						presignMutation.mutate({
							contentType: contentType.trim(),
							expiresInSeconds: Number(expiresInSeconds),
							key: key.trim(),
						});
					}}
				>
					<label className="grid gap-1" htmlFor={keyInputId}>
						<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
							Key
						</span>
						<Input
							className="font-mono"
							id={keyInputId}
							onChange={(event) => setKey(event.target.value)}
							value={key}
						/>
					</label>
					<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
						<label className="grid gap-1" htmlFor={contentTypeInputId}>
							<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
								Content type
							</span>
							<Input
								className="font-mono"
								id={contentTypeInputId}
								onChange={(event) => setContentType(event.target.value)}
								value={contentType}
							/>
						</label>
						<label className="grid gap-1" htmlFor={expiresInputId}>
							<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
								TTL seconds
							</span>
							<Input
								id={expiresInputId}
								inputMode="numeric"
								onChange={(event) => setExpiresInSeconds(event.target.value)}
								value={expiresInSeconds}
							/>
						</label>
					</div>
					<Button
						disabled={key.trim().length === 0 || presignMutation.isPending}
						type="submit"
					>
						{presignMutation.isPending ? (
							<Loader2 className="animate-spin" data-icon="inline-start" />
						) : (
							<Link2 data-icon="inline-start" />
						)}
						Create URL
					</Button>
				</form>
				{presignMutation.data ? (
					<div className="mt-3 grid gap-2">
						<SignedUrlRow label="PUT URL" value={presignMutation.data.url} />
						<SignedUrlRow
							label="Public URL"
							value={presignMutation.data.publicUrl}
						/>
					</div>
				) : null}
				{presignMutation.isError ? (
					<p className="mt-3 text-destructive text-xs">
						{getErrorMessage(presignMutation.error)}
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}

const DEFAULT_PRESIGN_CONTENT_TYPE = "application/octet-stream";

function SignedUrlRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-1">
			<span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
				{label}
			</span>
			<div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
				<Input className="font-mono" readOnly value={value} />
				<Button
					aria-label={`Copy ${label}`}
					onClick={() => copyText(value)}
					size="icon-sm"
					type="button"
					variant="outline"
				>
					<Clipboard />
				</Button>
			</div>
		</div>
	);
}

function ConfigRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-1 border-foreground/5 border-b py-2 last:border-b-0 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-baseline">
			<div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
				{label}
			</div>
			<div className="break-all font-mono text-xs">{value}</div>
		</div>
	);
}

function StatusPill({
	tone,
	value,
}: {
	tone: "neutral" | "success" | "warning";
	value: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex h-6 items-center rounded-sm px-2 font-medium text-[11px]",
				tone === "success"
					? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
					: "",
				tone === "warning"
					? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
					: "",
				tone === "neutral" ? "bg-muted text-muted-foreground" : ""
			)}
		>
			{value}
		</span>
	);
}
