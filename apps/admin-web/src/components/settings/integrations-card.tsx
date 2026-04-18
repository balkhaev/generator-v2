"use client";

import type { CredentialAvailability } from "@generator/runtime-config/domains";
import { Button } from "@generator/ui/components/button";
import { Input } from "@generator/ui/components/input";
import { cn } from "@generator/ui/lib/utils";
import { CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { SettingsCard } from "@/components/settings/settings-card";
import {
	useDeleteIntegrationCredential,
	useIntegrationCredentials,
	useSetIntegrationCredential,
} from "@/hooks/use-integrations";

const PROVIDER_LABEL: Record<string, string> = {
	fal: "Fal AI",
	openrouter: "OpenRouter",
	runpod: "RunPod",
	xai: "xAI (Grok)",
};

function describeProvider(provider: string): string {
	return PROVIDER_LABEL[provider] ?? provider;
}

export function IntegrationsCard() {
	const query = useIntegrationCredentials();
	const setMutation = useSetIntegrationCredential();
	const deleteMutation = useDeleteIntegrationCredential();
	const [drafts, setDrafts] = useState<Record<string, string>>({});

	const credentials = query.data?.credentials ?? [];

	function rowKey(c: CredentialAvailability): string {
		return `${c.provider}:${c.keyName}`;
	}

	return (
		<SettingsCard
			action={
				query.isFetching ? (
					<div className="inline-flex items-center gap-1 text-muted-foreground text-xs">
						<Loader2 className="size-3 animate-spin" />
						Loading…
					</div>
				) : null
			}
			className="lg:col-span-2"
			description="Encrypted credentials stored in admin Postgres. Updates propagate to consumer services within ~10s (Redis pub/sub invalidation; otherwise on next 60s cache refresh)."
			title="Integrations & API keys"
		>
			{query.isError ? (
				<p className="text-destructive text-xs">
					{query.error instanceof Error
						? query.error.message
						: "Failed to load credentials"}
				</p>
			) : null}

			{credentials.length === 0 && !query.isFetching ? (
				<p className="text-muted-foreground text-xs">
					Runtime-config is disabled on the gateway. Set CONFIG_MASTER_KEY in
					admin-api env to enable.
				</p>
			) : null}

			<div className="grid gap-2">
				{credentials.map((c) => {
					const key = rowKey(c);
					const draft = drafts[key] ?? "";
					const setBusy =
						setMutation.isPending &&
						setMutation.variables?.provider === c.provider &&
						setMutation.variables?.keyName === c.keyName;
					const deleteBusy =
						deleteMutation.isPending &&
						deleteMutation.variables?.provider === c.provider &&
						deleteMutation.variables?.keyName === c.keyName;
					return (
						<div
							className={cn(
								"grid grid-cols-[minmax(160px,200px)_minmax(0,1fr)_auto] items-center gap-3 rounded-md border px-3 py-2",
								c.configured
									? "border-foreground/10"
									: "border-amber-500/30 bg-amber-500/5"
							)}
							key={key}
						>
							<div className="grid gap-0.5">
								<div className="flex items-center gap-2">
									<span className="font-medium text-sm">
										{describeProvider(c.provider)}
									</span>
									{c.configured ? (
										<CheckCircle2 className="size-3 text-emerald-500" />
									) : null}
								</div>
								<div className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.18em]">
									{c.keyName}
								</div>
								{c.updatedAt ? (
									<div className="text-[10px] text-muted-foreground/70">
										Updated {new Date(c.updatedAt).toLocaleString()}
									</div>
								) : (
									<div className="text-[10px] text-amber-700 dark:text-amber-400">
										Not configured
									</div>
								)}
							</div>
							<Input
								autoComplete="off"
								className="h-8 font-mono text-xs"
								onChange={(e) =>
									setDrafts((prev) => ({ ...prev, [key]: e.target.value }))
								}
								placeholder={c.configured ? "Replace value…" : "Paste value…"}
								type="password"
								value={draft}
							/>
							<div className="flex items-center gap-1">
								<Button
									className="h-8"
									disabled={setBusy || draft.trim().length === 0}
									onClick={() => {
										setMutation.mutate(
											{
												keyName: c.keyName,
												provider: c.provider,
												value: draft.trim(),
											},
											{
												onSuccess: () =>
													setDrafts((prev) => {
														const next = { ...prev };
														delete next[key];
														return next;
													}),
											}
										);
									}}
									size="sm"
									type="button"
								>
									{setBusy ? (
										<Loader2 className="size-3 animate-spin" />
									) : (
										"Save"
									)}
								</Button>
								<Button
									className="h-8 px-2"
									disabled={!c.configured || deleteBusy}
									onClick={() =>
										deleteMutation.mutate({
											keyName: c.keyName,
											provider: c.provider,
										})
									}
									size="sm"
									type="button"
									variant="ghost"
								>
									{deleteBusy ? (
										<Loader2 className="size-3 animate-spin" />
									) : (
										<Trash2 className="size-3" />
									)}
								</Button>
							</div>
						</div>
					);
				})}
			</div>

			{(setMutation.error ?? deleteMutation.error) ? (
				<div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-xs">
					{(setMutation.error ?? deleteMutation.error) instanceof Error
						? (setMutation.error ?? deleteMutation.error)?.message
						: "Operation failed"}
				</div>
			) : null}
		</SettingsCard>
	);
}
