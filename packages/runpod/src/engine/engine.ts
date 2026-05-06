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
	output: unknown;
	progressPct: number | null;
	queuePosition: number | null;
	status: InferenceStatus;
}

/**
 * Контракт исполнения одного workflow, не зависящий от конкретного режима
 * (serverless/pod). На выходе у engine — нормализованный `InferenceStatus`,
 * сырые провайдерские строки уже не утекают наружу.
 */
export interface Engine<TInput, TOutput> {
	cancel(jobId: string): Promise<void>;
	getStatus(jobId: string): Promise<EngineJob & { output: TOutput | null }>;
	submit(input: TInput): Promise<EngineSubmission>;
}
