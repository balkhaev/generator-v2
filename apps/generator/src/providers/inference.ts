export type InferenceStatus = "queued" | "running" | "succeeded" | "failed";

export class NonRetryableInferenceError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "NonRetryableInferenceError";
	}
}

export function isNonRetryableInferenceError(
	error: unknown
): error is NonRetryableInferenceError {
	return (
		error instanceof NonRetryableInferenceError ||
		(error instanceof Error && error.name === "NonRetryableInferenceError")
	);
}

/**
 * Provider asked us to wait and try again — capacity is temporarily exhausted
 * but the request itself is valid. Worker should re-queue the job with
 * `delayMs` delay (not counted as a retry attempt) until total wall-clock
 * elapsed since the original enqueue exceeds `maxWindowMs`, then give up.
 *
 * `cause` preserves the underlying provider error for logs / debugging.
 */
export class RetryableInferenceError extends Error {
	readonly delayMs: number;
	readonly maxWindowMs: number;

	constructor(
		message: string,
		options: { cause?: unknown; delayMs: number; maxWindowMs: number }
	) {
		super(message, options.cause ? { cause: options.cause } : undefined);
		this.name = "RetryableInferenceError";
		this.delayMs = options.delayMs;
		this.maxWindowMs = options.maxWindowMs;
	}
}

export function isRetryableInferenceError(
	error: unknown
): error is RetryableInferenceError {
	return (
		error instanceof RetryableInferenceError ||
		(error instanceof Error && error.name === "RetryableInferenceError")
	);
}

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

/**
 * Optional submit-side hints that the inference router/provider may honour.
 * Adding a new field here is non-breaking: providers that don't care simply
 * ignore the option.
 */
export interface InferenceSubmitOptions {
	/**
	 * Opaque execution identifier. RunPod pod provider uses it to keep
	 * retries on the same network volume (sticky-volume cache).
	 */
	stickyKey?: string;
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
	submit(
		payload: Record<string, unknown>,
		options?: InferenceSubmitOptions
	): Promise<InferenceSubmission>;
}
