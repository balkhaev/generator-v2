import { isCivitaiProviderEndpointId } from "./civitai";
import type {
	InferenceClient,
	InferenceJob,
	InferenceSubmission,
} from "./inference";
import { isReplicateProviderEndpointId } from "./replicate";
import { isRunpodProviderEndpointId } from "./runpod";

function isCivitaiPayload(payload: Record<string, unknown>): boolean {
	return "__civitaiEndpoint" in payload || "__civitaiModel" in payload;
}

export function createInferenceRouter(clients: {
	civitai?: InferenceClient;
	fal?: InferenceClient;
	replicate?: InferenceClient;
	runpod?: InferenceClient;
}): InferenceClient {
	function routeByPayload(payload: Record<string, unknown>): InferenceClient {
		if (isCivitaiPayload(payload)) {
			if (clients.civitai) {
				return clients.civitai;
			}
			throw new Error("Civitai inference client is not configured");
		}
		if ("__runpodEndpoint" in payload) {
			if (clients.runpod) {
				return clients.runpod;
			}
			throw new Error("RunPod inference client is not configured");
		}
		if ("__replicateVersion" in payload) {
			if (clients.replicate) {
				return clients.replicate;
			}
			throw new Error("Replicate inference client is not configured");
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
			if (clients.civitai) {
				return clients.civitai;
			}
			throw new Error("Civitai inference client is not configured");
		}
		if (isRunpodProviderEndpointId(endpointId)) {
			if (clients.runpod) {
				return clients.runpod;
			}
			throw new Error("RunPod inference client is not configured");
		}
		if (isReplicateProviderEndpointId(endpointId)) {
			if (clients.replicate) {
				return clients.replicate;
			}
			throw new Error("Replicate inference client is not configured");
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
