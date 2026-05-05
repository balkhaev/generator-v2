import type { LoraInferenceAvailability } from "@generator/contracts/loras";

const DEFAULT_CIVITAI_API_BASE_URL = "https://orchestration-new.civitai.com";
const TRAILING_SLASH = /\/$/;
const NO_AVAILABLE_PROVIDER_PATTERN =
	/no available provider|no provider|service provider|not currently supported/i;

type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit
) => Promise<Response>;

interface CivitaiWorkflowStepJob {
	queuePosition?: {
		support?: string | null;
	};
	status?: string | null;
}

interface CivitaiWorkflowStep {
	jobs?: CivitaiWorkflowStepJob[] | null;
	status?: string | null;
}

interface CivitaiWorkflow {
	steps?: CivitaiWorkflowStep[] | null;
}

export interface CivitaiLtx23InferenceChecker {
	check(input: {
		modelId?: number;
		sourceVersionId?: number;
		versionId?: number;
	}): Promise<LoraInferenceAvailability>;
}

interface CivitaiLtx23InferenceCheckerOptions {
	apiBaseUrl?: string;
	apiKey?: string;
	fetchImpl?: FetchLike;
}

function buildUnavailableReason(modelId?: number, versionId?: number): string {
	const suffix =
		modelId && versionId ? ` (model ${modelId} / version ${versionId})` : "";
	return `Selected Civitai LoRA${suffix} has no available Civitai inference for LTX 2.3.`;
}

function buildUrl(apiBaseUrl: string): string {
	const url = new URL("/v2/consumer/workflows", `${apiBaseUrl}/`);
	url.searchParams.set("hideMatureContent", "false");
	url.searchParams.set("wait", "0");
	url.searchParams.set("whatif", "true");
	return url.href;
}

function buildPreflightBody(input: {
	modelId: number;
	versionId: number;
}): Record<string, unknown> {
	return {
		allowMatureContent: true,
		currencies: [],
		metadata: {
			source: "admin-lora-preview",
			target: "civitai-ltx-2-3",
		},
		steps: [
			{
				$type: "videoGen",
				input: {
					duration: 3,
					engine: "ltx2.3",
					generateAudio: false,
					guidanceScale: 3,
					height: 720,
					loras: {
						[`urn:air:ltxv23:lora:civitai:${input.modelId}@${input.versionId}`]: 1,
					},
					model: "22b-dev",
					operation: "createVideo",
					prompt: "LTX 2.3 LoRA inference compatibility check",
					steps: 20,
					width: 1280,
				},
				name: "video",
				priority: "normal",
				retries: 1,
			},
		],
	};
}

function messageFromValue(value: unknown): string | null {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	if (
		value &&
		typeof value === "object" &&
		typeof (value as { message?: unknown }).message === "string"
	) {
		return (value as { message: string }).message;
	}
	return null;
}

function extractErrorMessage(body: unknown): string {
	if (!body || typeof body !== "object") {
		return "";
	}
	const record = body as Record<string, unknown>;
	for (const key of ["detail", "error", "message", "title"] as const) {
		const message = messageFromValue(record[key]);
		if (message) {
			return message;
		}
	}
	return "";
}

function hasProviderSupport(job: CivitaiWorkflowStepJob): boolean {
	const support = job.queuePosition?.support;
	return (
		support === "available" ||
		job.status === "scheduled" ||
		job.status === "processing" ||
		job.status === "succeeded"
	);
}

function hasUnsupportedStep(workflow: CivitaiWorkflow): boolean {
	return (workflow.steps ?? []).some((step) => {
		const jobs = step.jobs ?? [];
		return (
			jobs.length > 0 &&
			jobs.every((job) => !hasProviderSupport(job)) &&
			jobs.every((job) => job.status === "unassigned" || !job.status)
		);
	});
}

export function createCivitaiLtx23InferenceChecker(
	options: CivitaiLtx23InferenceCheckerOptions
): CivitaiLtx23InferenceChecker {
	const fetchImpl = options.fetchImpl ?? fetch;
	const apiBaseUrl = (
		options.apiBaseUrl ?? DEFAULT_CIVITAI_API_BASE_URL
	).replace(TRAILING_SLASH, "");

	return {
		async check({ modelId, sourceVersionId, versionId }) {
			const resolvedVersionId = versionId ?? sourceVersionId;
			if (!(modelId && resolvedVersionId)) {
				return {
					reason:
						"Civitai model id and version id are required to check LTX 2.3 inference.",
					status: "unchecked",
					target: "civitai-ltx-2-3",
				};
			}
			if (!options.apiKey) {
				return {
					reason:
						"CIVITAI_API_KEY is not configured; LTX 2.3 Civitai inference cannot be preflighted.",
					status: "unchecked",
					target: "civitai-ltx-2-3",
				};
			}

			try {
				const response = await fetchImpl(buildUrl(apiBaseUrl), {
					body: JSON.stringify(
						buildPreflightBody({ modelId, versionId: resolvedVersionId })
					),
					headers: {
						authorization: `Bearer ${options.apiKey}`,
						"content-type": "application/json",
					},
					method: "POST",
				});
				const body = (await response.json().catch(() => null)) as unknown;
				if (!response.ok) {
					const message = extractErrorMessage(body);
					if (NO_AVAILABLE_PROVIDER_PATTERN.test(message)) {
						return {
							reason: buildUnavailableReason(modelId, resolvedVersionId),
							status: "unavailable",
							target: "civitai-ltx-2-3",
						};
					}
					return {
						reason:
							message ||
							`Civitai inference preflight failed with status ${response.status}.`,
						status: "unchecked",
						target: "civitai-ltx-2-3",
					};
				}
				if (hasUnsupportedStep(body as CivitaiWorkflow)) {
					return {
						reason: buildUnavailableReason(modelId, resolvedVersionId),
						status: "unavailable",
						target: "civitai-ltx-2-3",
					};
				}
				return {
					status: "available",
					target: "civitai-ltx-2-3",
				};
			} catch (error) {
				return {
					reason:
						error instanceof Error
							? error.message
							: "Failed to preflight Civitai inference.",
					status: "unchecked",
					target: "civitai-ltx-2-3",
				};
			}
		},
	};
}
