"use client";

import type {
	AdminWorkerHealthStatus,
	RunpodTrainingSettings,
	TrainingProviderName,
	TrainingProviderSettingsSnapshot,
} from "@generator/contracts/admin";
import { cn } from "@generator/ui/lib/utils";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { SettingsCard, SettingsRow } from "@/components/settings/settings-card";
import { useUpdateTrainingProvider } from "@/hooks/use-training-provider";

const PROVIDER_LABELS: Record<TrainingProviderName, string> = {
	fal: "fal.ai (z-image-trainer)",
	runpod: "RunPod (ai-toolkit)",
};

const PROVIDER_DESCRIPTIONS: Record<TrainingProviderName, string> = {
	fal: "Production-grade fal-ai/z-image-trainer pipeline. Fastest and most stable.",
	runpod:
		"Experimental ai-toolkit pipeline on RunPod. Mode (pod/serverless) is controlled by RUNPOD_TRAINING_MODE env.",
};

const PROVIDERS: TrainingProviderName[] = ["fal", "runpod"];

interface TrainingProviderCardProps {
	runpod: RunpodTrainingSettings;
	settings: TrainingProviderSettingsSnapshot;
	workerHealth?: AdminWorkerHealthStatus;
}

export function TrainingProviderCard({
	runpod,
	settings,
	workerHealth,
}: TrainingProviderCardProps) {
	const mutation = useUpdateTrainingProvider();
	const availabilityByProvider = new Map(
		settings.availability.map((entry) => [entry.provider, entry])
	);

	const errorText =
		mutation.error instanceof Error ? mutation.error.message : null;

	return (
		<SettingsCard
			action={
				mutation.isPending ? (
					<div className="inline-flex items-center gap-1 text-muted-foreground text-xs">
						<Loader2 className="size-3 animate-spin" />
						Switching…
					</div>
				) : null
			}
			description="Selected provider takes effect for new training jobs and pending approvals. Already submitted jobs finish on their original provider. Persisted in Redis."
			title="LoRA training provider"
		>
			<div className="grid gap-2">
				{PROVIDERS.map((name) => {
					const availability = availabilityByProvider.get(name);
					const configured = availability?.configured ?? true;
					const isActive = settings.provider === name;
					const disabled = !configured || mutation.isPending || isActive;

					return (
						<button
							className={cn(
								"grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-md border px-3 py-2.5 text-left transition",
								isActive
									? "border-foreground/40 bg-foreground/5"
									: "border-foreground/10 hover:bg-foreground/4",
								disabled && !isActive ? "cursor-not-allowed opacity-60" : ""
							)}
							disabled={disabled}
							key={name}
							onClick={() => mutation.mutate(name)}
							type="button"
						>
							<div className="mt-0.5">
								{isActive ? (
									<CheckCircle2 className="size-4 text-foreground" />
								) : (
									<div className="size-4 rounded-full border border-foreground/30" />
								)}
							</div>
							<div className="grid gap-1">
								<div className="flex items-center gap-2">
									<span className="font-medium text-sm">
										{PROVIDER_LABELS[name]}
									</span>
									{isActive ? (
										<span className="rounded bg-foreground px-1.5 py-0.5 font-mono text-[9px] text-background uppercase tracking-wider">
											Active
										</span>
									) : null}
								</div>
								<div className="text-muted-foreground text-xs">
									{PROVIDER_DESCRIPTIONS[name]}
								</div>
								{!configured && availability ? (
									<div className="inline-flex items-center gap-1 text-destructive text-xs">
										<XCircle className="size-3" />
										Missing env: {availability.missing.join(", ")}
									</div>
								) : null}
							</div>
						</button>
					);
				})}
			</div>

			{errorText ? (
				<div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs">
					{errorText}
				</div>
			) : null}

			{workerHealth && workerHealth.source === "gateway-fallback" ? (
				<div className="mt-3 inline-flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-700 text-xs dark:text-amber-400">
					<AlertTriangle className="mt-0.5 size-3 shrink-0" />
					<span>
						No worker heartbeat — availability is computed from the gateway env
						(which usually has no training secrets). If the worker is healthy,
						providers may actually be configured. Check the worker logs.
					</span>
				</div>
			) : null}

			<div className="mt-4 grid gap-0">
				<div className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-[0.2em]">
					RunPod runtime
				</div>
				<SettingsRow
					hint="From RUNPOD_TRAINING_MODE (controls which runner the worker uses)"
					label="Mode"
					value={runpod.mode === "pod" ? "pod (on-demand GPU)" : "serverless"}
				/>
				<SettingsRow
					hint="From RUNPOD_AI_TOOLKIT_BASE_MODEL"
					label="Base model"
					value={runpod.baseModel}
				/>
				{runpod.mode === "pod" ? (
					<>
						<SettingsRow
							hint="From RUNPOD_POD_IMAGE_NAME (default: ostris/aitoolkit:latest — кешируется на хостах)"
							label="Pod image"
							value={runpod.podImageName ?? "— not set —"}
						/>
						<SettingsRow
							hint="From RUNPOD_POD_TEMPLATE_ID (например, 0fqzfjy6f3 — официальный ostris ai-toolkit). Подсказывает scheduler-у RunPod выбрать warm-хосты."
							label="Pod template"
							value={runpod.podTemplateId ?? "— not set —"}
						/>
						<SettingsRow
							hint="From RUNPOD_POD_GPU_TYPE_IDS (comma-separated, ranked)"
							label="GPU pool"
							value={
								runpod.podGpuTypeIds.length > 0
									? runpod.podGpuTypeIds.join(", ")
									: "— not set —"
							}
						/>
						<SettingsRow
							hint="From RUNPOD_POD_BOOTSTRAP_URL (must point to pod-bootstrap.sh in our S3 / public mirror)"
							label="Bootstrap URL"
							value={runpod.bootstrapUrl ?? "— not set —"}
						/>
					</>
				) : (
					<SettingsRow
						hint="From RUNPOD_AI_TOOLKIT_ENDPOINT_ID"
						label="Endpoint ID"
						value={runpod.endpointId ?? "— not set —"}
					/>
				)}
				<SettingsRow
					hint="From RUNPOD_AI_TOOLKIT_POLL_MS"
					label="Poll interval"
					value={`${runpod.pollMs} ms`}
				/>
				<SettingsRow
					hint="From RUNPOD_AI_TOOLKIT_TIMEOUT_MS"
					label="Job timeout"
					value={`${Math.round(runpod.timeoutMs / 60_000)} min`}
				/>
			</div>
		</SettingsCard>
	);
}
