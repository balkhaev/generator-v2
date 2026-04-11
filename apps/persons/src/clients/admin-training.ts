import {
	DEBUG_CORRELATION_HEADER,
	normalizeBaseUrl,
	resolveDebugCorrelationId,
} from "@generator/http/shared";

export interface StartPersonLoraTrainingInput {
	description?: string;
	outputName?: string;
	personId: string;
	personName: string;
	personSlug: string;
	referencePhotoUrl: string;
	referencePrompt?: string;
	triggerWord?: string;
}

export type AdminTrainingClient = ReturnType<typeof createAdminTrainingClient>;

export function createAdminTrainingClient(
	baseUrl: string,
	token: string,
	fetchImpl: typeof fetch = fetch
) {
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

	async function request<T>(
		path: string,
		init?: RequestInit,
		options?: {
			debugCorrelationId?: string;
		}
	): Promise<T> {
		const debugCorrelationId = resolveDebugCorrelationId({
			correlationId: options?.debugCorrelationId,
		});
		const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
			...init,
			headers: {
				accept: "application/json",
				authorization: `Bearer ${token}`,
				[DEBUG_CORRELATION_HEADER]: debugCorrelationId,
				...(init?.headers ?? {}),
			},
		});

		if (!response.ok) {
			throw new Error(`${response.status} ${response.statusText}`.trim());
		}

		return (await response.json()) as T;
	}

	return {
		startPersonLoraTraining(
			input: StartPersonLoraTrainingInput,
			options?: {
				debugCorrelationId?: string;
			}
		) {
			return request<{ accepted: true; jobId: string }>(
				"/api/internal/person-lora-trainings",
				{
					body: JSON.stringify(input),
					headers: {
						"content-type": "application/json",
					},
					method: "POST",
				},
				options
			);
		},
	};
}
