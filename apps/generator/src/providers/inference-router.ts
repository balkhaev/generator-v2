import type {
	InferenceClient,
	InferenceJob,
	InferenceSubmission,
} from "./inference";

export function createInferenceRouter(clients: {
	fal?: InferenceClient;
}): InferenceClient {
	function routeByPayload(payload: Record<string, unknown>): InferenceClient {
		if ("__falModel" in payload && clients.fal) {
			return clients.fal;
		}
		if (clients.fal) {
			return clients.fal;
		}
		throw new Error("No inference client configured for this payload");
	}

	function routeByEndpoint(): InferenceClient {
		if (clients.fal) {
			return clients.fal;
		}
		throw new Error("No inference client configured for this endpoint");
	}

	return {
		submit(payload): Promise<InferenceSubmission> {
			return routeByPayload(payload).submit(payload);
		},

		getStatus(jobId, endpointId): Promise<InferenceJob> {
			return routeByEndpoint().getStatus(jobId, endpointId);
		},

		cancel(jobId, endpointId): Promise<void> {
			return routeByEndpoint().cancel(jobId, endpointId);
		},
	};
}
