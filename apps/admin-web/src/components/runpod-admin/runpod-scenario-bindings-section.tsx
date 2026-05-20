"use client";

import type { RunpodPodTemplate } from "@generator/contracts/runpod-admin";
import { EmptyState } from "@generator/ui/components/empty-state";
import { useMemo } from "react";
import { toast } from "sonner";

import { useSetScenarioRunpodBinding } from "@/hooks/use-admin-runpod";
import type { ScenarioRunpodBinding } from "@/lib/runpod-admin-client";

const selectClassName =
	"h-8 rounded-md border border-foreground/10 bg-background px-2 text-xs outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

export default function RunpodScenarioBindingsSection({
	bindings,
	templates,
}: {
	bindings: ScenarioRunpodBinding[];
	templates: RunpodPodTemplate[];
}) {
	const setBinding = useSetScenarioRunpodBinding();

	const templatesByWorkflowKey = useMemo(() => {
		const grouped = new Map<string, RunpodPodTemplate[]>();
		for (const tpl of templates) {
			if (!tpl.enabled) {
				continue;
			}
			const bucket = grouped.get(tpl.workflowKey);
			if (bucket) {
				bucket.push(tpl);
			} else {
				grouped.set(tpl.workflowKey, [tpl]);
			}
		}
		return grouped;
	}, [templates]);

	const handleChange = (scenarioId: string, podTemplateId: string | null) => {
		setBinding.mutate(
			{ podTemplateId, scenarioId },
			{
				onError: (error) => toast.error(`Failed to update: ${error.message}`),
				onSuccess: () => toast.success("Scenario binding updated"),
			}
		);
	};

	if (bindings.length === 0) {
		return (
			<EmptyState
				hint="Studio scenarios появятся здесь после первого запуска студии."
				message="Сценариев пока нет"
			/>
		);
	}

	return (
		<div className="grid gap-2">
			<p className="text-muted-foreground text-xs">
				Привяжите сценарий к конкретному pod-template'у. Эта связь сейчас
				хранится в `studio_scenario.runpodPodTemplateId` и используется
				generator'ом для выбора endpoint'а / volume при submit. Пока для каждого
				workflow_key registry поддерживает один enabled template — выбор тут не
				переопределяет default registry, но готовит будущий per-scenario
				routing.
			</p>
			{bindings.map((binding) => {
				const options = templatesByWorkflowKey.get(binding.workflowKey) ?? [];
				return (
					<div
						className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-foreground/10 bg-background px-3 py-2 text-sm"
						key={binding.scenarioId}
					>
						<div className="grid gap-0.5">
							<span className="font-medium">{binding.scenarioId}</span>
							<span className="text-muted-foreground text-xs">
								workflow: {binding.workflowKey}
							</span>
						</div>
						<select
							className={selectClassName}
							onChange={(event) =>
								handleChange(
									binding.scenarioId,
									event.target.value ? event.target.value : null
								)
							}
							value={binding.podTemplateId ?? ""}
						>
							<option value="">— default —</option>
							{options.map((tpl) => (
								<option key={tpl.id} value={tpl.id}>
									{tpl.name}
								</option>
							))}
						</select>
					</div>
				);
			})}
		</div>
	);
}
