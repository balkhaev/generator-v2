"use client";

import type { AdminWorkerHealthStatus } from "@generator/contracts/admin";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { SettingsCard, SettingsRow } from "@/components/settings/settings-card";

interface WorkerHealthCardProps {
	health: AdminWorkerHealthStatus;
}

function formatLastSeen(lastSeenAt: string | null) {
	if (!lastSeenAt) {
		return "Never";
	}
	try {
		return new Date(lastSeenAt).toLocaleString();
	} catch {
		return lastSeenAt;
	}
}

function formatAge(ageSeconds: number | null) {
	if (ageSeconds === null) {
		return "Unknown";
	}
	if (ageSeconds < 90) {
		return `${ageSeconds}s ago`;
	}
	if (ageSeconds < 3600) {
		return `${Math.round(ageSeconds / 60)}m ago`;
	}
	return `${Math.round(ageSeconds / 3600)}h ago`;
}

export function WorkerHealthCard({ health }: WorkerHealthCardProps) {
	const fresh = health.isFresh;
	const fallback = health.source === "gateway-fallback";

	return (
		<SettingsCard
			action={
				fresh ? (
					<div className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-1 text-emerald-600 text-xs">
						<CheckCircle2 className="size-3" />
						Live
					</div>
				) : (
					<div className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-1 text-amber-600 text-xs">
						<AlertTriangle className="size-3" />
						Stale
					</div>
				)
			}
			description={
				fresh
					? "The training worker is publishing settings heartbeats. UI shows the worker's view of provider availability."
					: "No recent worker heartbeat. UI is showing the gateway's local env, which usually has no training secrets — values may look 'not configured' even when the worker is healthy."
			}
			title="Training worker health"
		>
			<SettingsRow
				hint="Heartbeat published by admin-worker every ~30s"
				label="Last seen"
				value={formatLastSeen(health.lastSeenAt)}
			/>
			<SettingsRow
				hint="Time since the most recent heartbeat"
				label="Age"
				value={formatAge(health.ageSeconds)}
			/>
			<SettingsRow
				hint={
					fallback
						? "Gateway is using its own env as fallback. Restart admin-worker if this persists."
						: "Worker snapshot is the source of truth for availability and runpod endpoint"
				}
				label="Source"
				value={health.source === "worker" ? "admin-worker" : "admin-api env"}
			/>
		</SettingsCard>
	);
}
