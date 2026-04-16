"use client";

import type { LoraBaseModel } from "@generator/contracts/loras";
import { PageHeader } from "@generator/ui/components/page-header";
import { cn } from "@generator/ui/lib/utils";
import { RefreshCw } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import LoraDetail from "@/components/loras/lora-detail";
import LoraForm from "@/components/loras/lora-form";
import LoraList from "@/components/loras/lora-list";
import { useAdminLoras } from "@/hooks/use-admin-loras";

export default function LorasContent() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const [filterBaseModel, setFilterBaseModel] = useState<LoraBaseModel | "">(
		""
	);
	const selectedId = searchParams?.get("id") ?? null;

	const query = useMemo(
		() => (filterBaseModel ? { baseModel: filterBaseModel } : {}),
		[filterBaseModel]
	);

	const {
		data: loras = [],
		isFetching,
		isLoading,
		refetch,
	} = useAdminLoras(query);

	const handleSelect = useCallback(
		(id: string) => {
			const params = new URLSearchParams(searchParams?.toString() ?? "");
			if (selectedId === id) {
				params.delete("id");
			} else {
				params.set("id", id);
			}
			const search = params.toString();
			router.replace(`${pathname}${search ? `?${search}` : ""}` as Route);
		},
		[pathname, router, searchParams, selectedId]
	);

	return (
		<div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
			<PageHeader
				actions={
					<button
						className="inline-flex items-center gap-2 rounded-md border border-foreground/10 bg-background px-2.5 py-1.5 text-xs transition hover:bg-muted/30 disabled:opacity-50"
						disabled={isFetching}
						onClick={() => refetch()}
						type="button"
					>
						<RefreshCw
							className={cn("size-3", isFetching ? "animate-spin" : "")}
						/>
						Refresh
					</button>
				}
				description="LoRAs imported via S3 cache. Used by Studio and Persons workflows."
				eyebrow="LoRA registry"
				title="LoRAs"
			/>

			<div className="min-h-0 overflow-y-auto px-4 py-4">
				<div className="grid gap-4">
					<LoraForm />
					<LoraList
						filterBaseModel={filterBaseModel}
						isLoading={isLoading}
						loras={loras}
						onFilterChange={setFilterBaseModel}
						onSelect={handleSelect}
						selectedId={selectedId}
					/>
				</div>
			</div>
		</div>
	);
}

export function LorasInspector() {
	const searchParams = useSearchParams();
	const selectedId = searchParams?.get("id") ?? null;
	const { data: loras = [] } = useAdminLoras();
	const selected = loras.find((entry) => entry.id === selectedId) ?? null;
	return (
		<div className="h-full overflow-hidden rounded-lg border border-foreground/6 bg-background/80 backdrop-blur-xl dark:border-foreground/10 dark:bg-background/60">
			<LoraDetail lora={selected} />
		</div>
	);
}
