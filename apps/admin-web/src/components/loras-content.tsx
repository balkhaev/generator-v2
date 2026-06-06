"use client";

import type { LoraBaseModel } from "@generator/contracts/loras";
import { PageHeader } from "@generator/ui/components/page-header";
import { RefreshButton } from "@generator/ui/components/toolbar";
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
					<RefreshButton
						isRefreshing={isFetching}
						onRefresh={() => refetch()}
					/>
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
	const paired = selected?.pairGroupId
		? (loras.find(
				(entry) =>
					entry.id !== selected.id && entry.pairGroupId === selected.pairGroupId
			) ?? null)
		: null;
	return (
		<div className="h-full overflow-hidden rounded-lg border border-foreground/6 bg-background/80 backdrop-blur-xl dark:border-foreground/10 dark:bg-background/60">
			<LoraDetail lora={selected} paired={paired} />
		</div>
	);
}
