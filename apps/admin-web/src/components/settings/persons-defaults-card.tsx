import type { PersonsWorkflowDefaults } from "@generator/contracts/admin";

import { SettingsCard, SettingsRow } from "@/components/settings/settings-card";

export function PersonsDefaultsCard({
	defaults,
}: {
	defaults: PersonsWorkflowDefaults;
}) {
	return (
		<SettingsCard
			description="Workflow keys that the persons service uses for avatar generation. Restart required to change env-driven values."
			title="Persons workflow defaults"
		>
			<SettingsRow
				hint="From PERSONS_DEFAULT_AVATAR_WORKFLOW (env)"
				label="Default avatar"
				value={defaults.avatarWorkflow}
			/>
			<SettingsRow
				hint="From PERSONS_DEFAULT_LORA_WORKFLOW (env)"
				label="Default LoRA"
				value={defaults.loraWorkflow}
			/>
			<SettingsRow
				hint="Hardcoded in apps/persons/src/domain/persons.ts"
				label="Avatar preview"
				value={defaults.avatarPreviewWorkflow}
			/>
			<SettingsRow
				hint="Hardcoded in apps/persons/src/domain/persons.ts"
				label="Avatar refine"
				value={defaults.avatarRefineWorkflow}
			/>
		</SettingsCard>
	);
}
