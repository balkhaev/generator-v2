import type {
	InferenceClient,
	InferenceJob,
	InferenceSubmission,
} from "./inference";

export function createInferenceRouter(clients: {
	cerebrium?: InferenceClient;
	fal?: InferenceClient;
}): InferenceClient {
	function routeByPayload(payload: Record<string, unknown>): InferenceClient {
		if ("__cerebriumApp" in payload && clients.cerebrium) {
			return clients.cerebrium;
		}
		if ("__falModel" in payload && clients.fal) {
			return clients.fal;
		}
		if (clients.fal) {
			return clients.fal;
		}
		if (clients.cerebrium) {
			return clients.cerebrium;
		}
		throw new Error("No inference client configured for this payload");
	}

	function routeByEndpoint(endpointId?: string): InferenceClient {
		if (
			(endpointId?.includes("cerebrium") || endpointId?.includes("/")) &&
			clients.cerebrium &&
			endpointId &&
			!endpointId.includes("fal-ai") &&
			!endpointId.includes("fal.ai")
		) {
			return clients.cerebrium;
		}
		if (clients.fal) {
			return clients.fal;
		}
		if (clients.cerebrium) {
			return clients.cerebrium;
		}
		throw new Error("No inference client configured for this endpoint");
	}

	return {
		submit(payload): Promise<InferenceSubmission> {
			return routeByPayload(payload).submit(payload);
		},

		getStatus(jobId, endpointId): Promise<InferenceJob> {
			return routeByEndpoint(endpointId).getStatus(jobId, endpointId);
		},

		cancel(jobId, endpointId): Promise<void> {
			return routeByEndpoint(endpointId).cancel(jobId, endpointId);
		},
	};
}
