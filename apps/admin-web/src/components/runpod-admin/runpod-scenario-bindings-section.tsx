"use client";

import type { RunpodPodTemplate } from "@generator/contracts/runpod-admin";
import { EmptyState } from "@generator/ui/components/empty-state";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@generator/ui/components/select";
import { useMemo } from "react";
import { toast } from "sonner";

import { useSetScenarioRunpodBinding } from "@/hooks/use-admin-runpod";
import type { ScenarioRunpodBinding } from "@/lib/runpod-admin-client";

const DEFAULT_BINDING_OPTION = { label: "— default —", value: "" };

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
				const bindingItems = [
					DEFAULT_BINDING_OPTION,
					...options.map((tpl) => ({ label: tpl.name, value: tpl.id })),
				];
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
						<Select
							items={bindingItems}
							onValueChange={(value) =>
								handleChange(
									binding.scenarioId,
									value ? (value as string) : null
								)
							}
							value={binding.podTemplateId ?? ""}
						>
							<SelectTrigger aria-label="Pod template binding" className="w-56">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{bindingItems.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				);
			})}
		</div>
	);
}
