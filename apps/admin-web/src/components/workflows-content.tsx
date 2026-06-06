"use client";

import type {
	AdminWorkflowListResponse,
	AdminWorkflowSummary,
} from "@generator/contracts/admin";
import { getBaseModelLabel } from "@generator/contracts/base-models";
import { Button } from "@generator/ui/components/button";
import {
	DataList,
	type DataListColumn,
} from "@generator/ui/components/data-list";
import { EmptyState } from "@generator/ui/components/empty-state";
import { PageHeader } from "@generator/ui/components/page-header";
import { SearchInput } from "@generator/ui/components/search-input";
import { StatusBadge } from "@generator/ui/components/status-badge";
import { RefreshButton } from "@generator/ui/components/toolbar";
import { cn } from "@generator/ui/lib/utils";
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
	useAdminWorkflows,
	useUpdateAdminWorkflow,
} from "@/hooks/use-admin-workflows";

function formatDuration(ms: number | null) {
	if (ms === null) {
		return "n/a";
	}
	if (ms < 60_000) {
		return `${Math.round(ms / 1000)}s`;
	}
	return `${Math.round(ms / 60_000)}m`;
}

function stringifyDefault(value: unknown) {
	if (value === undefined || value === null || value === "") {
		return "empty";
	}
	if (typeof value === "string") {
		return value;
	}
	return JSON.stringify(value);
}

function workflowMatchesSearch(workflow: AdminWorkflowSummary, term: string) {
	const baseModel = workflow.baseModel
		? getBaseModelLabel(workflow.baseModel)
		: "";
	return (
		workflow.name.toLowerCase().includes(term) ||
		workflow.key.toLowerCase().includes(term) ||
		baseModel.toLowerCase().includes(term)
	);
}

function WorkflowStatus({ workflow }: { workflow: AdminWorkflowSummary }) {
	return workflow.active ? (
		<StatusBadge icon={CheckCircle2} tone="success">
			Active
		</StatusBadge>
	) : (
		<StatusBadge icon={EyeOff} tone="muted">
			Hidden
		</StatusBadge>
	);
}

function WorkflowDetail({
	isSaving,
	onToggleActive,
	workflow,
}: {
	isSaving: boolean;
	onToggleActive: (workflow: AdminWorkflowSummary) => void;
	workflow: AdminWorkflowSummary | null;
}) {
	if (!workflow) {
		return (
			<div className="grid min-h-0 place-items-center border-foreground/10 border-t px-4 lg:border-t-0 lg:border-l">
				<EmptyState
					hint="Select a workflow from the catalog."
					message="No workflow selected"
				/>
			</div>
		);
	}

	let ToggleIcon = Eye;
	if (isSaving) {
		ToggleIcon = Loader2;
	} else if (workflow.active) {
		ToggleIcon = EyeOff;
	}

	return (
		<aside className="min-h-0 overflow-y-auto border-foreground/10 border-t bg-background/60 px-4 py-4 lg:border-t-0 lg:border-l">
			<div className="grid gap-5">
				<header className="grid gap-3">
					<div className="flex items-start justify-between gap-3">
						<div className="grid min-w-0 gap-1">
							<h2 className="truncate font-medium text-base">
								{workflow.name}
							</h2>
							<code className="truncate rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
								{workflow.key}
							</code>
						</div>
						<WorkflowStatus workflow={workflow} />
					</div>
					<p className="text-muted-foreground text-xs leading-relaxed">
						{workflow.description}
					</p>
					<Button
						aria-checked={workflow.active}
						disabled={isSaving}
						onClick={() => onToggleActive(workflow)}
						role="switch"
						size="sm"
						type="button"
						variant={workflow.active ? "outline" : "default"}
					>
						<ToggleIcon
							className={cn("size-3.5", isSaving ? "animate-spin" : "")}
						/>
						{workflow.active ? "Hide in Studio" : "Show in Studio"}
					</Button>
				</header>

				<section className="grid gap-2">
					<h3 className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
						Runtime
					</h3>
					<div className="grid gap-2 text-xs">
						<DetailRow
							label="Base model"
							value={
								workflow.baseModel
									? getBaseModelLabel(workflow.baseModel)
									: "Unspecified"
							}
						/>
						<DetailRow
							label="Input"
							value={
								workflow.requiresInputImage ? "Image required" : "Text only"
							}
						/>
						<DetailRow
							label="Expected duration"
							value={formatDuration(workflow.expectedDurationMs)}
						/>
					</div>
				</section>

				<section className="grid gap-2">
					<div className="flex items-center justify-between gap-2">
						<h3 className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
							Parameters
						</h3>
						<span className="text-[11px] text-muted-foreground">
							{workflow.parameterFields.length}
						</span>
					</div>
					<div className="grid divide-y divide-foreground/5 rounded-md border border-foreground/10">
						{workflow.parameterFields.length > 0 ? (
							workflow.parameterFields.map((field) => (
								<div className="grid gap-1 px-3 py-2" key={field.key}>
									<div className="flex items-center justify-between gap-2">
										<span className="truncate font-medium text-xs">
											{field.label}
										</span>
										<span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
											{field.type}
										</span>
									</div>
									<div className="grid gap-0.5 text-[11px] text-muted-foreground">
										<span className="truncate">{field.key}</span>
										<span className="line-clamp-2">{field.description}</span>
										<span className="truncate">
											Default: {stringifyDefault(workflow.defaults[field.key])}
										</span>
									</div>
								</div>
							))
						) : (
							<div className="px-3 py-4">
								<EmptyState
									hint="This workflow does not expose tunable parameters."
									message="No parameters"
								/>
							</div>
						)}
					</div>
				</section>
			</div>
		</aside>
	);
}

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-2 border-foreground/5 border-b py-1.5 last:border-b-0">
			<span className="text-muted-foreground">{label}</span>
			<span className="min-w-0 truncate text-foreground">{value}</span>
		</div>
	);
}

export default function WorkflowsContent({
	initialData,
}: {
	initialData: AdminWorkflowListResponse | null;
}) {
	const { data, isFetching, refetch } = useAdminWorkflows(initialData);
	const mutation = useUpdateAdminWorkflow();
	const workflows = data?.workflows ?? [];
	const [search, setSearch] = useState("");
	const [selectedWorkflowKey, setSelectedWorkflowKey] = useState<string | null>(
		workflows[0]?.key ?? null
	);

	useEffect(() => {
		if (
			selectedWorkflowKey &&
			workflows.some((workflow) => workflow.key === selectedWorkflowKey)
		) {
			return;
		}
		setSelectedWorkflowKey(workflows[0]?.key ?? null);
	}, [selectedWorkflowKey, workflows]);

	const filteredWorkflows = useMemo(() => {
		const term = search.trim().toLowerCase();
		if (!term) {
			return workflows;
		}
		return workflows.filter((workflow) =>
			workflowMatchesSearch(workflow, term)
		);
	}, [search, workflows]);

	const selectedWorkflow =
		workflows.find((workflow) => workflow.key === selectedWorkflowKey) ?? null;
	const activeCount = workflows.filter((workflow) => workflow.active).length;
	const inactiveCount = workflows.length - activeCount;

	const columns: DataListColumn<AdminWorkflowSummary>[] = [
		{
			key: "name",
			header: "Workflow",
			width: "minmax(0,1.5fr)",
			render: (workflow) => (
				<div className="grid gap-0.5">
					<span className="truncate font-medium text-sm">{workflow.name}</span>
					<span className="truncate text-[11px] text-muted-foreground">
						{workflow.key}
					</span>
				</div>
			),
		},
		{
			key: "model",
			header: "Model",
			width: "8rem",
			hideOnMobile: true,
			render: (workflow) => (
				<span className="text-[11px] text-muted-foreground">
					{workflow.baseModel ? getBaseModelLabel(workflow.baseModel) : "n/a"}
				</span>
			),
		},
		{
			key: "params",
			header: "Params",
			width: "5rem",
			align: "right",
			render: (workflow) => (
				<span className="text-[11px] text-muted-foreground tabular-nums">
					{workflow.parameterFields.length}
				</span>
			),
		},
		{
			key: "status",
			header: "Studio",
			width: "6.5rem",
			align: "right",
			render: (workflow) => <WorkflowStatus workflow={workflow} />,
		},
	];

	function handleToggleActive(workflow: AdminWorkflowSummary) {
		const active = !workflow.active;
		mutation.mutate(
			{
				input: { active },
				workflowKey: workflow.key,
			},
			{
				onError: (error) => {
					toast.error(
						error instanceof Error
							? error.message
							: "Unable to update workflow."
					);
				},
				onSuccess: () => {
					toast.success(
						active
							? `${workflow.name} is visible in Studio.`
							: `${workflow.name} is hidden from Studio.`
					);
				},
			}
		);
	}

	return (
		<div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
			<PageHeader
				actions={
					<div className="flex items-center gap-2">
						<SearchInput
							className="w-56"
							onValueChange={setSearch}
							placeholder="Search workflows"
							value={search}
						/>
						<RefreshButton
							isRefreshing={isFetching}
							onRefresh={() => refetch()}
						/>
					</div>
				}
				description={`${activeCount} active, ${inactiveCount} hidden. Hidden workflows stay runnable for existing scenarios but disappear from new Studio choices.`}
				eyebrow="Workflow catalog"
				title="Workflows"
			/>

			<div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(18rem,40vh)] lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)] lg:grid-rows-none">
				<div className="min-h-0 overflow-y-auto px-4 py-4">
					{data ? (
						<DataList
							columns={columns}
							emptyState={
								<EmptyState
									hint="The workflow registry did not return any entries."
									message="No workflows"
								/>
							}
							getRowKey={(workflow) => workflow.key}
							onRowClick={(workflow) => setSelectedWorkflowKey(workflow.key)}
							rows={filteredWorkflows}
						/>
					) : (
						<EmptyState
							hint="Make sure admin-api is reachable and runtime config routes are enabled."
							message="Workflows unavailable"
						/>
					)}
				</div>
				<WorkflowDetail
					isSaving={
						mutation.isPending &&
						mutation.variables?.workflowKey === selectedWorkflow?.key
					}
					onToggleActive={handleToggleActive}
					workflow={selectedWorkflow}
				/>
			</div>
		</div>
	);
}
