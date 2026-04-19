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

export interface InferenceStreamEvent {
	job: InferenceJob;
	/** Терминальное событие — стрим закроется сразу после него. */
	terminal: boolean;
}

export interface InferenceStreamHandle {
	/** Закрывает стрим вручную (без терминального события). */
	close(): void;
	/** Резолвится когда сервер закрыл стрим (естественно или после terminal). */
	done: Promise<void>;
}

export interface InferenceStreamOptions {
	endpointId: string;
	jobId: string;
	onEvent: (event: InferenceStreamEvent) => void | Promise<void>;
	signal?: AbortSignal;
}

export interface InferenceClient {
	cancel(jobId: string, endpointId?: string): Promise<void>;
	getStatus(jobId: string, endpointId?: string): Promise<InferenceJob>;
	/**
	 * Опциональный SSE-стрим со статусами job'а. Если провайдер не поддерживает
	 * streaming — поле остаётся undefined, и worker fallback'ается на polling.
	 *
	 * Возвращаемый handle резолвит `done` когда стрим естественно закрывается
	 * (после terminal event или из-за сетевой ошибки).
	 */
	streamStatus?: (options: InferenceStreamOptions) => InferenceStreamHandle;
	submit(payload: Record<string, unknown>): Promise<InferenceSubmission>;
}
