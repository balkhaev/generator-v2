"use client";

import type {
	CreateRunpodNetworkVolumeInput,
	RunpodNetworkVolume,
	UpdateRunpodNetworkVolumeInput,
} from "@generator/contracts/runpod-admin";
import { Button } from "@generator/ui/components/button";
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
import { Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
	useCreateRunpodVolume,
	useDeleteRunpodVolume,
	useUpdateRunpodVolume,
} from "@/hooks/use-admin-runpod";

const LIST_SPLIT_PATTERN = /[,\n]+/u;

interface FormState {
	datacenter: string;
	description: string;
	gpuTypeIdsRaw: string;
	name: string;
	runpodVolumeId: string;
	sizeGb: string;
}

const EMPTY: FormState = {
	datacenter: "",
	description: "",
	gpuTypeIdsRaw: "",
	name: "",
	runpodVolumeId: "",
	sizeGb: "",
};

function toFormState(volume: RunpodNetworkVolume): FormState {
	return {
		datacenter: volume.datacenter,
		description: volume.description,
		gpuTypeIdsRaw: volume.gpuTypeIds.join(", "),
		name: volume.name,
		runpodVolumeId: volume.runpodVolumeId,
		sizeGb: String(volume.sizeGb),
	};
}

function parseGpuList(raw: string): string[] {
	return raw
		.split(LIST_SPLIT_PATTERN)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

export default function RunpodVolumesSection({
	volumes,
}: {
	volumes: RunpodNetworkVolume[];
}) {
	const [editing, setEditing] = useState<RunpodNetworkVolume | null>(null);
	const [open, setOpen] = useState(false);
	const deleteMutation = useDeleteRunpodVolume();

	const handleAdd = () => {
		setEditing(null);
		setOpen(true);
	};

	const handleEdit = (volume: RunpodNetworkVolume) => {
		setEditing(volume);
		setOpen(true);
	};

	const handleDelete = (volume: RunpodNetworkVolume) => {
		// biome-ignore lint/suspicious/noAlert: admin-only destructive action, native confirm is acceptable here
		if (!window.confirm(`Удалить volume "${volume.name}"?`)) {
			return;
		}
		deleteMutation.mutate(volume.id, {
			onError: (error) => toast.error(`Failed to delete: ${error.message}`),
			onSuccess: () => toast.success(`Volume "${volume.name}" deleted`),
		});
	};

	return (
		<div className="grid gap-3">
			<div className="flex items-center justify-end">
				<Button onClick={handleAdd} size="sm" type="button">
					<Plus className="size-3.5" />
					New volume
				</Button>
			</div>

			{volumes.length === 0 ? (
				<EmptyState
					hint="Создайте запись о volume, который уже существует в RunPod console."
					message="Volumes ещё нет"
				/>
			) : (
				<div className="grid gap-2">
					{volumes.map((volume) => (
						<button
							className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md border border-foreground/10 bg-background px-3 py-2 text-left transition hover:bg-muted/30"
							key={volume.id}
							onClick={() => handleEdit(volume)}
							type="button"
						>
							<div className="grid gap-0.5">
								<span className="font-medium text-sm">{volume.name}</span>
								<span className="text-muted-foreground text-xs">
									{volume.runpodVolumeId} · {volume.datacenter}
									{volume.sizeGb > 0 ? ` · ${volume.sizeGb} GB` : ""}
									{volume.gpuTypeIds.length > 0
										? ` · ${volume.gpuTypeIds.length} GPU types`
										: ""}
								</span>
							</div>
							<span className="text-muted-foreground text-xs">
								{volume.gpuTypeIds.slice(0, 2).join(", ")}
								{volume.gpuTypeIds.length > 2 ? "…" : ""}
							</span>
							<Button
								onClick={(event) => {
									event.stopPropagation();
									handleDelete(volume);
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

			<VolumeFormDialog
				editing={editing}
				onClose={() => setOpen(false)}
				open={open}
			/>
		</div>
	);
}

function VolumeFormDialog({
	editing,
	onClose,
	open,
}: {
	editing: RunpodNetworkVolume | null;
	onClose: () => void;
	open: boolean;
}) {
	const [state, setState] = useState<FormState>(
		editing ? toFormState(editing) : EMPTY
	);
	const [submitting, setSubmitting] = useState(false);
	const createMutation = useCreateRunpodVolume();
	const updateMutation = useUpdateRunpodVolume();

	const handleOpenChange = (next: boolean) => {
		if (!next) {
			onClose();
			return;
		}
		setState(editing ? toFormState(editing) : EMPTY);
	};

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setSubmitting(true);
		const sizeGbNum = Number(state.sizeGb);
		const base = {
			datacenter: state.datacenter,
			description: state.description,
			gpuTypeIds: parseGpuList(state.gpuTypeIdsRaw),
			name: state.name,
			runpodVolumeId: state.runpodVolumeId,
			sizeGb: Number.isFinite(sizeGbNum) && sizeGbNum > 0 ? sizeGbNum : 0,
		};
		try {
			if (editing) {
				await updateMutation.mutateAsync({
					id: editing.id,
					patch: base satisfies UpdateRunpodNetworkVolumeInput,
				});
				toast.success(`Volume "${state.name}" updated`);
			} else {
				await createMutation.mutateAsync(
					base satisfies CreateRunpodNetworkVolumeInput
				);
				toast.success(`Volume "${state.name}" created`);
			}
			onClose();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to save volume"
			);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Dialog onOpenChange={handleOpenChange} open={open}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>{editing ? "Edit volume" : "New volume"}</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<DialogBody>
						<div className="grid gap-3">
							<div className="grid gap-1.5">
								<Label htmlFor="vol-name">Name</Label>
								<Input
									id="vol-name"
									onChange={(event) =>
										setState((prev) => ({ ...prev, name: event.target.value }))
									}
									placeholder="LTX EU central"
									required
									value={state.name}
								/>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="vol-runpod-id">RunPod volume ID</Label>
								<Input
									id="vol-runpod-id"
									onChange={(event) =>
										setState((prev) => ({
											...prev,
											runpodVolumeId: event.target.value,
										}))
									}
									placeholder="lxhsmu1ax5"
									required
									value={state.runpodVolumeId}
								/>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div className="grid gap-1.5">
									<Label htmlFor="vol-dc">Datacenter</Label>
									<Input
										id="vol-dc"
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												datacenter: event.target.value,
											}))
										}
										placeholder="EU-RO-1"
										required
										value={state.datacenter}
									/>
								</div>
								<div className="grid gap-1.5">
									<Label htmlFor="vol-size">Size (GB)</Label>
									<Input
										id="vol-size"
										onChange={(event) =>
											setState((prev) => ({
												...prev,
												sizeGb: event.target.value,
											}))
										}
										placeholder="100"
										type="number"
										value={state.sizeGb}
									/>
								</div>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="vol-gpus">GPU type IDs (comma-separated)</Label>
								<Input
									id="vol-gpus"
									onChange={(event) =>
										setState((prev) => ({
											...prev,
											gpuTypeIdsRaw: event.target.value,
										}))
									}
									placeholder="NVIDIA A40, NVIDIA RTX A6000"
									value={state.gpuTypeIdsRaw}
								/>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="vol-desc">Description</Label>
								<Input
									id="vol-desc"
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
