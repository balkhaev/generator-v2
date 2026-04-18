import type { DatasetBuilderSettings } from "@generator/contracts/admin";

import { SettingsCard, SettingsRow } from "@/components/settings/settings-card";

export function DatasetBuilderCard({
	settings,
}: {
	settings: DatasetBuilderSettings;
}) {
	return (
		<SettingsCard description={settings.note} title="LoRA dataset builder">
			<SettingsRow label="Editor model" value={settings.model} />
			<SettingsRow
				label="Guidance scale"
				value={settings.guidanceScale.toString()}
			/>
			<SettingsRow label="Poll interval" value={`${settings.pollMs} ms`} />
			<SettingsRow
				label="Submit timeout"
				value={`${Math.round(settings.timeoutMs / 60_000)} min`}
			/>
			<SettingsRow
				label="Negative prompt"
				value={
					<details className="cursor-pointer">
						<summary className="text-muted-foreground text-xs hover:text-foreground">
							Show
						</summary>
						<div className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">
							{settings.negativePromptPreview}
						</div>
					</details>
				}
			/>
		</SettingsCard>
	);
}
