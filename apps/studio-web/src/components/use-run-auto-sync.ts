"use client";

import type { ScenarioRunRecord } from "@generator/studio-client/shared";
import { useEffect, useMemo, useRef } from "react";

const POLL_INTERVAL_MS = 2500;

function isActiveStatus(status: ScenarioRunRecord["status"]) {
	return status === "queued" || status === "running";
}

export function useRunAutoSync({
	enabled,
	onSync,
	runs,
}: {
	enabled: boolean;
	onSync: (runId: string) => Promise<unknown> | undefined;
	runs: ScenarioRunRecord[];
}) {
	const onSyncRef = useRef(onSync);

	useEffect(() => {
		onSyncRef.current = onSync;
	}, [onSync]);

	const activeIdsKey = useMemo(
		() =>
			runs
				.filter((run) => isActiveStatus(run.status))
				.map((run) => run.id)
				.join(","),
		[runs]
	);

	useEffect(() => {
		if (!enabled || activeIdsKey.length === 0) {
			return;
		}

		const ids = activeIdsKey.split(",").filter(Boolean);
		let cancelled = false;

		const tick = () => {
			if (cancelled) {
				return;
			}
			for (const runId of ids) {
				Promise.resolve(onSyncRef.current(runId)).catch(() => undefined);
			}
		};

		tick();
		const interval = setInterval(tick, POLL_INTERVAL_MS);

		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [activeIdsKey, enabled]);
}
