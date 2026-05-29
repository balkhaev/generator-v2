import type { InferenceStatus } from "./status";

export interface EngineSubmission {
	/** Идентификатор задачи в формате, специфичном для движка. */
	jobId: string;
	queuePosition: number | null;
	rawProviderJobReference?: string | null;
	status: InferenceStatus;
}

export interface EngineJob {
	errorSummary: string | null;
	jobId: string;
	/** Текстовая метка текущего шага (нода/шаг сэмплера), если провайдер шлёт. */
	lastLogLine: string | null;
	output: unknown;
	progressPct: number | null;
	queuePosition: number | null;
	status: InferenceStatus;
}

/**
 * Sideband options passed to `submit`. The engine decides which fields it
 * cares about; serverless engines currently ignore everything here, pod
 * engines honour `stickyKey` to keep retries on the same network volume.
 */
export interface EngineSubmitOptions {
	/**
	 * Opaque identifier of the *logical* request (typically execution id).
	 * Pod engine uses it to look up the last-successful network volume from
	 * `StickyVolumeStore` and tries that volume first on submit, so retries
	 * after a transient failure avoid re-downloading models on a cold NFS.
	 */
	stickyKey?: string;
}

/**
 * Контракт исполнения одного workflow, не зависящий от конкретного режима
 * (serverless/pod). На выходе у engine — нормализованный `InferenceStatus`,
 * сырые провайдерские строки уже не утекают наружу.
 */
export interface Engine<TInput, TOutput> {
	cancel(jobId: string): Promise<void>;
	getStatus(jobId: string): Promise<EngineJob & { output: TOutput | null }>;
	submit(
		input: TInput,
		options?: EngineSubmitOptions
	): Promise<EngineSubmission>;
}
