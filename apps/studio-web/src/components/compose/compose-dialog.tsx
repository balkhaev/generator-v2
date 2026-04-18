"use client";

import type { LoraRegistryEntry } from "@generator/contracts/loras";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";
import {
	type AdminSnapshot,
	createStudioScenario,
	type ScenarioFormState,
} from "@generator/studio-client/client";
import {
	buildCreateScenarioInput,
	createScenarioFormState,
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
import { AlertCircle, Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";

import ComposeForm from "./compose-form";

interface ComposeDialogProps {
	onOpenChange: (open: boolean) => void;
	onScenarioCreated?: (snapshot: AdminSnapshot) => void;
	open: boolean;
	snapshot: AdminSnapshot;
}

const studioApiBaseUrl = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);
const adminWebUrl = env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3001";
const trailingSlashesPattern = /\/+$/u;
const adminLorasHref = `${adminWebUrl.replace(trailingSlashesPattern, "")}/loras`;

async function fetchStudioLoras(baseModel?: string): Promise<{
	error: string | null;
	loras: LoraRegistryEntry[];
}> {
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

export default function ComposeDialog({
	onOpenChange,
	onScenarioCreated,
	open,
	snapshot,
}: ComposeDialogProps) {
	const formId = useId();
	const workflows = snapshot.workflows;
	const initialWorkflow = workflows[0] ?? null;
	const [form, setForm] = useState<ScenarioFormState | null>(() =>
		initialWorkflow ? createScenarioFormState(initialWorkflow) : null
	);
	const [availableLoras, setAvailableLoras] = useState<LoraRegistryEntry[]>([]);
	const [lorasError, setLorasError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [validity, setValidity] = useState<{
		errors: string[];
		isReady: boolean;
	}>({ errors: [], isReady: false });

	const selectedWorkflow = useMemo(() => {
		if (!form) {
			return initialWorkflow;
		}

		return (
			workflows.find((workflow) => workflow.key === form.workflowKey) ??
			initialWorkflow
		);
	}, [form, initialWorkflow, workflows]);

	useEffect(() => {
		if (!open) {
			return;
		}

		setForm((current) => {
			if (current) {
				return current;
			}

			return initialWorkflow ? createScenarioFormState(initialWorkflow) : null;
		});
	}, [initialWorkflow, open]);

	useEffect(() => {
		if (!open) {
			return;
		}

		let cancelled = false;
		fetchStudioLoras(selectedWorkflow?.baseModel).then((result) => {
			if (cancelled) {
				return;
			}
			setAvailableLoras(result.loras);
			setLorasError(result.error);
		});
		return () => {
			cancelled = true;
		};
	}, [open, selectedWorkflow?.baseModel]);

	const handleValidityChange = useCallback(
		(input: { errors: string[]; isReady: boolean }) => {
			setValidity(input);
		},
		[]
	);

	async function handleSubmit() {
		if (!(form && selectedWorkflow)) {
			toast.error("Scenario form is unavailable.");
			return;
		}

		if (!(form.name.trim() && form.prompt.trim())) {
			toast.error("Scenario name and prompt are required.");
			return;
		}

		setIsSaving(true);

		try {
			const result = await createStudioScenario(
				buildCreateScenarioInput(selectedWorkflow, {
					...form,
					name: form.name.trim(),
					prompt: form.prompt.trim(),
				})
			);

			const nextSnapshot: AdminSnapshot = {
				...snapshot,
				scenarios: [result.data, ...snapshot.scenarios],
			};
			onScenarioCreated?.(nextSnapshot);
			toast.success("Scenario saved.");
			onOpenChange(false);
			setForm(createScenarioFormState(selectedWorkflow));
		} catch (createError) {
			toast.error(
				createError instanceof Error
					? createError.message
					: "Unable to save scenario."
			);
		} finally {
			setIsSaving(false);
		}
	}

	const hasWorkflows = workflows.length > 0;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="flex max-h-[90vh] w-[min(46rem,100vw-2rem)] max-w-[46rem] flex-col gap-0 p-0">
				<DialogHeader>
					<DialogTitle>Compose scenario</DialogTitle>
					<DialogDescription>
						Pick a workflow, write a prompt and tune parameters before saving.
					</DialogDescription>
				</DialogHeader>

				{form && hasWorkflows ? (
					<DialogBody className="max-h-none flex-1 overflow-y-auto">
						<ComposeForm
							adminLorasHref={adminLorasHref}
							availableLoras={availableLoras}
							form={form}
							formId={formId}
							hideFooter
							isSubmitting={isSaving}
							lorasError={lorasError}
							onFormChange={setForm}
							onSubmit={handleSubmit}
							onValidityChange={handleValidityChange}
							workflows={workflows}
						/>
					</DialogBody>
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
								{selectedWorkflow?.name ?? "Select a workflow"}
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
								<Plus className="size-3.5" />
							)}
							Save scenario
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
