"use client";

import type {
	ScenarioFormState,
	WorkflowDefinition,
	WorkflowPreset,
	WorkflowPresetGroup,
} from "@generator/studio-client/shared";
import { Button } from "@generator/ui/components/button";
import { InfoTooltip } from "@generator/ui/components/info-tooltip";
import { SectionLabel } from "@generator/ui/components/section-label";
import { cn } from "@generator/ui/lib/utils";

const GROUP_LABELS: Record<WorkflowPresetGroup, string> = {
	duration: "Длительность",
	quality: "Качество",
};

const GROUP_ORDER: readonly WorkflowPresetGroup[] = ["quality", "duration"];

function isPresetActive(
	preset: WorkflowPreset,
	params: Record<string, string>
): boolean {
	return Object.entries(preset.params).every(
		([key, value]) => params[key] === String(value)
	);
}

interface WorkflowPresetsProps {
	form: ScenarioFormState;
	onApplyPreset: (preset: WorkflowPreset) => void;
	workflow: WorkflowDefinition;
}

export function WorkflowPresets({
	form,
	onApplyPreset,
	workflow,
}: WorkflowPresetsProps) {
	const presets = workflow.presets;
	if (!presets || presets.length === 0) {
		return null;
	}

	return (
		<section className="grid gap-2">
			<div className="flex items-center gap-1.5">
				<SectionLabel>Пресеты</SectionLabel>
				<InfoTooltip>
					Применяют готовый набор значений поверх текущих настроек. После
					применения можно донастроить вручную.
				</InfoTooltip>
			</div>
			<div className="grid gap-2">
				{GROUP_ORDER.map((group) => {
					const groupPresets = presets.filter(
						(preset) => preset.group === group
					);
					if (groupPresets.length === 0) {
						return null;
					}
					return (
						<div className="grid gap-1" key={group}>
							<p className="text-[11px] text-muted-foreground">
								{GROUP_LABELS[group]}
							</p>
							<div className="flex flex-wrap gap-1.5">
								{groupPresets.map((preset) => {
									const active = isPresetActive(preset, form.params);
									return (
										<Button
											className={cn(
												"h-7 px-2.5 text-[11px]",
												active && "border-primary text-primary"
											)}
											key={preset.id}
											onClick={() => onApplyPreset(preset)}
											size="sm"
											title={preset.description}
											type="button"
											variant={active ? "outline" : "ghost"}
										>
											{preset.label}
										</Button>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}
