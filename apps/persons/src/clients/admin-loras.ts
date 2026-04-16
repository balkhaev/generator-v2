import type {
	LoraBaseModel,
	LoraRegistryEntry,
} from "@generator/contracts/loras";
import {
	DEBUG_CORRELATION_HEADER,
	normalizeBaseUrl,
	resolveDebugCorrelationId,
} from "@generator/http/shared";

export interface ListLorasOptions {
	baseModel?: LoraBaseModel;
	debugCorrelationId?: string;
}

export type AdminLoraClient = ReturnType<typeof createAdminLoraClient>;

export function createAdminLoraClient(
	baseUrl: string,
	token: string,
	fetchImpl: typeof fetch = fetch
) {
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

	return {
		async listLoras(
			options: ListLorasOptions = {}
		): Promise<LoraRegistryEntry[]> {
			const debugCorrelationId = resolveDebugCorrelationId({
				correlationId: options.debugCorrelationId,
			});
			const params = new URLSearchParams();
			if (options.baseModel) {
				params.set("baseModel", options.baseModel);
			}
			params.set("status", "active");
			const queryString = params.toString();
			const path = `/api/internal/loras${queryString ? `?${queryString}` : ""}`;
			const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
				headers: {
					accept: "application/json",
					authorization: `Bearer ${token}`,
					[DEBUG_CORRELATION_HEADER]: debugCorrelationId,
				},
			});
			if (!response.ok) {
				throw new Error(`${response.status} ${response.statusText}`.trim());
			}
			const payload = (await response.json()) as {
				loras: LoraRegistryEntry[];
			};
			return payload.loras;
		},
	};
}
