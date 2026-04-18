import type { GeneratorRuntimeSettings } from "@generator/contracts/admin";

import { SettingsCard, SettingsRow } from "@/components/settings/settings-card";

export function GeneratorRuntimeCard({
	settings,
}: {
	settings: GeneratorRuntimeSettings;
}) {
	return (
		<SettingsCard
			description="Reconcile loop in persons/studio workers. Restart required to change."
			title="Generator runtime"
		>
			<SettingsRow
				hint="From RECONCILE_INTERVAL_MS (env)"
				label="Reconcile interval"
				value={`${settings.reconcileIntervalMs} ms`}
			/>
			<SettingsRow
				hint="From RECONCILE_WATCH (env)"
				label="Watch enabled"
				value={settings.reconcileWatch ? "yes" : "no"}
			/>
		</SettingsCard>
	);
}
