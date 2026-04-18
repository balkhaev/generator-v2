export type InferenceStatus = "queued" | "running" | "succeeded" | "failed";

export interface InferenceSubmission {
	endpointId: string;
	jobId: string;
	/** Последняя строка лога провайдера, если есть. */
	lastLogLine?: string | null;
	/** 0–100, если провайдер уже сообщает реальный прогресс. */
	progressPct?: number | null;
	/** Позиция в очереди провайдера в момент submit. */
	queuePosition?: number | null;
	status: InferenceStatus;
}

export interface InferenceJob {
	endpointId: string;
	errorSummary: string | null;
	jobId: string;
	/** Последняя строка лога провайдера, если есть. */
	lastLogLine?: string | null;
	output: unknown;
	/** 0–100, если провайдер сообщает реальный прогресс. */
	progressPct?: number | null;
	/** Позиция в очереди провайдера, если ещё ждём. */
	queuePosition?: number | null;
	status: InferenceStatus;
}

export interface InferenceClient {
	cancel(jobId: string, endpointId?: string): Promise<void>;
	getStatus(jobId: string, endpointId?: string): Promise<InferenceJob>;
	submit(payload: Record<string, unknown>): Promise<InferenceSubmission>;
}
