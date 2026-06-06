"use client";

import type {
	CreateRunpodPodTemplateInput,
	PodTemplateVolumeAssignment,
	RunpodNetworkVolume,
	RunpodPodTemplate,
	RunpodTemplateMode,
	UpdateRunpodPodTemplateInput,
} from "@generator/contracts/runpod-admin";
import { RUNPOD_TEMPLATE_MODES } from "@generator/contracts/runpod-admin";
import { Button } from "@generator/ui/components/button";
import { Checkbox } from "@generator/ui/components/checkbox";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@generator/ui/components/dialog";
import { EmptyState } from "@generator/ui/components/empty-state";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@generator/ui/components/select";
import { cn } from "@generator/ui/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";

import {
	useCreateRunpodTemplate,
	useDeleteRunpodTemplate,
	useUpdateRunpodTemplate,
} from "@/hooks/use-admin-runpod";

const ENV_LINE_SPLIT_PATTERN = /\n+/u;
const LIST_SPLIT_PATTERN = /[,\n]+/u;

const MODE_OPTIONS = RUNPOD_TEMPLATE_MODES.map((mode) => ({
	label: mode,
	value: mode,
}));
const WORKFLOW_OPTIONS = [
	{ label: "ltx-2-3-video", value: "ltx-2-3-video" },
	{ label: "fooocus-sdxl", value: "fooocus-sdxl" },
];
const CLOUD_TYPE_OPTIONS = [
	{ label: "SECURE", value: "SECURE" },
	{ label: "COMMUNITY", value: "COMMUNITY" },
];

interface FormState {
	cloudType: string;
	containerDiskInGb: string;
	defaultEnvRaw: string;
	description: string;
	enabled: boolean;
	gpuTypeIdsRaw: string;
	imageName: string;
	keepAliveMs: string;
	mode: RunpodTemplateMode;
	name: string;
	runpodEndpointId: string;
	runpodTemplateId: string;
	timeoutMs: string;
	volumeAssignments: PodTemplateVolumeAssignment[];
	volumeInGb: string;
	workflowKey: string;
}

const EMPTY: FormState = {
	cloudType: "SECURE",
	containerDiskInGb: "",
	defaultEnvRaw: "",
	description: "",
	enabled: true,
	gpuTypeIdsRaw: "",
	imageName: "",
	keepAliveMs: "",
	mode: "pod",
	name: "",
	runpodEndpointId: "",
	runpodTemplateId: "",
	timeoutMs: "",
	volumeAssignments: [],
	volumeInGb: "",
	workflowKey: "ltx-2-3-video",
};

function toFormState(tpl: RunpodPodTemplate): FormState {
	const env = Object.entries(tpl.defaultEnv)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
	return {
		cloudType: tpl.cloudType ?? "SECURE",
		containerDiskInGb: tpl.containerDiskInGb?.toString() ?? "",
		defaultEnvRaw: env,
		description: tpl.description,
		enabled: tpl.enabled,
		gpuTypeIdsRaw: tpl.gpuTypeIds.join(", "),
		imageName: tpl.imageName ?? "",
		keepAliveMs: tpl.keepAliveMs?.toString() ?? "",
		mode: tpl.mode,
		name: tpl.name,
		runpodEndpointId: tpl.runpodEndpointId ?? "",
		runpodTemplateId: tpl.runpodTemplateId ?? "",
		timeoutMs: tpl.timeoutMs?.toString() ?? "",
		volumeAssignments: tpl.volumes.map((entry) => ({
			priority: entry.priority,
			volumeId: entry.volume.id,
		})),
		volumeInGb: tpl.volumeInGb?.toString() ?? "",
		workflowKey: tpl.workflowKey,
	};
}

function parseStringList(raw: string): string[] {
	return raw
		.split(LIST_SPLIT_PATTERN)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function parseDefaultEnv(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of raw.split(ENV_LINE_SPLIT_PATTERN)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const eqIndex = trimmed.indexOf("=");
		if (eqIndex <= 0) {
			continue;
		}
		const key = trimmed.slice(0, eqIndex).trim();
		const value = trimmed.slice(eqIndex + 1);
		if (key) {
			out[key] = value;
		}
	}
	return out;
}

function parseOptionalPositiveInt(raw: string): number | undefined {
	if (!raw.trim()) {
		return;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function parseOptionalNonNegativeInt(raw: string): number | undefined {
	if (!raw.trim()) {
		return;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0
		? Math.trunc(parsed)
		: undefined;
}

export default function RunpodPodTemplatesSection({
	templates,
	volumes,
}: {
	templates: RunpodPodTemplate[];
	volumes: RunpodNetworkVolume[];
}) {
	const [editing, setEditing] = useState<RunpodPodTemplate | null>(null);
	const [open, setOpen] = useState(false);
	const deleteMutation = useDeleteRunpodTemplate();

	const handleAdd = () => {
		setEditing(null);
		setOpen(true);
	};
	const handleEdit = (tpl: RunpodPodTemplate) => {
		setEditing(tpl);
		setOpen(true);
	};
	const handleDelete = (tpl: RunpodPodTemplate) => {
		// biome-ignore lint/suspicious/noAlert: admin-only destructive action, native confirm is acceptable here
		if (!window.confirm(`Delete template "${tpl.name}"?`)) {
			return;
		}
		deleteMutation.mutate(tpl.id, {
			onError: (error) => toast.error(`Failed to delete: ${error.message}`),
			onSuccess: () => toast.success(`Template "${tpl.name}" deleted`),
		});
	};

	return (
		<div className="grid gap-3">
			<div className="flex items-center justify-end">
				<Button onClick={handleAdd} size="sm" type="button">
					<Plus className="size-3.5" />
					New template
				</Button>
			</div>

			{templates.length === 0 ? (
				<EmptyState
					hint="Pod templates выполняют роль 'инстансов' RunPod workflow runtime'ов. Создайте первый по образцу env-defaults."
					message="Templates ещё нет"
				/>
			) : (
				<div className="grid gap-2">
					{templates.map((tpl) => (
						<button
							className={cn(
								"grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md border bg-background px-3 py-2 text-left transition hover:bg-muted/30",
								tpl.enabled
									? "border-foreground/10"
									: "border-dashed opacity-60"
							)}
							key={tpl.id}
							onClick={() => handleEdit(tpl)}
							type="button"
						>
							<div className="grid gap-0.5">
								<span className="font-medium text-sm">
									{tpl.name}
									{tpl.enabled ? null : (
										<span className="ml-2 text-muted-foreground text-xs">
											(disabled)
										</span>
									)}
								</span>
								<span className="text-muted-foreground text-xs">
									{tpl.mode} · {tpl.workflowKey}
									{tpl.runpodTemplateId ? ` · pod ${tpl.runpodTemplateId}` : ""}
									{tpl.runpodEndpointId
										? ` · endpoint ${tpl.runpodEndpointId}`
										: ""}
									{tpl.volumes.length > 0
										? ` · ${tpl.volumes.length} volume(s)`
										: ""}
								</span>
							</div>
							<span className="text-muted-foreground text-xs">
								{tpl.gpuTypeIds.slice(0, 2).join(", ")}
								{tpl.gpuTypeIds.length > 2 ? "…" : ""}
							</span>
							<Button
								onClick={(event) => {
									event.stopPropagation();
									handleDelete(tpl);
								}}
								size="icon-sm"
								type="button"
								variant="ghost"
							>
								<Trash2 className="size-3.5" />
							</Button>
						</button>
					))}
				</div>
			)}

			<TemplateFormDialog
				editing={editing}
				onClose={() => setOpen(false)}
				open={open}
				volumes={volumes}
			/>
		</div>
	);
}

function TemplateFormDialog({
	editing,
	onClose,
	open,
	volumes,
}: {
	editing: RunpodPodTemplate | null;
	onClose: () => void;
	open: boolean;
	volumes: RunpodNetworkVolume[];
}) {
	const [state, setState] = useState<FormState>(
		editing ? toFormState(editing) : EMPTY
	);
	const [submitting, setSubmitting] = useState(false);
	const createMutation = useCreateRunpodTemplate();
	const updateMutation = useUpdateRunpodTemplate();

	const volumesById = useMemo(
		() => new Map(volumes.map((vol) => [vol.id, vol] as const)),
		[volumes]
	);

	const handleOpenChange = (next: boolean) => {
		if (!next) {
			onClose();
			return;
		}
		setState(editing ? toFormState(editing) : EMPTY);
	};

	const handleToggleVolume = (volumeId: string) => {
		setState((prev) => {
			const existing = prev.volumeAssignments.find(
				(item) => item.volumeId === volumeId
			);
			if (existing) {
				return {
					...prev,
					volumeAssignments: prev.volumeAssignments
						.filter((item) => item.volumeId !== volumeId)
						.map((item, index) => ({ ...item, priority: index })),
				};
			}
			return {
				...prev,
				volumeAssignments: [
					...prev.volumeAssignments,
					{ priority: prev.volumeAssignments.length, volumeId },
				],
			};
		});
	};

	const moveVolume = (volumeId: string, delta: -1 | 1) => {
		setState((prev) => {
			const index = prev.volumeAssignments.findIndex(
				(item) => item.volumeId === volumeId
			);
			if (index < 0) {
				return prev;
			}
			const target = index + delta;
			if (target < 0 || target >= prev.volumeAssignments.length) {
				return prev;
			}
			const reordered = [...prev.volumeAssignments];
			const itemA = reordered[index];
			const itemB = reordered[target];
			if (!(itemA && itemB)) {
				return prev;
			}
			reordered[index] = itemB;
			reordered[target] = itemA;
			return {
				...prev,
				volumeAssignments: reordered.map((item, idx) => ({
					...item,
					priority: idx,
				})),
			};
		});
	};

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setSubmitting(true);
		const base = {
			cloudType: state.cloudType.trim() || undefined,
			containerDiskInGb: parseOptionalPositiveInt(state.containerDiskInGb),
			defaultEnv: parseDefaultEnv(state.defaultEnvRaw),
			description: state.description,
			enabled: state.enabled,
			gpuTypeIds: parseStringList(state.gpuTypeIdsRaw),
			imageName: state.imageName.trim() || undefined,
			keepAliveMs: parseOptionalNonNegativeInt(state.keepAliveMs),
			mode: state.mode,
			name: state.name,
			runpodEndpointId: state.runpodEndpointId.trim() || undefined,
			runpodTemplateId: state.runpodTemplateId.trim() || undefined,
			timeoutMs: parseOptionalPositiveInt(state.timeoutMs),
			volumeInGb: parseOptionalPositiveInt(state.volumeInGb),
			volumes: state.volumeAssignments,
			workflowKey: state.workflowKey,
		};
		try {
			if (editing) {
				await updateMutation.mutateAsync({
					id: editing.id,
					patch: base satisfies UpdateRunpodPodTemplateInput,
				});
				toast.success(`Template "${state.name}" updated`);
			} else {
				await createMutation.mutateAsync(
					base satisfies CreateRunpodPodTemplateInput
				);
				toast.success(`Template "${state.name}" created`);
			}
			onClose();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to save template"
			);
		} finally {
			setSubmitting(false);
		}
	};

	const isPod = state.mode === "pod";

	return (
		<Dialog onOpenChange={handleOpenChange} open={open}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{editing ? "Edit pod template" : "New pod template"}
					</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<DialogBody>
						<div className="grid gap-3">
							<div className="grid grid-cols-2 gap-3">
								<div className="grid gap-1.5">
									<Label htmlFor="tpl-name">Name</Label>
									<Input
										id="tpl-name"
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												name: event.target.value,
											}))
										}
										placeholder="LTX 2.3 video (EU)"
										required
										value={state.name}
									/>
								</div>
								<div className="grid gap-1.5">
									<Label htmlFor="tpl-mode">Mode</Label>
									<Select
										items={MODE_OPTIONS}
										onValueChange={(value) =>
											setState((prev) => ({
												...prev,
												mode: (value ?? prev.mode) as RunpodTemplateMode,
											}))
										}
										value={state.mode}
									>
										<SelectTrigger className="w-full" id="tpl-mode">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{MODE_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-3">
								<div className="grid gap-1.5">
									<Label htmlFor="tpl-workflow">Workflow key (runtime)</Label>
									<Select
										items={WORKFLOW_OPTIONS}
										onValueChange={(value) =>
											setState((prev) => ({
												...prev,
												workflowKey: (value ?? "") as string,
											}))
										}
										value={state.workflowKey}
									>
										<SelectTrigger className="w-full" id="tpl-workflow">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{WORKFLOW_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="flex items-center gap-2 text-xs">
									<Checkbox
										checked={state.enabled}
										id="tpl-enabled"
										onCheckedChange={(checked) =>
											setState((prev) => ({
												...prev,
												enabled: Boolean(checked),
											}))
										}
									/>
									<Label htmlFor="tpl-enabled">Enabled</Label>
								</div>
							</div>

							{isPod ? (
								<PodFields setState={setState} state={state} />
							) : (
								<ServerlessFields setState={setState} state={state} />
							)}

							<div className="grid gap-1.5">
								<Label htmlFor="tpl-gpus">
									GPU type IDs priority (comma-separated)
								</Label>
								<Input
									id="tpl-gpus"
									onChange={(event) =>
										setState((prev) => ({
											...prev,
											gpuTypeIdsRaw: event.target.value,
										}))
									}
									placeholder="NVIDIA L40S, NVIDIA A40"
									value={state.gpuTypeIdsRaw}
								/>
							</div>

							{isPod ? (
								<VolumesPicker
									assignments={state.volumeAssignments}
									onMove={moveVolume}
									onToggle={handleToggleVolume}
									volumes={volumes}
									volumesById={volumesById}
								/>
							) : null}

							<div className="grid gap-1.5">
								<Label htmlFor="tpl-env">
									Default env vars (KEY=VALUE, по строке)
								</Label>
								<textarea
									className="min-h-[80px] rounded-md border border-foreground/10 bg-background p-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-1"
									id="tpl-env"
									onChange={(event) =>
										setState((prev) => ({
											...prev,
											defaultEnvRaw: event.target.value,
										}))
									}
									placeholder="HF_TOKEN=hf_..."
									value={state.defaultEnvRaw}
								/>
							</div>

							<div className="grid gap-1.5">
								<Label htmlFor="tpl-desc">Description</Label>
								<Input
									id="tpl-desc"
									onChange={(event) =>
										setState((prev) => ({
											...prev,
											description: event.target.value,
										}))
									}
									placeholder="Optional notes"
									value={state.description}
								/>
							</div>
						</div>
					</DialogBody>
					<DialogFooter>
						<Button onClick={onClose} type="button" variant="ghost">
							Cancel
						</Button>
						<Button disabled={submitting} type="submit">
							{editing ? "Save" : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function PodFields({
	setState,
	state,
}: {
	setState: (updater: (prev: FormState) => FormState) => void;
	state: FormState;
}) {
	return (
		<div className="grid gap-3">
			<div className="grid grid-cols-2 gap-3">
				<div className="grid gap-1.5">
					<Label htmlFor="tpl-template-id">RunPod template ID</Label>
					<Input
						id="tpl-template-id"
						onChange={(event) =>
							setState((prev) => ({
								...prev,
								runpodTemplateId: event.target.value,
							}))
						}
						placeholder="p4f6rm9tb4"
						required
						value={state.runpodTemplateId}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="tpl-image">Image name (override)</Label>
					<Input
						id="tpl-image"
						onChange={(event) =>
							setState((prev) => ({ ...prev, imageName: event.target.value }))
						}
						placeholder="ls250824/run-comfyui-ltx:28042026"
						value={state.imageName}
					/>
				</div>
			</div>
			<div className="grid grid-cols-3 gap-3">
				<div className="grid gap-1.5">
					<Label htmlFor="tpl-cloud">Cloud type</Label>
					<Select
						items={CLOUD_TYPE_OPTIONS}
						onValueChange={(value) =>
							setState((prev) => ({
								...prev,
								cloudType: (value ?? "") as string,
							}))
						}
						value={state.cloudType}
					>
						<SelectTrigger className="w-full" id="tpl-cloud">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{CLOUD_TYPE_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="tpl-disk">Container disk (GB)</Label>
					<Input
						id="tpl-disk"
						onChange={(event) =>
							setState((prev) => ({
								...prev,
								containerDiskInGb: event.target.value,
							}))
						}
						placeholder="15"
						type="number"
						value={state.containerDiskInGb}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="tpl-volume-gb">Volume (GB)</Label>
					<Input
						id="tpl-volume-gb"
						onChange={(event) =>
							setState((prev) => ({ ...prev, volumeInGb: event.target.value }))
						}
						placeholder="90"
						type="number"
						value={state.volumeInGb}
					/>
				</div>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<div className="grid gap-1.5">
					<Label htmlFor="tpl-keepalive">Keep-alive (ms)</Label>
					<Input
						id="tpl-keepalive"
						onChange={(event) =>
							setState((prev) => ({
								...prev,
								keepAliveMs: event.target.value,
							}))
						}
						placeholder="600000"
						type="number"
						value={state.keepAliveMs}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="tpl-timeout">Pod timeout (ms)</Label>
					<Input
						id="tpl-timeout"
						onChange={(event) =>
							setState((prev) => ({ ...prev, timeoutMs: event.target.value }))
						}
						placeholder="3600000"
						type="number"
						value={state.timeoutMs}
					/>
				</div>
			</div>
		</div>
	);
}

function ServerlessFields({
	setState,
	state,
}: {
	setState: (updater: (prev: FormState) => FormState) => void;
	state: FormState;
}) {
	return (
		<div className="grid gap-1.5">
			<Label htmlFor="tpl-endpoint">RunPod serverless endpoint ID</Label>
			<Input
				id="tpl-endpoint"
				onChange={(event) =>
					setState((prev) => ({
						...prev,
						runpodEndpointId: event.target.value,
					}))
				}
				placeholder="abc12345xyz"
				required
				value={state.runpodEndpointId}
			/>
		</div>
	);
}

function VolumesPicker({
	assignments,
	onMove,
	onToggle,
	volumes,
	volumesById,
}: {
	assignments: PodTemplateVolumeAssignment[];
	onMove: (volumeId: string, delta: -1 | 1) => void;
	onToggle: (volumeId: string) => void;
	volumes: RunpodNetworkVolume[];
	volumesById: Map<string, RunpodNetworkVolume>;
}) {
	const selectedIds = new Set(assignments.map((item) => item.volumeId));
	return (
		<div className="grid gap-2">
			<Label>Network volumes (priority order, top → first)</Label>
			{assignments.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					Никаких volume'ов не выбрано — для pod-режима это обязательно.
				</p>
			) : (
				<div className="grid gap-1">
					{assignments.map((assignment, index) => {
						const vol = volumesById.get(assignment.volumeId);
						return (
							<div
								className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border border-foreground/10 bg-background px-2 py-1.5 text-xs"
								key={assignment.volumeId}
							>
								<span className="text-muted-foreground">#{index + 1}</span>
								<span className="truncate">
									{vol ? vol.name : assignment.volumeId}
									{vol ? (
										<span className="ml-2 text-muted-foreground">
											{vol.runpodVolumeId} · {vol.datacenter}
										</span>
									) : null}
								</span>
								<Button
									disabled={index === 0}
									onClick={() => onMove(assignment.volumeId, -1)}
									size="icon-xs"
									type="button"
									variant="ghost"
								>
									↑
								</Button>
								<Button
									disabled={index === assignments.length - 1}
									onClick={() => onMove(assignment.volumeId, 1)}
									size="icon-xs"
									type="button"
									variant="ghost"
								>
									↓
								</Button>
							</div>
						);
					})}
				</div>
			)}
			{volumes.length > 0 ? (
				<details className="rounded-md border border-foreground/10 bg-background px-2 py-1.5">
					<summary className="cursor-pointer text-muted-foreground text-xs">
						Add volume…
					</summary>
					<div className="mt-2 grid gap-1">
						{volumes.map((vol) => {
							const checkboxId = `tpl-volume-${vol.id}`;
							return (
								<div className="flex items-center gap-2 text-xs" key={vol.id}>
									<Checkbox
										checked={selectedIds.has(vol.id)}
										id={checkboxId}
										onCheckedChange={() => onToggle(vol.id)}
									/>
									<Label htmlFor={checkboxId}>
										{vol.name}
										<span className="ml-2 text-muted-foreground">
											{vol.runpodVolumeId} · {vol.datacenter}
										</span>
									</Label>
								</div>
							);
						})}
					</div>
				</details>
			) : (
				<p className="text-muted-foreground text-xs">
					Сначала добавьте volume'ы во вкладке Volumes.
				</p>
			)}
		</div>
	);
}
