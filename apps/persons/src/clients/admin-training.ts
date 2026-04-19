import type {
	ApprovedDatasetItem,
	EventPublisher,
	PersonDatasetVariantRefillRequest,
} from "@generator/events";
import {
	DEBUG_CORRELATION_HEADER,
	normalizeBaseUrl,
	resolveDebugCorrelationId,
} from "@generator/http/shared";

export interface StartPersonLoraTrainingInput {
	debugCorrelationId?: string;
	description?: string;
	/**
	 * Pipeline mode for the admin runner:
	 *   - `"prep-only"` (default): generate dataset photos, upload each to
	 *     S3, then publish `awaiting-approval`. Operator must call
	 *     {@link AdminTrainingClient.confirmPersonLoraTraining} to start the
	 *     actual training.
	 *   - `"auto-train"`: legacy single-shot behaviour (datasetPrep + zip +
	 *     train). Used for retrains via `reuseDatasetUrl` or in tests.
	 */
	mode?: "prep-only" | "auto-train";
	outputName?: string;
	personId: string;
	personName: string;
	personSlug: string;
	referencePhotoUrl: string;
	referencePrompt?: string;
	/**
	 * Optional URL of an already-built reference dataset zip (e.g. от
	 * предыдущей успешной тренировки). Если задано — admin runner скипнет
	 * fal.ai-генерацию и подаст этот zip pod'у напрямую через DATASET_URL.
	 */
	reuseDatasetUrl?: string;
	trainingRunId: string;
	triggerWord?: string;
}

export interface ConfirmPersonLoraTrainingInput
	extends StartPersonLoraTrainingInput {
	approvedItems: ApprovedDatasetItem[];
}

export interface AdminTrainingClient {
	cacheExternalLora(sourceUrl: string): Promise<string>;
	confirmPersonLoraTraining(
		input: ConfirmPersonLoraTrainingInput
	): Promise<{ accepted: true; jobId: string }>;
	requestVariantRefill(input: PersonDatasetVariantRefillRequest): Promise<void>;
	startPersonLoraTraining(
		input: StartPersonLoraTrainingInput,
		options?: {
			debugCorrelationId?: string;
		}
	): Promise<{ accepted: true; jobId: string }>;
}

export function createAdminTrainingClient(
	baseUrl: string,
	token: string,
	fetchImpl: typeof fetch = fetch
): AdminTrainingClient {
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

		async cacheExternalLora(sourceUrl: string) {
			const result = await request<{ url: string; sizeBytes: number }>(
				"/api/internal/cache-lora",
				{
					body: JSON.stringify({ sourceUrl }),
					headers: { "content-type": "application/json" },
					method: "POST",
				}
			);
			return result.url;
		},

		confirmPersonLoraTraining(input: ConfirmPersonLoraTrainingInput) {
			return request<{ accepted: true; jobId: string }>(
				"/api/internal/person-lora-trainings/confirm",
				{
					body: JSON.stringify(input),
					headers: { "content-type": "application/json" },
					method: "POST",
				}
			);
		},

		async requestVariantRefill(input: PersonDatasetVariantRefillRequest) {
			await request("/api/internal/person-lora-trainings/refill-variant", {
				body: JSON.stringify(input),
				headers: { "content-type": "application/json" },
				method: "POST",
			});
		},
	};
}

export function createKafkaAdminTrainingClient(
	eventPublisher: EventPublisher,
	fallbackClient?: AdminTrainingClient
): AdminTrainingClient {
	return {
		cacheExternalLora(sourceUrl) {
			if (!fallbackClient) {
				throw new Error("Admin LoRA cache integration is not configured");
			}
			return fallbackClient.cacheExternalLora(sourceUrl);
		},
		async confirmPersonLoraTraining(input) {
			await eventPublisher.publishPersonLoraTrainingConfirmed(input);
			return {
				accepted: true,
				jobId: `person-lora-training-confirm-${input.personId}-${input.trainingRunId}`,
			};
		},
		async requestVariantRefill(input) {
			await eventPublisher.publishPersonDatasetVariantRefillRequested(input);
		},
		async startPersonLoraTraining(input, options) {
			const debugCorrelationId =
				input.debugCorrelationId ?? options?.debugCorrelationId;
			const payload = {
				...input,
				...(debugCorrelationId ? { debugCorrelationId } : {}),
			};
			await eventPublisher.publishPersonLoraTrainingRequested(payload);
			return {
				accepted: true,
				jobId: `person-lora-training-${input.personId}-${input.trainingRunId}`,
			};
		},
	};
}
