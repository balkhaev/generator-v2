"use client";

import type { TrainingProviderName } from "@generator/contracts/admin";
import { cn } from "@generator/ui/lib/utils";
import { Loader2 } from "lucide-react";

import {
	useTrainingProvider,
	useUpdateTrainingProvider,
} from "@/hooks/use-training-provider";

const PROVIDER_LABELS: Record<TrainingProviderName, string> = {
	fal: "fal.ai (z-image)",
	runpod: "RunPod (ai-toolkit)",
};

const PROVIDERS: TrainingProviderName[] = ["fal", "runpod"];

const selectClassName =
	"h-8 rounded-md border border-foreground/10 bg-background px-2 text-xs outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";

export function TrainingProviderSwitcher() {
	const query = useTrainingProvider();
	const mutation = useUpdateTrainingProvider();

	const snapshot = query.data;
	const provider = snapshot?.provider ?? "fal";
	const availabilityByProvider = new Map(
		(snapshot?.availability ?? []).map((entry) => [entry.provider, entry])
	);

	const handleChange = (next: TrainingProviderName) => {
		if (next === provider || mutation.isPending) {
			return;
		}
		mutation.mutate(next);
	};

	const runpodAvailability = availabilityByProvider.get("runpod");
	const runpodHint =
		runpodAvailability && !runpodAvailability.configured
			? `RunPod is not configured: missing ${runpodAvailability.missing.join(", ")}`
			: undefined;

	const errorText =
		mutation.error instanceof Error ? mutation.error.message : null;

	return (
		<div
			className="inline-flex items-center gap-2"
			title={runpodHint ?? errorText ?? undefined}
		>
			<span className="text-muted-foreground text-xs">Trainer</span>
			<select
				aria-label="LoRA training provider"
				className={cn(selectClassName)}
				disabled={query.isLoading || mutation.isPending}
				onChange={(event) =>
					handleChange(event.target.value as TrainingProviderName)
				}
				value={provider}
			>
				{PROVIDERS.map((name) => {
					const availability = availabilityByProvider.get(name);
					const disabled = availability ? !availability.configured : false;
					return (
						<option disabled={disabled} key={name} value={name}>
							{PROVIDER_LABELS[name]}
							{disabled ? " — not configured" : ""}
						</option>
					);
				})}
			</select>
			{mutation.isPending ? (
				<Loader2 className="size-3 animate-spin text-muted-foreground" />
			) : null}
		</div>
	);
}
