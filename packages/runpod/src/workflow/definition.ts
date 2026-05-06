import type { S3ObjectStat, S3StorageConfig } from "@generator/storage";
import type { z } from "zod";

export type WorkflowMode = "serverless" | "pod";

export interface RunpodPolicy {
	executionTimeout?: number;
	lowPriority?: boolean;
	ttl?: number;
}

export interface ServerlessWorkflow<TInput, TOutput> {
	buildPayload(input: TInput): Record<string, unknown>;
	endpointId: string;
	id: string;
	inputSchema: z.ZodType<TInput>;
	mode: "serverless";
	parseOutput(raw: unknown): TOutput;
	policy?: RunpodPolicy;
}

export interface PodSpec {
	bootstrapUrl: string;
	cloudType?: "SECURE" | "COMMUNITY";
	containerDiskInGb?: number;
	gpuCount?: number;
	gpuTypeIds: string[];
	imageName: string;
	namePrefix?: string;
	networkVolumeId?: string;
	templateId?: string;
	timeoutMs?: number;
	volumeInGb?: number;
}

/**
 * Контекст, который PodEngine выдаёт workflow'у в момент сборки env: ID
 * запроса, presigned PUT URL'ы для артефакта и логов, публичные URL'ы для
 * чтения после загрузки. Workflow возвращает env, который попадёт в pod.
 */
export interface PodRuntimeContext {
	logPublicUrl: string;
	logUploadUrl: string;
	outputContentType: string;
	outputPublicUrl: string;
	outputUploadUrl: string;
	requestId: string;
	s3: S3StorageConfig;
	timeoutMs: number | undefined;
}

export interface PodSuccessContext {
	logPublicUrl: string;
	outputPublicUrl: string;
	outputStat: S3ObjectStat;
	podId: string;
	requestId: string;
	runpodPodConsoleUrl: string;
}

export interface PodWorkflow<TInput, TOutput> {
	artifactContentType: string;
	/** Контракт env, ожидаемый pod_runner внутри пода. */
	buildEnv(input: TInput, ctx: PodRuntimeContext): Record<string, string>;
	id: string;
	inputSchema: z.ZodType<TInput>;
	mode: "pod";
	parseOutput(ctx: PodSuccessContext): TOutput;
	pod: PodSpec;
}

export type WorkflowDefinition<TInput, TOutput> =
	| ServerlessWorkflow<TInput, TOutput>
	| PodWorkflow<TInput, TOutput>;

export type AnyWorkflowDefinition = WorkflowDefinition<unknown, unknown>;
