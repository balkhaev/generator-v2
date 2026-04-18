"use client";

import type { PersonRecord } from "@generator/contracts/persons";
import { env } from "@generator/env/web";
import {
	type AdminSnapshot,
	getStudioSnapshot,
	type ScenarioRecord,
	type ScenarioRunRecord,
} from "@generator/studio-client/client";
import { Button } from "@generator/ui/components/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@generator/ui/components/dialog";
import { RunProgressIndicator } from "@generator/ui/components/run-progress-indicator";
import WorkspaceShell, {
	WorkspaceStatus,
} from "@generator/ui/components/workspace-shell";
import { createWorkspaceNavigation } from "@generator/ui/lib/workspace-nav";
import { Loader2, Trash2 } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import CommandSidebar from "@/components/command-sidebar";
import ComposeDialog from "@/components/compose/compose-dialog";
import MediaStrip from "@/components/media-strip";
import { ModeToggle } from "@/components/mode-toggle";
import PreviewSurface, {
	getMediaType,
	type StudioMediaAsset,
} from "@/components/preview-surface";
import type {
	ScenarioCardData,
	ScenarioRailStatus,
} from "@/components/scenario-card-data";
import { usePersonSelection } from "@/components/use-person-selection";
import { useScenarioDeletion } from "@/components/use-scenario-deletion";
import { useShotSaving } from "@/components/use-shot-saving";
import { useStudioMedia } from "@/components/use-studio-media";
import { useStudioRunStream } from "@/components/use-studio-run-stream";
import { useStudioSelection } from "@/components/use-studio-selection";
import UserMenu from "@/components/user-menu";
import { getPersonById } from "@/lib/persons-api";

function buildStudioHref(
	pathname: string,
	currentSearch: string,
	input: {
		assetId?: string | null;
		personId?: string | null;
		runId?: string | null;
		scenarioId?: string | null;
		tab?: string | null;
	}
) {
	const params = new URLSearchParams(currentSearch);

	if (input.assetId === null) {
		params.delete("asset");
	} else if (typeof input.assetId === "string") {
		params.set("asset", input.assetId);
	}

	if (input.runId === null) {
		params.delete("run");
	} else if (typeof input.runId === "string") {
		params.set("run", input.runId);
	}

	if (input.scenarioId === null) {
		params.delete("scenario");
	} else if (typeof input.scenarioId === "string") {
		params.set("scenario", input.scenarioId);
	}

	if (input.personId === null) {
		params.delete("person");
	} else if (typeof input.personId === "string") {
		params.set("person", input.personId);
	}

	if (input.tab === null) {
		params.delete("tab");
	} else if (typeof input.tab === "string") {
		params.set("tab", input.tab);
	}

	const nextSearch = params.toString();
	return (nextSearch ? `${pathname}?${nextSearch}` : pathname) as Route;
}

function getScenarioDuration(params: ScenarioRecord["params"]) {
	const safeParams = params ?? {};
	const frameRate =
		typeof safeParams.frameRate === "number"
			? safeParams.frameRate
			: Number(safeParams.frameRate);
	const numFrames =
		typeof safeParams.numFrames === "number"
			? safeParams.numFrames
			: Number(safeParams.numFrames);

	if (
		Number.isFinite(frameRate) &&
		Number.isFinite(numFrames) &&
		frameRate > 0
	) {
		return `${(numFrames / frameRate).toFixed(1)}s`;
	}

	return "n/a";
}

function getScenarioStatus(runs: ScenarioRunRecord[]): ScenarioRailStatus {
	const latestRun = runs[0] ?? null;

	if (!latestRun) {
		return "draft";
	}

	switch (latestRun.status) {
		case "failed":
			return "failed";
		case "queued":
			return "queued";
		case "running":
			return "running";
		case "succeeded":
			return "ready";
		default:
			return "draft";
	}
}

function buildScenarioCards(
	scenarios: ScenarioRecord[],
	runs: ScenarioRunRecord[]
): ScenarioCardData[] {
	return scenarios.map((scenario) => {
		const scenarioRuns = runs.filter((run) => run.scenarioId === scenario.id);

		return {
			duration: getScenarioDuration(scenario.params),
			id: scenario.id,
			name: scenario.name,
			prompt: scenario.prompt,
			runCount: scenarioRuns.length,
			status: getScenarioStatus(scenarioRuns),
			updatedAt: scenario.updatedAt ?? scenario.createdAt ?? null,
			workflowKey: scenario.workflowKey,
		};
	});
}

function pickHeadlineLiveRun(params: {
	requestedRun: ScenarioRunRecord | null;
	runs: ScenarioRunRecord[];
	selectedScenarioId: string | null;
}): ScenarioRunRecord | null {
	const isLive = (run: ScenarioRunRecord) =>
		run.status === "queued" || run.status === "running";
	const inScenario = params.selectedScenarioId
		? params.runs.filter((run) => run.scenarioId === params.selectedScenarioId)
		: params.runs;
	if (params.requestedRun && isLive(params.requestedRun)) {
		return params.requestedRun;
	}
	return inScenario.find(isLive) ?? params.runs.find(isLive) ?? null;
}

function StudioStatusBar({
	activeRunCount,
	assetsCount,
	headlineLiveRun,
	statusLabel,
	succeededRunCount,
}: {
	activeRunCount: number;
	assetsCount: number;
	headlineLiveRun: ScenarioRunRecord | null;
	statusLabel: string;
	succeededRunCount: number;
}) {
	return (
		<>
			<WorkspaceStatus tone="info">{statusLabel}</WorkspaceStatus>
			{activeRunCount > 0 ? (
				<WorkspaceStatus tone="warning">
					<span className="size-1.5 shrink-0 animate-pulse rounded-full bg-amber-500" />
					{activeRunCount} active
					{headlineLiveRun ? (
						<>
							<span aria-hidden="true">·</span>
							<RunProgressIndicator
								etaMs={headlineLiveRun.etaMs}
								phase={headlineLiveRun.phase}
								progressPct={headlineLiveRun.progressPct}
								queuePosition={headlineLiveRun.queuePosition}
								status={headlineLiveRun.status}
								variant="inline"
							/>
						</>
					) : null}
				</WorkspaceStatus>
			) : null}
			<WorkspaceStatus tone="success">
				{succeededRunCount} succeeded
			</WorkspaceStatus>
			<WorkspaceStatus tone="neutral">{assetsCount} assets</WorkspaceStatus>
		</>
	);
}

function StudioSubtitleBar({
	activeRunCount,
	scenarioCount,
	selectedPerson,
	selectedScenarioCard,
}: {
	activeRunCount: number;
	scenarioCount: number;
	selectedPerson: PersonRecord | null;
	selectedScenarioCard: ScenarioCardData | null;
}) {
	if (selectedPerson) {
		const readyCount = selectedPerson.generations.filter(
			(generation) =>
				generation.status === "ready" &&
				generation.metadata?.isDatasetPhoto !== true
		).length;
		return (
			<span className="flex flex-wrap items-center gap-2">
				<span>{selectedPerson.slug}</span>
				<span aria-hidden="true">·</span>
				<span>{readyCount} ready photos</span>
				<span aria-hidden="true">·</span>
				<span className="text-muted-foreground/80">
					Generate a photo, then pick a scenario to use it as input
				</span>
			</span>
		);
	}
	if (!selectedScenarioCard) {
		return `${scenarioCount} scenarios ready to launch`;
	}
	return (
		<span className="flex flex-wrap items-center gap-2">
			<span>{selectedScenarioCard.duration}</span>
			<span aria-hidden="true">·</span>
			<span>{selectedScenarioCard.runCount} runs</span>
			{activeRunCount > 0 ? (
				<>
					<span aria-hidden="true">·</span>
					<span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
						<span className="size-1 animate-pulse rounded-full bg-amber-500" />
						Live updates
					</span>
				</>
			) : null}
			{selectedScenarioCard.prompt ? (
				<>
					<span aria-hidden="true">·</span>
					<span className="line-clamp-1 max-w-[60ch] text-muted-foreground/80">
						{selectedScenarioCard.prompt}
					</span>
				</>
			) : null}
		</span>
	);
}

function DeleteScenarioDialog({
	isDeleting,
	onCancel,
	onConfirm,
	scenario,
}: {
	isDeleting: boolean;
	onCancel: () => void;
	onConfirm: () => void;
	scenario: ScenarioRecord | null;
}) {
	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				if (!(nextOpen || isDeleting)) {
					onCancel();
				}
			}}
			open={scenario !== null}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>
						Delete &ldquo;{scenario?.name ?? "scenario"}&rdquo;?
					</DialogTitle>
					<DialogDescription>
						The scenario will be removed from the list. Past runs and saved
						shots stay intact, but you will not be able to launch new runs from
						this template.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<p className="text-muted-foreground text-xs">
						If you only need to tweak parameters or the prompt, use{" "}
						<span className="font-medium">Edit</span> instead.
					</p>
				</DialogBody>
				<DialogFooter>
					<Button
						disabled={isDeleting}
						onClick={onCancel}
						size="sm"
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						disabled={isDeleting}
						onClick={onConfirm}
						size="sm"
					>
						{isDeleting ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<Trash2 className="size-3.5" />
						)}
						Delete scenario
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function buildScenarioMediaAssets(
	runs: ScenarioRunRecord[]
): StudioMediaAsset[] {
	return runs.flatMap((run) => {
		// Failed runs только засоряют ленту превью: их выход — пусто, а вход
		// (reference image / first frame) уже виден в композере и не помогает
		// разобраться, почему run упал. Дебаг таких ранов — на странице run debug.
		if (run.status === "failed") {
			return [];
		}

		if (run.artifactUrls.length > 0) {
			return run.artifactUrls.map<StudioMediaAsset>((url, index) => {
				const mediaType = getMediaType(url);
				return {
					createdAt: run.createdAt,
					id: `output-${run.id}-${index}`,
					label: `${run.scenarioName} output ${index + 1}`,
					mediaKind: "output",
					mediaType,
					meta: run.scenarioName,
					// Для видео используем исходную картинку как poster, чтобы
					// в media-strip вместо чёрного фона с иконкой Film сразу
					// был осмысленный кадр — пока браузер не подтянет первый кадр
					// самого видео.
					posterUrl: mediaType === "video" ? (run.inputImageUrl ?? null) : null,
					runId: run.id,
					scenarioId: run.scenarioId,
					status: run.status,
					url,
				};
			});
		}

		// Пока генерация идёт и реальных артефактов нет — занимаем слот будущего
		// output входным фото, чтобы пользователь видел, что именно мы генерируем.
		// Как только artifactUrls появятся, placeholder заменится настоящим выводом.
		if (
			run.inputImageUrl &&
			(run.status === "queued" || run.status === "running")
		) {
			return [
				{
					createdAt: run.createdAt,
					id: `pending-${run.id}`,
					label: run.inputLabel,
					mediaKind: "output",
					mediaType: getMediaType(run.inputImageUrl),
					meta: run.scenarioName,
					etaMs: run.etaMs ?? null,
					lastLogLine: run.lastLogLine ?? null,
					phase: run.phase ?? null,
					placeholder: true,
					progressPct: run.progressPct ?? null,
					queuePosition: run.queuePosition ?? null,
					runId: run.id,
					scenarioId: run.scenarioId,
					status: run.status,
					url: run.inputImageUrl,
				},
			];
		}

		return [];
	});
}

function buildPersonMediaAssets(person: PersonRecord): StudioMediaAsset[] {
	const studioGenerations = person.generations.filter(
		(generation) =>
			generation.status === "ready" &&
			generation.metadata?.isDatasetPhoto !== true
	);
	return studioGenerations.flatMap((generation) => {
		const url = generation.previewUrl ?? generation.sourceUrl;
		if (!url) {
			return [];
		}
		return [
			{
				createdAt: generation.createdAt,
				id: `person-${generation.id}`,
				label: generation.title || `${person.name} photo`,
				mediaKind: "output",
				mediaType: getMediaType(url),
				meta: person.name,
				runId: `person:${generation.id}`,
				scenarioId: `person:${person.id}`,
				status: "succeeded",
				url,
			},
		];
	});
}

export default function StudioShell({
	initialSnapshot,
	sessionEmail,
	sessionName,
}: {
	initialSnapshot: AdminSnapshot;
	sessionEmail?: string | null;
	sessionName: string;
}) {
	const [snapshot, setSnapshot] = useState<AdminSnapshot>(initialSnapshot);
	const [isComposeOpen, setIsComposeOpen] = useState(false);
	const [editingScenarioId, setEditingScenarioId] = useState<string | null>(
		null
	);
	const pathname = usePathname();
	const router = useRouter();
	const searchParams = useSearchParams();
	const currentSearch = searchParams.toString();
	const scenarioCards = useMemo(
		() => buildScenarioCards(snapshot.scenarios, snapshot.runs),
		[snapshot.runs, snapshot.scenarios]
	);
	const requestedPersonId = searchParams.get("person");
	const {
		handlePersonRefreshed,
		isPersonsLoaded,
		personDetail,
		persons,
		selectedPersonId,
	} = usePersonSelection(requestedPersonId);
	const requestedRunId = searchParams.get("run");
	const requestedScenarioId = searchParams.get("scenario");
	const requestedAssetId = searchParams.get("asset");

	const navigate = useCallback(
		(href: string) => router.replace(href as Route, { scroll: false }),
		[router]
	);
	// Держим currentSearch в ref, чтобы builders/navigate сохраняли стабильную
	// ссылку через ререндеры. Иначе любое изменение URL пересоздавало эти
	// функции и стреляли useEffect-ы внутри useStudioSelection/useStudioMedia
	// — даже когда фактически переключаться никуда не нужно.
	const currentSearchRef = useRef(currentSearch);
	useEffect(() => {
		currentSearchRef.current = currentSearch;
	}, [currentSearch]);
	const selectionUrlBuilder = useCallback(
		(input: {
			assetId?: string | null;
			personId?: string | null;
			runId?: string | null;
			scenarioId?: string | null;
		}) => buildStudioHref(pathname, currentSearchRef.current, input),
		[pathname]
	);
	const mediaUrlBuilder = useCallback(
		(input: { assetId?: string | null; runId?: string | null }) =>
			buildStudioHref(pathname, currentSearchRef.current, input),
		[pathname]
	);

	const {
		isPersonMode,
		requestedRun,
		selectedScenarioCard,
		selectedScenarioId,
	} = useStudioSelection({
		currentSearch,
		isPersonsLoaded,
		navigate,
		pathname,
		requestedPersonId,
		requestedRunId,
		requestedScenarioId,
		runs: snapshot.runs,
		scenarioCards,
		selectedPersonId,
		urlBuilder: selectionUrlBuilder,
	});

	const {
		navigateToMedia,
		selectedMediaAsset,
		selectedMediaId,
		selectedMediaIndex,
		selectedScenarioAssets,
	} = useStudioMedia({
		buildPersonMediaAssets,
		buildScenarioMediaAssets,
		currentSearch,
		isPersonMode,
		navigate,
		pathname,
		personDetail,
		requestedAssetId,
		requestedRunId,
		runs: snapshot.runs,
		selectedScenarioId,
		urlBuilder: mediaUrlBuilder,
	});

	const handlePersonGenerationImported = useCallback(
		(personId: string) => {
			getPersonById(personId)
				.then((person) => {
					handlePersonRefreshed(person);
				})
				.catch(() => undefined);
		},
		[handlePersonRefreshed]
	);

	const { savingShotAssetId, saveShot } = useShotSaving({
		onPersonGenerationImported: handlePersonGenerationImported,
		runs: snapshot.runs,
		setSnapshot,
	});

	const scenarioNamesById = useMemo(() => {
		const map = new Map<string, string>();
		for (const scenario of snapshot.scenarios) {
			map.set(scenario.id, scenario.name);
		}
		return map;
	}, [snapshot.scenarios]);

	const handleStreamSnapshot = useCallback(
		(streamRuns: ScenarioRunRecord[]) => {
			if (streamRuns.length === 0) {
				return;
			}
			setSnapshot((current) => {
				const byId = new Map(current.runs.map((run) => [run.id, run]));
				for (const run of streamRuns) {
					byId.set(run.id, run);
				}
				return { ...current, runs: Array.from(byId.values()) };
			});
		},
		[]
	);

	const handleStreamRun = useCallback((streamRun: ScenarioRunRecord) => {
		setSnapshot((current) => {
			const index = current.runs.findIndex((run) => run.id === streamRun.id);
			if (index === -1) {
				return { ...current, runs: [streamRun, ...current.runs] };
			}
			const nextRuns = current.runs.slice();
			nextRuns[index] = streamRun;
			return { ...current, runs: nextRuns };
		});
	}, []);

	const handleFallbackPoll = useCallback(async () => {
		try {
			const nextSnapshot = await getStudioSnapshot();
			setSnapshot(nextSnapshot);
		} catch {
			// silent: best-effort recovery, will retry next tick
		}
	}, []);

	useStudioRunStream({
		enabled: !isPersonMode,
		onFallbackPoll: handleFallbackPoll,
		onSnapshot: handleStreamSnapshot,
		onUpdate: handleStreamRun,
		scenarioNames: scenarioNamesById,
	});

	const previousRunStatusRef = useRef<Map<string, ScenarioRunRecord["status"]>>(
		new Map()
	);
	useEffect(() => {
		const previous = previousRunStatusRef.current;
		const next = new Map<string, ScenarioRunRecord["status"]>();
		for (const run of snapshot.runs) {
			next.set(run.id, run.status);
			const prevStatus = previous.get(run.id);
			if (prevStatus && prevStatus !== run.status && previous.size > 0) {
				if (run.status === "succeeded") {
					toast.success(`${run.scenarioName}: готово`);
				} else if (run.status === "failed") {
					toast.error(
						run.errorSummary
							? `${run.scenarioName}: ${run.errorSummary}`
							: `${run.scenarioName}: ошибка генерации`
					);
				}
			}
		}
		previousRunStatusRef.current = next;
	}, [snapshot.runs]);

	const personsUrl = env.NEXT_PUBLIC_PERSONS_URL ?? "http://localhost:3004";
	const adminUrl = env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";

	function handleCreateScenario() {
		setEditingScenarioId(null);
		setIsComposeOpen(true);
	}

	function handleEditScenario(scenarioId: string) {
		setEditingScenarioId(scenarioId);
		setIsComposeOpen(true);
	}

	function handleComposeOpenChange(nextOpen: boolean) {
		setIsComposeOpen(nextOpen);
		if (!nextOpen) {
			setEditingScenarioId(null);
		}
	}

	function handleScenarioCreated(nextSnapshot: AdminSnapshot) {
		setSnapshot(nextSnapshot);
		const created = nextSnapshot.scenarios[0];
		if (created) {
			router.push(
				buildStudioHref(pathname, currentSearch, {
					assetId: null,
					personId: null,
					runId: null,
					scenarioId: created.id,
					tab: "launch",
				}),
				{ scroll: false }
			);
		}
	}

	function handleScenarioUpdated(nextSnapshot: AdminSnapshot) {
		setSnapshot(nextSnapshot);
	}

	const handleAfterScenarioDelete = useCallback(
		(scenarioId: string) => {
			if (selectedScenarioId === scenarioId) {
				router.replace(
					buildStudioHref(pathname, currentSearch, {
						assetId: null,
						runId: null,
						scenarioId: null,
					}),
					{ scroll: false }
				);
			}
		},
		[currentSearch, pathname, router, selectedScenarioId]
	);
	const {
		cancelDeleteScenario,
		confirmDeleteScenario,
		isDeletingScenario,
		pendingDeleteScenarioId,
		requestDeleteScenario,
	} = useScenarioDeletion({
		onAfterDelete: handleAfterScenarioDelete,
		setSnapshot,
	});

	const editingScenario =
		(editingScenarioId
			? (snapshot.scenarios.find((entry) => entry.id === editingScenarioId) ??
				null)
			: null) ?? null;
	const pendingDeleteScenario = pendingDeleteScenarioId
		? (snapshot.scenarios.find(
				(entry) => entry.id === pendingDeleteScenarioId
			) ?? null)
		: null;

	function getScenarioHref(scenarioId: string) {
		return buildStudioHref(pathname, currentSearch, {
			assetId: null,
			personId: null,
			runId: null,
			scenarioId,
		});
	}

	function getPersonHref(personId: string) {
		return buildStudioHref(pathname, currentSearch, {
			assetId: null,
			personId,
			runId: null,
			scenarioId: null,
		});
	}

	function handlePickScenario(scenarioId: string) {
		router.replace(getScenarioHref(scenarioId), { scroll: false });
	}

	function handlePickPerson(personId: string) {
		router.replace(getPersonHref(personId), { scroll: false });
	}

	function getMediaHref(mediaId: string) {
		return buildStudioHref(pathname, currentSearch, {
			assetId: mediaId,
			runId: isPersonMode ? null : requestedRunId,
		});
	}

	const activeRunCount = snapshot.runs.filter(
		(run) => run.status === "queued" || run.status === "running"
	).length;
	const succeededRunCount = snapshot.runs.filter(
		(run) => run.status === "succeeded"
	).length;

	const headlineLiveRun = useMemo(
		() =>
			pickHeadlineLiveRun({
				requestedRun,
				runs: snapshot.runs,
				selectedScenarioId,
			}),
		[requestedRun, selectedScenarioId, snapshot.runs]
	);

	const isSelectedAssetSavedShot = useMemo(() => {
		if (!selectedMediaAsset) {
			return false;
		}
		const run = snapshot.runs.find(
			(entry) => entry.id === selectedMediaAsset.runId
		);
		if (run?.inputPersonId) {
			const person = persons.find((entry) => entry.id === run.inputPersonId);
			return Boolean(
				person?.generations.some(
					(generation) =>
						generation.operatorRunId === run.id &&
						(generation.previewUrl === selectedMediaAsset.url ||
							generation.sourceUrl === selectedMediaAsset.url)
				)
			);
		}
		return snapshot.shots.some(
			(shot) =>
				shot.runId === selectedMediaAsset.runId &&
				shot.artifactUrl === selectedMediaAsset.url
		);
	}, [persons, selectedMediaAsset, snapshot.runs, snapshot.shots]);

	const statusLabel = isPersonMode
		? "person · LoRA"
		: (selectedScenarioCard?.workflowKey ?? "scenario");
	const titleText = isPersonMode
		? (personDetail?.name ?? "Person")
		: (selectedScenarioCard?.name ?? "Studio");

	return (
		<WorkspaceShell
			actions={
				<>
					<ModeToggle />
					<UserMenu email={sessionEmail} name={sessionName} />
				</>
			}
			context={
				<CommandSidebar
					getPersonHref={getPersonHref}
					getScenarioHref={getScenarioHref}
					onCreateScenario={handleCreateScenario}
					onDeleteScenario={requestDeleteScenario}
					onEditScenario={handleEditScenario}
					onPersonRefreshed={handlePersonRefreshed}
					onPickPerson={handlePickPerson}
					onPickScenario={handlePickScenario}
					onSnapshotChange={setSnapshot}
					persons={persons}
					scenarioCards={scenarioCards}
					selectedPerson={personDetail}
					selectedPersonId={selectedPersonId}
					selectedScenarioId={selectedScenarioId}
					snapshot={snapshot}
				/>
			}
			contextWidth="wide"
			navigation={createWorkspaceNavigation("studio", {
				admin: adminUrl,
				persons: personsUrl,
				shots: "/shots",
				studio: "/",
			})}
			status={
				<StudioStatusBar
					activeRunCount={isPersonMode ? 0 : activeRunCount}
					assetsCount={selectedScenarioAssets.length}
					headlineLiveRun={isPersonMode ? null : headlineLiveRun}
					statusLabel={statusLabel}
					succeededRunCount={isPersonMode ? 0 : succeededRunCount}
				/>
			}
			subtitle={
				<StudioSubtitleBar
					activeRunCount={activeRunCount}
					scenarioCount={snapshot.scenarios.length}
					selectedPerson={isPersonMode ? personDetail : null}
					selectedScenarioCard={selectedScenarioCard}
				/>
			}
			title={titleText}
			workspaceLabel="Studio"
		>
			<ComposeDialog
				editingScenario={editingScenario}
				onOpenChange={handleComposeOpenChange}
				onScenarioCreated={handleScenarioCreated}
				onScenarioUpdated={handleScenarioUpdated}
				open={isComposeOpen}
				snapshot={snapshot}
			/>
			<DeleteScenarioDialog
				isDeleting={isDeletingScenario}
				onCancel={cancelDeleteScenario}
				onConfirm={() => {
					confirmDeleteScenario().catch(() => undefined);
				}}
				scenario={pendingDeleteScenario}
			/>
			<div className="flex h-full min-h-0 flex-col gap-2">
				<PreviewSurface
					asset={selectedMediaAsset}
					currentIndex={selectedMediaIndex}
					isSavedShot={isSelectedAssetSavedShot}
					isSavingShot={
						selectedMediaAsset
							? savingShotAssetId === selectedMediaAsset.id
							: false
					}
					onNext={
						selectedMediaIndex < selectedScenarioAssets.length - 1
							? () => navigateToMedia(selectedMediaIndex + 1)
							: undefined
					}
					onPrevious={
						selectedMediaIndex > 0
							? () => navigateToMedia(selectedMediaIndex - 1)
							: undefined
					}
					onSaveShot={
						isPersonMode
							? undefined
							: (asset) => {
									saveShot(asset).catch(() => undefined);
								}
					}
					totalAssets={selectedScenarioAssets.length}
				/>
				<MediaStrip
					assets={selectedScenarioAssets}
					getHref={getMediaHref}
					selectedMediaId={selectedMediaId}
				/>
			</div>
		</WorkspaceShell>
	);
}
