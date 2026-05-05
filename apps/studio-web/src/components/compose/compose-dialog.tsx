"use client";

import type { LoraRegistryEntry } from "@generator/contracts/loras";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";
import {
	type AdminSnapshot,
	createStudioScenario,
	type ScenarioFormState,
	type ScenarioRecord,
	updateStudioScenario,
} from "@generator/studio-client/client";
import {
	buildCreateScenarioInput,
	buildScenarioFormStateFromRecord,
	type WorkflowDefinition,
} from "@generator/studio-client/shared";
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
import { AlertCircle, Loader2, Plus, Save } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import ComposeForm, { createComposeScenarioFormState } from "./compose-form";

interface ComposeDialogProps {
	editingScenario?: ScenarioRecord | null;
	onOpenChange: (open: boolean) => void;
	onScenarioCreated?: (snapshot: AdminSnapshot) => void;
	onScenarioUpdated?: (snapshot: AdminSnapshot, scenarioId: string) => void;
	open: boolean;
	snapshot: AdminSnapshot;
}

interface LorasState {
	error: string | null;
	loras: LoraRegistryEntry[];
}

const studioApiBaseUrl = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);
const adminWebUrl = env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";
const trailingSlashesPattern = /\/+$/u;
const adminLorasHref = `${adminWebUrl.replace(trailingSlashesPattern, "")}/loras`;

// Внутрипроцессный кеш по baseModel — чтобы повторное открытие модалки
// сразу показывало список LoRAs без мерцания "0 LoRAs" → "N LoRAs".
const lorasCache = new Map<string, LorasState>();

async function fetchStudioLoras(baseModel?: string): Promise<LorasState> {
	const params = new URLSearchParams();
	if (baseModel) {
		params.set("baseModel", baseModel);
	}
	const query = params.toString();
	try {
		const payload = await requestJson<{ loras: LoraRegistryEntry[] }>(
			`${studioApiBaseUrl}/api/loras${query ? `?${query}` : ""}`,
			{ cache: "no-store", credentials: "include" }
		);
		return { error: null, loras: payload.loras ?? [] };
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to load LoRAs";
		return { error: message, loras: [] };
	}
}

function useStudioLoras(baseModel: string | undefined, enabled: boolean) {
	const cacheKey = baseModel ?? "__any__";
	const cached = lorasCache.get(cacheKey);
	const [state, setState] = useState<LorasState>(
		cached ?? { error: null, loras: [] }
	);
	const mergeImported = useCallback(
		(entries: LoraRegistryEntry[]) => {
			if (entries.length === 0) {
				return;
			}
			setState((current) => {
				const importedIds = new Set(entries.map((entry) => entry.id));
				const next = {
					error: null,
					loras: [
						...entries,
						...current.loras.filter((entry) => !importedIds.has(entry.id)),
					],
				};
				lorasCache.set(cacheKey, next);
				return next;
			});
		},
		[cacheKey]
	);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		// Если уже есть кеш — отдаём его сразу и НЕ перетираем пустотой.
		const hit = lorasCache.get(cacheKey);
		if (hit) {
			setState(hit);
		}
		let cancelled = false;
		fetchStudioLoras(baseModel).then((result) => {
			lorasCache.set(cacheKey, result);
			if (cancelled) {
				return;
			}
			setState(result);
		});
		return () => {
			cancelled = true;
		};
	}, [baseModel, cacheKey, enabled]);

	return { ...state, mergeImported };
}

interface ComposeDialogBodyProps {
	availableLoras: LoraRegistryEntry[];
	editingScenario: ScenarioRecord | null;
	formId: string;
	initialWorkflow: WorkflowDefinition;
	isSaving: boolean;
	lorasError: string | null;
	onLorasImported: (entries: LoraRegistryEntry[]) => void;
	onSubmit: (form: ScenarioFormState, workflow: WorkflowDefinition) => void;
	onValidityChange: (input: { errors: string[]; isReady: boolean }) => void;
	onWorkflowChange: (workflow: WorkflowDefinition | null) => void;
	workflows: WorkflowDefinition[];
}

function ComposeDialogBody({
	availableLoras,
	editingScenario,
	formId,
	initialWorkflow,
	isSaving,
	lorasError,
	onLorasImported,
	onSubmit,
	onValidityChange,
	onWorkflowChange,
	workflows,
}: ComposeDialogBodyProps) {
	// Стартовое состояние формы вычисляем один раз при mount подкомпонента.
	// ComposeDialog задаёт `key={editingScenarioId ?? "create"}`, поэтому при
	// смене сценария тело пересоздаётся и useState получает свежий init —
	// это убирает промежуточный рендер со старой формой и связанный flicker.
	const [form, setForm] = useState<ScenarioFormState>(() =>
		editingScenario
			? buildScenarioFormStateFromRecord(editingScenario, initialWorkflow)
			: createComposeScenarioFormState(initialWorkflow)
	);

	const selectedWorkflow = useMemo(
		() =>
			workflows.find((workflow) => workflow.key === form.workflowKey) ??
			initialWorkflow,
		[form.workflowKey, initialWorkflow, workflows]
	);

	useEffect(() => {
		onWorkflowChange(selectedWorkflow);
	}, [onWorkflowChange, selectedWorkflow]);

	return (
		<DialogBody className="max-h-none flex-1 overflow-y-auto">
			<ComposeForm
				adminLorasHref={adminLorasHref}
				availableLoras={availableLoras}
				form={form}
				formId={formId}
				hideFooter
				isSubmitting={isSaving}
				lorasError={lorasError}
				onFormChange={(next) => {
					if (typeof next === "function") {
						setForm((current) => {
							const computed = (
								next as (
									prev: ScenarioFormState | null
								) => ScenarioFormState | null
							)(current);
							return computed ?? current;
						});
						return;
					}
					if (next) {
						setForm(next);
					}
				}}
				onLorasImported={onLorasImported}
				onSubmit={() => onSubmit(form, selectedWorkflow)}
				onValidityChange={onValidityChange}
				workflows={workflows}
			/>
		</DialogBody>
	);
}

export default function ComposeDialog({
	editingScenario,
	onOpenChange,
	onScenarioCreated,
	onScenarioUpdated,
	open,
	snapshot,
}: ComposeDialogProps) {
	const formId = useId();
	const workflows = snapshot.workflows;
	const isEditing = Boolean(editingScenario);
	const initialWorkflow = useMemo(() => {
		if (editingScenario) {
			const matched = workflows.find(
				(workflow) => workflow.key === editingScenario.workflowKey
			);
			if (matched) {
				return matched;
			}
		}
		return workflows[0] ?? null;
	}, [editingScenario, workflows]);

	// Активный workflow для подписи в футере. Подкомпонент сообщает его через
	// колбэк, чтобы внешняя обвязка диалога не зависела от внутренней формы.
	const [activeWorkflow, setActiveWorkflow] =
		useState<WorkflowDefinition | null>(initialWorkflow);
	useEffect(() => {
		setActiveWorkflow(initialWorkflow);
	}, [initialWorkflow]);

	const [isSaving, setIsSaving] = useState(false);
	const [validity, setValidity] = useState<{
		errors: string[];
		isReady: boolean;
	}>({ errors: [], isReady: false });

	const {
		error: lorasError,
		loras: availableLoras,
		mergeImported: mergeImportedLoras,
	} = useStudioLoras(activeWorkflow?.baseModel, open);

	const handleValidityChange = useCallback(
		(input: { errors: string[]; isReady: boolean }) => {
			setValidity(input);
		},
		[]
	);

	const handleWorkflowChange = useCallback(
		(workflow: WorkflowDefinition | null) => {
			setActiveWorkflow(workflow);
		},
		[]
	);

	const handleSubmit = useCallback(
		async (form: ScenarioFormState, workflow: WorkflowDefinition) => {
			if (!(form.name.trim() && form.prompt.trim())) {
				toast.error("Scenario name and prompt are required.");
				return;
			}

			const payload = buildCreateScenarioInput(workflow, {
				...form,
				name: form.name.trim(),
				prompt: form.prompt.trim(),
			});

			setIsSaving(true);

			try {
				if (editingScenario) {
					const result = await updateStudioScenario(
						editingScenario.id,
						payload
					);
					const nextSnapshot: AdminSnapshot = {
						...snapshot,
						scenarios: snapshot.scenarios.map((scenario) =>
							scenario.id === editingScenario.id ? result.data : scenario
						),
					};
					onScenarioUpdated?.(nextSnapshot, editingScenario.id);
					toast.success("Scenario updated.");
					onOpenChange(false);
					return;
				}

				const result = await createStudioScenario(payload);
				const nextSnapshot: AdminSnapshot = {
					...snapshot,
					scenarios: [result.data, ...snapshot.scenarios],
				};
				onScenarioCreated?.(nextSnapshot);
				toast.success("Scenario saved.");
				onOpenChange(false);
			} catch (saveError) {
				toast.error(
					saveError instanceof Error
						? saveError.message
						: "Unable to save scenario."
				);
			} finally {
				setIsSaving(false);
			}
		},
		[
			editingScenario,
			onOpenChange,
			onScenarioCreated,
			onScenarioUpdated,
			snapshot,
		]
	);

	const hasWorkflows = workflows.length > 0;
	const SubmitIcon = isEditing ? Save : Plus;
	// key форсирует пересоздание тела при смене edit/create или сценария.
	// Без этого пришлось бы синхронизировать форму через useEffect и иметь
	// промежуточный рендер со старым состоянием — главный источник мерцания.
	const bodyKey = `${editingScenario?.id ?? "create"}:${initialWorkflow?.key ?? "none"}`;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="flex max-h-[90vh] w-[min(46rem,100vw-2rem)] max-w-[46rem] flex-col gap-0 p-0">
				<DialogHeader>
					<DialogTitle>
						{isEditing ? "Edit scenario" : "Compose scenario"}
					</DialogTitle>
					<DialogDescription>
						{isEditing
							? "Tweak the prompt or parameters and save your changes."
							: "Pick a workflow, write a prompt and tune parameters before saving."}
					</DialogDescription>
				</DialogHeader>

				{hasWorkflows && initialWorkflow ? (
					<ComposeDialogBody
						availableLoras={availableLoras}
						editingScenario={editingScenario ?? null}
						formId={formId}
						initialWorkflow={initialWorkflow}
						isSaving={isSaving}
						key={bodyKey}
						lorasError={lorasError}
						onLorasImported={mergeImportedLoras}
						onSubmit={(form, workflow) => {
							handleSubmit(form, workflow).catch(() => undefined);
						}}
						onValidityChange={handleValidityChange}
						onWorkflowChange={handleWorkflowChange}
						workflows={workflows}
					/>
				) : (
					<DialogBody className="max-h-none">
						<div className="rounded-md bg-rose-500/10 px-3 py-2 text-rose-700 text-xs dark:text-rose-300">
							No workflows are available yet.
						</div>
					</DialogBody>
				)}

				<DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div className="min-w-0 flex-1">
						{validity.errors.length > 0 ? (
							<div className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
								<AlertCircle className="mt-0.5 size-3 shrink-0" />
								<span className="truncate">{validity.errors.join(" · ")}</span>
							</div>
						) : (
							<p className="truncate text-[11px] text-muted-foreground">
								{activeWorkflow?.name ?? "Select a workflow"}
							</p>
						)}
					</div>
					<div className="flex items-center gap-2">
						<Button
							onClick={() => onOpenChange(false)}
							size="sm"
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={!(validity.isReady && hasWorkflows) || isSaving}
							form={formId}
							size="sm"
							type="submit"
						>
							{isSaving ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<SubmitIcon className="size-3.5" />
							)}
							{isEditing ? "Save changes" : "Save scenario"}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
