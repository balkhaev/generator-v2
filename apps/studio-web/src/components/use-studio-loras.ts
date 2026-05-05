"use client";

import type { LoraRegistryEntry } from "@generator/contracts/loras";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";
import { useCallback, useEffect, useState } from "react";

interface LorasState {
	error: string | null;
	loras: LoraRegistryEntry[];
}

const studioApiBaseUrl = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

// Внутрипроцессный кеш по baseModel — чтобы повторное открытие compose/launch
// сразу показывало список LoRAs без мерцания "0 LoRAs" → "N LoRAs".
const lorasCache = new Map<string, LorasState>();

async function fetchStudioLoras(baseModel?: string): Promise<LorasState> {
	const params = new URLSearchParams();
	if (baseModel) {
		params.set("baseModel", baseModel);
	}
	const query = params.toString();
	try {
		const payload = await requestJson<{ loras: LoraRegistryEntry[] }>(
			`${studioApiBaseUrl}/api/loras${query ? `?${query}` : ""}`,
			{ cache: "no-store", credentials: "include" }
		);
		return { error: null, loras: payload.loras ?? [] };
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to load LoRAs";
		return { error: message, loras: [] };
	}
}

export function useStudioLoras(
	baseModel: string | undefined,
	enabled: boolean
) {
	const cacheKey = baseModel ?? "__any__";
	const cached = lorasCache.get(cacheKey);
	const [state, setState] = useState<LorasState>(
		cached ?? { error: null, loras: [] }
	);
	const mergeImported = useCallback(
		(entries: LoraRegistryEntry[]) => {
			if (entries.length === 0) {
				return;
			}
			setState((current) => {
				const importedIds = new Set(entries.map((entry) => entry.id));
				const next = {
					error: null,
					loras: [
						...entries,
						...current.loras.filter((entry) => !importedIds.has(entry.id)),
					],
				};
				lorasCache.set(cacheKey, next);
				return next;
			});
		},
		[cacheKey]
	);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		const hit = lorasCache.get(cacheKey);
		if (hit) {
			setState(hit);
		}
		let cancelled = false;
		fetchStudioLoras(baseModel).then((result) => {
			lorasCache.set(cacheKey, result);
			if (cancelled) {
				return;
			}
			setState(result);
		});
		return () => {
			cancelled = true;
		};
	}, [baseModel, cacheKey, enabled]);

	return { ...state, mergeImported };
}
