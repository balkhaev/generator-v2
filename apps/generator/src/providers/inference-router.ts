import { isCivitaiProviderEndpointId } from "./civitai";
import type {
	InferenceClient,
	InferenceJob,
	InferenceSubmission,
} from "./inference";
import { isReplicateProviderEndpointId } from "./replicate";
import { isRunpodProviderEndpointId } from "./runpod";
import { isRunpodPodProviderEndpointId } from "./runpod-pod";

function isCivitaiPayload(payload: Record<string, unknown>): boolean {
	return "__civitaiEndpoint" in payload || "__civitaiModel" in payload;
}

function requireClient(
	client: InferenceClient | undefined,
	message: string
): InferenceClient {
	if (client) {
		return client;
	}
	throw new Error(message);
}

export function createInferenceRouter(clients: {
	civitai?: InferenceClient;
	fal?: InferenceClient;
	replicate?: InferenceClient;
	runpod?: InferenceClient;
	runpodPod?: InferenceClient;
}): InferenceClient {
	function routeByPayload(payload: Record<string, unknown>): InferenceClient {
		if (isCivitaiPayload(payload)) {
			return requireClient(
				clients.civitai,
				"Civitai inference client is not configured"
			);
		}
		if ("__runpodEndpoint" in payload) {
			return requireClient(
				clients.runpod,
				"RunPod inference client is not configured"
			);
		}
		if ("__runpodPod" in payload) {
			return requireClient(
				clients.runpodPod,
				"RunPod Pod inference client is not configured"
			);
		}
		if ("__replicateVersion" in payload) {
			return requireClient(
				clients.replicate,
				"Replicate inference client is not configured"
			);
		}
		if ("__falModel" in payload && clients.fal) {
			return clients.fal;
		}
		if (clients.fal) {
			return clients.fal;
		}
		throw new Error("No inference client configured for this payload");
	}

	function routeByEndpoint(endpointId?: string): InferenceClient {
		if (isCivitaiProviderEndpointId(endpointId)) {
			return requireClient(
				clients.civitai,
				"Civitai inference client is not configured"
			);
		}
		if (isRunpodProviderEndpointId(endpointId)) {
			return requireClient(
				clients.runpod,
				"RunPod inference client is not configured"
			);
		}
		if (isRunpodPodProviderEndpointId(endpointId)) {
			return requireClient(
				clients.runpodPod,
				"RunPod Pod inference client is not configured"
			);
		}
		if (isReplicateProviderEndpointId(endpointId)) {
			return requireClient(
				clients.replicate,
				"Replicate inference client is not configured"
			);
		}
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
			return routeByEndpoint(endpointId).getStatus(jobId, endpointId);
		},

		cancel(jobId, endpointId): Promise<void> {
			return routeByEndpoint(endpointId).cancel(jobId, endpointId);
		},
	};
}
