export type InferenceStatus = "queued" | "running" | "succeeded" | "failed";

export interface InferenceSubmission {
	endpointId: string;
	jobId: string;
	status: InferenceStatus;
}

export interface InferenceJob {
	endpointId: string;
	errorSummary: string | null;
	jobId: string;
	output: unknown;
	status: InferenceStatus;
}

export interface InferenceClient {
	cancel(jobId: string, endpointId?: string): Promise<void>;
	getStatus(jobId: string, endpointId?: string): Promise<InferenceJob>;
	submit(payload: Record<string, unknown>): Promise<InferenceSubmission>;
}
