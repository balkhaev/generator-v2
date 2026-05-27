import { createDb } from "@generator/db";
import { and, desc, eq, inArray } from "@generator/db/operators";
import { generatorExecution } from "@generator/db/schema/generator";
import { lora } from "@generator/db/schema/loras";
import { person, personGeneration } from "@generator/db/schema/persons";
import { studioRun, studioScenario } from "@generator/db/schema/studio";
import {
	collectServiceHealth,
	fetchServiceSnapshot,
	getDefaultServiceNames,
	getWorkspaceRoot,
	type ServiceName,
} from "@generator/debug-tools/shared";
import { getDatabaseUrl } from "@generator/env/server";
import { getWorkflowDefinition } from "@generator/workflows";
import { type Job, Queue } from "bullmq";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import IORedis, { type Redis } from "ioredis";
import {
	type EachMessagePayload,
	Kafka,
	logLevel,
	type SASLOptions,
} from "kafkajs";

import { getTestUser, upsertTestUser } from "@/test-users";

interface JsonRpcRequest {
	id?: number | string | null;
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcResponse {
	error?: {
		code: number;
		message: string;
	};
	id: number | string | null;
	jsonrpc: "2.0";
	result?: unknown;
}

interface AppOptions {
	authToken: string;
}

const supportedServices = new Set(getDefaultServiceNames());
const DEFAULT_KAFKA_TIMEOUT_MS = 5000;
const MAX_KAFKA_TIMEOUT_MS = 30_000;
const DEFAULT_KAFKA_SAMPLE_LIMIT = 10;
const MAX_KAFKA_SAMPLE_LIMIT = 100;
const ADMIN_LORA_TRAINING_QUEUE = "admin-person-lora-training";
const DEFAULT_QUEUE_JOB_LIMIT = 25;
const MAX_QUEUE_JOB_LIMIT = 100;
const DEFAULT_LOCK_LIMIT = 100;
const MAX_LOCK_LIMIT = 500;
const DEFAULT_LORA_DEBUG_GENERATION_LIMIT = 5;
const MAX_LORA_DEBUG_GENERATION_LIMIT = 20;
const DEFAULT_STUDIO_EXECUTION_DEBUG_LIMIT = 10;
const MAX_STUDIO_EXECUTION_DEBUG_LIMIT = 25;
const FAL_LORA_SIZE_LIMIT_BYTES = 1_000_000_000;

const toolDefinitions = [
	{
		description: "Return workspace debug summary and default service URLs.",
		inputSchema: {
			properties: {},
			type: "object",
		},
		name: "workspace_summary",
	},
	{
		description: "Check backend health endpoints.",
		inputSchema: {
			properties: {
				services: {
					items: {
						type: "string",
					},
					type: "array",
				},
			},
			type: "object",
		},
		name: "service_health",
	},
	{
		description:
			"Issue an authenticated-free debug request to a backend service.",
		inputSchema: {
			properties: {
				body: {
					type: "object",
				},
				headers: {
					additionalProperties: {
						type: "string",
					},
					type: "object",
				},
				method: {
					type: "string",
				},
				path: {
					type: "string",
				},
				service: {
					type: "string",
				},
			},
			required: ["path", "service"],
			type: "object",
		},
		name: "service_request",
	},
	{
		description: "List generator workflows from the generator api.",
		inputSchema: {
			properties: {},
			type: "object",
		},
		name: "generator_workflows_get",
	},
	{
		description:
			"List LoRAs from the admin registry, optionally filtering by base model and status. Useful for debugging why a LoRA does not appear in studio compose.",
		inputSchema: {
			properties: {
				baseModel: {
					description:
						"Filter by exact base model id (e.g. 'ltx-2-3', 'z-image-turbo').",
					type: "string",
				},
				status: {
					description: "'active' (default) or 'archived'.",
					type: "string",
				},
			},
			type: "object",
		},
		name: "lora_list",
	},
	{
		description: "Fetch a single LoRA from the admin registry by id.",
		inputSchema: {
			properties: {
				id: {
					type: "string",
				},
			},
			required: ["id"],
			type: "object",
		},
		name: "lora_get",
	},
	{
		description: "Submit a generator execution directly for debugging.",
		inputSchema: {
			properties: {
				inputImageUrl: {
					type: "string",
				},
				params: {
					type: "object",
				},
				prompt: {
					type: "string",
				},
				workflowKey: {
					type: "string",
				},
			},
			required: ["prompt", "workflowKey"],
			type: "object",
		},
		name: "generator_execution_submit",
	},
	{
		description: "Sync an existing generator execution against the provider.",
		inputSchema: {
			properties: {
				providerEndpointId: {
					type: "string",
				},
				providerJobId: {
					type: "string",
				},
				workflowKey: {
					type: "string",
				},
			},
			required: ["providerJobId", "workflowKey"],
			type: "object",
		},
		name: "generator_execution_sync",
	},
	{
		description:
			"Create or update a credential-based test user that can sign into the apps.",
		inputSchema: {
			properties: {
				email: {
					type: "string",
				},
				emailVerified: {
					type: "boolean",
				},
				name: {
					type: "string",
				},
				password: {
					type: "string",
				},
			},
			required: ["email", "password"],
			type: "object",
		},
		name: "test_user_upsert",
	},
	{
		description: "Fetch information about a previously created test user.",
		inputSchema: {
			properties: {
				email: {
					type: "string",
				},
				userId: {
					type: "string",
				},
			},
			type: "object",
		},
		name: "test_user_get",
	},
	{
		description:
			"List all persons from the persons service (id, slug, status, lora training status).",
		inputSchema: {
			properties: {},
			type: "object",
		},
		name: "persons_list",
	},
	{
		description:
			"Get full state of a single person, including dataset, generations and lora training history.",
		inputSchema: {
			properties: {
				personId: {
					type: "string",
				},
			},
			required: ["personId"],
			type: "object",
		},
		name: "persons_get",
	},
	{
		description:
			"Re-trigger LoRA training for an existing person. The person must already have a completed dataset (referencePhotoUrl). Use this for smoke-testing the training pipeline against the currently selected provider (fal/runpod).",
		inputSchema: {
			properties: {
				outputName: {
					description: "Optional override for the output LoRA name.",
					type: "string",
				},
				personId: {
					type: "string",
				},
				referencePrompt: {
					description: "Optional override for the trigger phrase prompt.",
					type: "string",
				},
				triggerWord: {
					description: "Optional override for the trigger word/token.",
					type: "string",
				},
			},
			required: ["personId"],
			type: "object",
		},
		name: "persons_retrain_lora",
	},
	{
		description:
			"Reupload Adorely-imported person reference assets into Generator storage and update broken dataset/photo URLs. Dry-run by default; set apply=true to mutate prod data.",
		inputSchema: {
			properties: {
				apply: {
					description: "When true, uploads files and updates the person.",
					type: "boolean",
				},
				companionId: {
					description:
						"Optional Adorely companion id override. Defaults to person.metadata.imports.adorely.id.",
					type: "string",
				},
				personId: {
					type: "string",
				},
				targetImportedAssetCount: {
					description:
						"Optional cap for imported Adorely dataset rows to repair.",
					type: "number",
				},
			},
			required: ["personId"],
			type: "object",
		},
		name: "persons_reupload_adorely_assets",
	},
	{
		description:
			"Debug whether person generations used the trained LoRA by reading person, generation and generator execution records.",
		inputSchema: {
			properties: {
				executionId: {
					description:
						"Optional generator execution id to inspect even if the generation row is not among the latest rows.",
					type: "string",
				},
				generationId: {
					description: "Optional person generation id to inspect.",
					type: "string",
				},
				limit: {
					description:
						"How many recent generations to inspect when generationId is omitted. Defaults to 5, max 20.",
					type: "number",
				},
				personId: {
					description: "Person id. Either personId or personSlug is required.",
					type: "string",
				},
				personSlug: {
					description:
						"Person slug, e.g. adorely-p8gbnrfcgndvpasxlhc-j. Used when personId is not known.",
					type: "string",
				},
			},
			type: "object",
		},
		name: "persons_lora_generation_debug",
	},
	{
		description:
			"Read the currently configured LoRA training provider and per-provider availability (env-vars status, source: worker vs gateway-fallback).",
		inputSchema: {
			properties: {},
			type: "object",
		},
		name: "training_provider_get",
	},
	{
		description:
			"Switch the active LoRA training provider at runtime. Persists the choice in Redis. New jobs go to the new provider, in-flight jobs finish on their original provider.",
		inputSchema: {
			properties: {
				provider: {
					description: "'fal' or 'runpod'",
					enum: ["fal", "runpod"],
					type: "string",
				},
			},
			required: ["provider"],
			type: "object",
		},
		name: "training_provider_set",
	},
	{
		description:
			"Read the full admin settings snapshot (training provider, runpod endpoint, dataset builder, persons defaults, generator runtime, worker health).",
		inputSchema: {
			properties: {},
			type: "object",
		},
		name: "admin_settings_get",
	},
	{
		description:
			"Read-only snapshot of the admin LoRA training BullMQ queue and related Redis idempotency locks. Use when person LoRA trainings or dataset refills appear stuck.",
		inputSchema: {
			properties: {
				includeLocks: {
					description:
						"Whether to include Redis idempotency lock keys and TTLs. Defaults to true.",
					type: "boolean",
				},
				jobLimit: {
					description:
						"Max jobs per BullMQ state to return. Defaults to 25, max 100.",
					type: "number",
				},
				lockLimit: {
					description:
						"Max Redis lock keys per prefix to return. Defaults to 100, max 500.",
					type: "number",
				},
			},
			type: "object",
		},
		name: "admin_lora_training_queue_snapshot",
	},
	{
		description:
			"Describe the configured Kafka cluster, brokers, controller, and topic count.",
		inputSchema: {
			properties: {},
			type: "object",
		},
		name: "kafka_cluster_info",
	},
	{
		description:
			"List Kafka topics, optionally including internal topics and partition metadata.",
		inputSchema: {
			properties: {
				includeInternal: {
					type: "boolean",
				},
				includeMetadata: {
					type: "boolean",
				},
				search: {
					type: "string",
				},
			},
			type: "object",
		},
		name: "kafka_topics_list",
	},
	{
		description: "Fetch partition offsets for a Kafka topic.",
		inputSchema: {
			properties: {
				topic: {
					type: "string",
				},
			},
			required: ["topic"],
			type: "object",
		},
		name: "kafka_topic_offsets",
	},
	{
		description: "List Kafka consumer groups.",
		inputSchema: {
			properties: {
				search: {
					type: "string",
				},
			},
			type: "object",
		},
		name: "kafka_consumer_groups_list",
	},
	{
		description:
			"Describe one Kafka consumer group, including members and committed offsets with lag.",
		inputSchema: {
			properties: {
				groupId: {
					type: "string",
				},
			},
			required: ["groupId"],
			type: "object",
		},
		name: "kafka_consumer_group_describe",
	},
	{
		description:
			"Consume a small sample from a Kafka topic with an isolated MCP consumer group.",
		inputSchema: {
			properties: {
				fromBeginning: {
					type: "boolean",
				},
				limit: {
					type: "number",
				},
				timeoutMs: {
					type: "number",
				},
				topic: {
					type: "string",
				},
			},
			required: ["topic"],
			type: "object",
		},
		name: "kafka_topic_sample",
	},
	{
		description:
			"Force-mark a studio run as 'failed' with an explanatory error summary. Used to clear orphan runs that got stuck in 'queued' (e.g. studio-api crashed between createRun and createExecution).",
		inputSchema: {
			properties: {
				errorSummary: {
					description:
						"Human-readable reason shown in studio UI. Defaults to 'Marked failed via internal MCP tool'.",
					type: "string",
				},
				runId: {
					description: "Studio run id (uuid).",
					type: "string",
				},
			},
			required: ["runId"],
			type: "object",
		},
		name: "studio_run_mark_failed",
	},
	{
		description:
			"Read-only bundle for debugging Studio runs and generator executions, including scenario params, execution provider LoRA payload, and registry size checks.",
		inputSchema: {
			properties: {
				executionId: {
					description: "Generator execution id.",
					type: "string",
				},
				limit: {
					description:
						"How many recent scenario runs to include when scenarioId is provided. Defaults to 10, max 25.",
					type: "number",
				},
				providerJobId: {
					description: "Provider job id returned by fal/replicate/etc.",
					type: "string",
				},
				runId: {
					description: "Studio run id.",
					type: "string",
				},
				scenarioId: {
					description: "Studio scenario id.",
					type: "string",
				},
			},
			type: "object",
		},
		name: "studio_execution_debug",
	},
	{
		description:
			"Patch a studio scenario by id (workflow migration helper). At least one of name/prompt/params/workflowKey must be provided. Authorized via internal callback token; meant for MCP-driven cleanup like switching legacy scenarios to new workflows.",
		inputSchema: {
			properties: {
				name: {
					description: "Optional new scenario display name.",
					type: "string",
				},
				params: {
					additionalProperties: true,
					description:
						"Replacement params object. Pass the full desired params (server stores it as-is, prompt source metadata is recomputed).",
					type: "object",
				},
				prompt: {
					description: "Optional new scenario prompt text.",
					type: "string",
				},
				scenarioId: {
					description: "Studio scenario id (uuid).",
					type: "string",
				},
				workflowKey: {
					description:
						"Optional new workflow key (e.g. 'runpod-ltx-2-3-image-to-video').",
					type: "string",
				},
			},
			required: ["scenarioId"],
			type: "object",
		},
		name: "studio_scenario_update",
	},
	{
		description:
			"Get RunPod serverless endpoint health (jobs counters + worker states). Uses RUNPOD_API_KEY from env. endpointId is the serverless endpoint id (e.g. hr1a398xx75thx).",
		inputSchema: {
			properties: {
				endpointId: { type: "string" },
			},
			required: ["endpointId"],
			type: "object",
		},
		name: "runpod_serverless_health",
	},
	{
		description:
			"Get status of a serverless request. Returns the same payload as GET /v2/{endpointId}/status/{requestId}, including output/error blobs for COMPLETED/FAILED requests.",
		inputSchema: {
			properties: {
				endpointId: { type: "string" },
				requestId: { type: "string" },
			},
			required: ["endpointId", "requestId"],
			type: "object",
		},
		name: "runpod_serverless_status",
	},
	{
		description:
			"Cancel a serverless request (POST /v2/{endpointId}/cancel/{requestId}).",
		inputSchema: {
			properties: {
				endpointId: { type: "string" },
				requestId: { type: "string" },
			},
			required: ["endpointId", "requestId"],
			type: "object",
		},
		name: "runpod_serverless_cancel",
	},
	{
		description:
			"List recent serverless requests (GET /v2/{endpointId}/requests).",
		inputSchema: {
			properties: {
				endpointId: { type: "string" },
				lastId: { type: "string" },
			},
			required: ["endpointId"],
			type: "object",
		},
		name: "runpod_serverless_requests",
	},
	{
		description:
			"Purge the serverless queue (POST /v2/{endpointId}/purge-queue). Cancels every IN_QUEUE job for this endpoint.",
		inputSchema: {
			properties: {
				endpointId: { type: "string" },
			},
			required: ["endpointId"],
			type: "object",
		},
		name: "runpod_serverless_purge_queue",
	},
	{
		description:
			"Submit a job to a serverless endpoint (POST /v2/{endpointId}/run). Body is wrapped as {input}. Set sync=true to use /runsync (blocks up to 60s). Optional policy object overrides retry/ttl.",
		inputSchema: {
			properties: {
				endpointId: { type: "string" },
				input: {
					description: "Arbitrary input payload (will be wrapped as {input}).",
					type: "object",
				},
				policy: { type: "object" },
				sync: { type: "boolean" },
				webhook: { type: "string" },
			},
			required: ["endpointId", "input"],
			type: "object",
		},
		name: "runpod_serverless_run",
	},
	{
		description:
			"GET a serverless endpoint config via REST (https://rest.runpod.io/v1/endpoints/{id}). Shows imageName via embedded template, worker counts, network volumes, scaler.",
		inputSchema: {
			properties: {
				endpointId: { type: "string" },
			},
			required: ["endpointId"],
			type: "object",
		},
		name: "runpod_endpoint_get",
	},
	{
		description:
			"PATCH a serverless endpoint config (PATCH https://rest.runpod.io/v1/endpoints/{id}). Useful keys: workersMax, workersMin, flashboot, idleTimeout, scalerType, scalerValue, networkVolumeIds, gpuTypeIds.",
		inputSchema: {
			properties: {
				body: { type: "object" },
				endpointId: { type: "string" },
			},
			required: ["endpointId", "body"],
			type: "object",
		},
		name: "runpod_endpoint_patch",
	},
	{
		description:
			"GET a RunPod template by id (https://rest.runpod.io/v1/templates/{id}). Returns imageName, containerRegistryAuthId, env, mountPath.",
		inputSchema: {
			properties: {
				templateId: { type: "string" },
			},
			required: ["templateId"],
			type: "object",
		},
		name: "runpod_template_get",
	},
	{
		description:
			"PATCH a RunPod template (PATCH https://rest.runpod.io/v1/templates/{id}). Useful keys: imageName, containerRegistryAuthId, env, containerDiskInGb.",
		inputSchema: {
			properties: {
				body: { type: "object" },
				templateId: { type: "string" },
			},
			required: ["templateId", "body"],
			type: "object",
		},
		name: "runpod_template_patch",
	},
	{
		description:
			"Issue an authenticated request to the admin service using TRAINING_CONTROL_TOKEN as Bearer. Use for /api/admin/* endpoints (runpod templates, scenario-runpod bindings, etc.). Same shape as service_request but pre-attaches the admin internal token.",
		inputSchema: {
			properties: {
				body: { type: "object" },
				headers: {
					additionalProperties: { type: "string" },
					type: "object",
				},
				method: { type: "string" },
				path: { type: "string" },
			},
			required: ["path"],
			type: "object",
		},
		name: "admin_request",
	},
] as const;

function createToolResult(payload: unknown, isError = false) {
	return {
		content: [
			{
				text: JSON.stringify(payload, null, 2),
				type: "text",
			},
		],
		isError,
		structuredContent: payload,
	};
}

function createErrorResponse(id: JsonRpcResponse["id"], message: string) {
	return {
		error: {
			code: -32_000,
			message,
		},
		id,
		jsonrpc: "2.0" as const,
	};
}

function createOkResponse(id: JsonRpcResponse["id"], result: unknown) {
	return {
		id,
		jsonrpc: "2.0" as const,
		result,
	};
}

function parseOptionalString(value: unknown) {
	return typeof value === "string" ? value : undefined;
}

function parseStringArray(value: unknown) {
	if (!Array.isArray(value)) {
		return undefined;
	}

	return value.filter((entry): entry is string => typeof entry === "string");
}

function parseHeaders(value: unknown) {
	if (!(value && typeof value === "object") || Array.isArray(value)) {
		return undefined;
	}

	const headers: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "string") {
			headers[key] = entry;
		}
	}

	return headers;
}

function parseOptionalBoolean(value: unknown) {
	return typeof value === "boolean" ? value : undefined;
}

function parseOptionalNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function requireRedisUrl(id: JsonRpcResponse["id"]) {
	const redisUrl = process.env.REDIS_URL;
	if (!redisUrl) {
		return {
			error: createErrorResponse(
				id,
				"REDIS_URL is not configured for the MCP server"
			),
			redisUrl: null as string | null,
		};
	}
	return { error: null, redisUrl };
}

function createRedisClient(redisUrl: string) {
	return new IORedis(redisUrl, {
		maxRetriesPerRequest: null,
	});
}

function serializeQueueJob(job: Job) {
	const data =
		job.data && typeof job.data === "object" && !Array.isArray(job.data)
			? (job.data as Record<string, unknown>)
			: {};

	return {
		attemptsMade: job.attemptsMade,
		data: {
			personId: data.personId ?? null,
			trainingRunId: data.trainingRunId ?? null,
			variantId: data.variantId ?? null,
		},
		delay: job.delay,
		failedReason: job.failedReason ?? null,
		finishedOn: job.finishedOn ?? null,
		id: job.id ?? null,
		name: job.name,
		processedOn: job.processedOn ?? null,
		stacktrace: job.stacktrace.slice(0, 3),
		timestamp: job.timestamp,
	};
}

async function scanRedisKeys(
	connection: Redis,
	pattern: string,
	limit: number
) {
	let cursor = "0";
	const keys: string[] = [];

	do {
		const [nextCursor, batch] = await connection.scan(
			cursor,
			"MATCH",
			pattern,
			"COUNT",
			"100"
		);
		cursor = nextCursor;
		for (const key of batch) {
			keys.push(key);
			if (keys.length >= limit) {
				cursor = "0";
				break;
			}
		}
	} while (cursor !== "0");

	return Promise.all(
		keys.sort().map(async (key) => ({
			key,
			ttlSeconds: await connection.ttl(key),
		}))
	);
}

function parseKafkaBrokers() {
	return (process.env.KAFKA_BROKERS ?? "")
		.split(",")
		.map((broker) => broker.trim())
		.filter((broker) => broker.length > 0);
}

function createKafkaSasl(): SASLOptions | undefined {
	const username = process.env.KAFKA_SASL_USERNAME?.trim();
	const password = process.env.KAFKA_SASL_PASSWORD?.trim();
	if (!(username && password)) {
		return undefined;
	}

	const mechanism = process.env.KAFKA_SASL_MECHANISM?.trim() || "plain";
	if (
		mechanism !== "plain" &&
		mechanism !== "scram-sha-256" &&
		mechanism !== "scram-sha-512"
	) {
		throw new Error(`Unsupported KAFKA_SASL_MECHANISM: ${mechanism}`);
	}

	return {
		mechanism,
		password,
		username,
	};
}

function createKafkaClient() {
	const brokers = parseKafkaBrokers();
	if (brokers.length === 0) {
		throw new Error("KAFKA_BROKERS is required for Kafka MCP tools");
	}

	return new Kafka({
		brokers,
		clientId: process.env.KAFKA_CLIENT_ID ?? "generator-debug-mcp",
		logLevel: logLevel.ERROR,
		sasl: createKafkaSasl(),
		ssl: process.env.KAFKA_SSL === "true",
	});
}

async function withKafkaAdmin<T>(
	callback: (admin: ReturnType<Kafka["admin"]>) => Promise<T>
) {
	const admin = createKafkaClient().admin();
	await admin.connect();
	try {
		return await callback(admin);
	} finally {
		await admin.disconnect();
	}
}

function clampInteger(
	value: number | undefined,
	fallback: number,
	max: number
) {
	if (value === undefined) {
		return fallback;
	}

	return Math.max(1, Math.min(max, Math.trunc(value)));
}

function subtractOffsets(latest: string | undefined, committed: string) {
	if (!(latest && committed !== "-1")) {
		return null;
	}

	return (BigInt(latest) - BigInt(committed)).toString();
}

function topicMatches(topic: string, search: string | undefined) {
	return !search || topic.toLowerCase().includes(search.toLowerCase());
}

function serializeKafkaMessage(payload: EachMessagePayload) {
	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(payload.message.headers ?? {})) {
		if (value) {
			headers[key] = value.toString();
		}
	}

	return {
		headers,
		key: payload.message.key?.toString() ?? null,
		offset: payload.message.offset,
		partition: payload.partition,
		timestamp: payload.message.timestamp,
		topic: payload.topic,
		value: payload.message.value?.toString() ?? null,
	};
}

function getGroupOffsetsWithLag(groupId: string, topics?: string[]) {
	return withKafkaAdmin(async (admin) => {
		const committedOffsets = await admin.fetchOffsets({
			groupId,
			...(topics ? { topics } : {}),
		});
		const latestOffsetsByTopic = new Map<string, Map<number, string>>();

		for (const topicOffsets of committedOffsets) {
			const latestOffsets = await admin.fetchTopicOffsets(topicOffsets.topic);
			latestOffsetsByTopic.set(
				topicOffsets.topic,
				new Map(
					latestOffsets.map((entry) => [
						entry.partition,
						entry.high ?? entry.offset,
					])
				)
			);
		}

		return committedOffsets.map((topicOffsets) => ({
			partitions: topicOffsets.partitions.map((partitionOffset) => {
				const latestOffset = latestOffsetsByTopic
					.get(topicOffsets.topic)
					?.get(partitionOffset.partition);
				return {
					...partitionOffset,
					lag: subtractOffsets(latestOffset, partitionOffset.offset),
					latestOffset: latestOffset ?? null,
				};
			}),
			topic: topicOffsets.topic,
		}));
	});
}

async function sampleKafkaTopic(input: {
	fromBeginning?: boolean;
	limit?: number;
	timeoutMs?: number;
	topic: string;
}) {
	const limit = clampInteger(
		input.limit,
		DEFAULT_KAFKA_SAMPLE_LIMIT,
		MAX_KAFKA_SAMPLE_LIMIT
	);
	const timeoutMs = clampInteger(
		input.timeoutMs,
		DEFAULT_KAFKA_TIMEOUT_MS,
		MAX_KAFKA_TIMEOUT_MS
	);
	const consumer = createKafkaClient().consumer({
		groupId: `generator-debug-mcp-${crypto.randomUUID()}`,
	});
	const messages: ReturnType<typeof serializeKafkaMessage>[] = [];
	let timeout: ReturnType<typeof setTimeout> | null = null;

	await consumer.connect();
	try {
		await consumer.subscribe({
			fromBeginning: input.fromBeginning ?? false,
			topic: input.topic,
		});

		await new Promise<void>((resolve, reject) => {
			timeout = setTimeout(resolve, timeoutMs);
			consumer
				.run({
					autoCommit: false,
					eachMessage: (payload) => {
						messages.push(serializeKafkaMessage(payload));
						if (messages.length >= limit && timeout) {
							clearTimeout(timeout);
							timeout = null;
							resolve();
						}
						return Promise.resolve();
					},
				})
				.catch(reject);
		});
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
		await consumer.disconnect();
	}

	return {
		fromBeginning: input.fromBeginning ?? false,
		limit,
		messages,
		timeoutMs,
		topic: input.topic,
	};
}

async function handleKafkaToolCall(
	name: string,
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
) {
	try {
		switch (name) {
			case "kafka_cluster_info":
				return createOkResponse(
					id,
					createToolResult(
						await withKafkaAdmin(async (admin) => {
							const [cluster, topics] = await Promise.all([
								admin.describeCluster(),
								admin.listTopics(),
							]);
							return {
								...cluster,
								brokersConfigured: parseKafkaBrokers(),
								topicCount: topics.length,
							};
						})
					)
				);
			case "kafka_topics_list":
				return createOkResponse(
					id,
					createToolResult(
						await withKafkaAdmin(async (admin) => {
							const includeInternal =
								parseOptionalBoolean(argumentsPayload.includeInternal) ?? false;
							const includeMetadata =
								parseOptionalBoolean(argumentsPayload.includeMetadata) ?? false;
							const search = parseOptionalString(argumentsPayload.search);
							const topics = (await admin.listTopics())
								.filter((topic) => includeInternal || !topic.startsWith("__"))
								.filter((topic) => topicMatches(topic, search))
								.sort();
							if (!includeMetadata) {
								return { topics };
							}
							const metadata = await admin.fetchTopicMetadata({ topics });
							return { metadata: metadata.topics, topics };
						})
					)
				);
			case "kafka_topic_offsets": {
				const topic = parseOptionalString(argumentsPayload.topic);
				if (!topic) {
					return createErrorResponse(id, "topic is required");
				}
				return createOkResponse(
					id,
					createToolResult({
						offsets: await withKafkaAdmin((admin) =>
							admin.fetchTopicOffsets(topic)
						),
						topic,
					})
				);
			}
			case "kafka_consumer_groups_list":
				return createOkResponse(
					id,
					createToolResult(
						await withKafkaAdmin(async (admin) => {
							const search = parseOptionalString(argumentsPayload.search);
							const result = await admin.listGroups();
							return {
								groups: result.groups.filter((group) =>
									topicMatches(group.groupId, search)
								),
							};
						})
					)
				);
			case "kafka_consumer_group_describe": {
				const groupId = parseOptionalString(argumentsPayload.groupId);
				if (!groupId) {
					return createErrorResponse(id, "groupId is required");
				}
				const [description, offsets] = await Promise.all([
					withKafkaAdmin((admin) => admin.describeGroups([groupId])),
					getGroupOffsetsWithLag(groupId),
				]);
				return createOkResponse(
					id,
					createToolResult({ description, groupId, offsets })
				);
			}
			case "kafka_topic_sample": {
				const topic = parseOptionalString(argumentsPayload.topic);
				if (!topic) {
					return createErrorResponse(id, "topic is required");
				}
				return createOkResponse(
					id,
					createToolResult(
						await sampleKafkaTopic({
							fromBeginning: parseOptionalBoolean(
								argumentsPayload.fromBeginning
							),
							limit: parseOptionalNumber(argumentsPayload.limit),
							timeoutMs: parseOptionalNumber(argumentsPayload.timeoutMs),
							topic,
						})
					)
				);
			}
			default:
				return createErrorResponse(id, `Unknown Kafka tool: ${name}`);
		}
	} catch (error) {
		return createOkResponse(
			id,
			createToolResult(
				{
					error: error instanceof Error ? error.message : "Kafka tool failed",
					tool: name,
				},
				true
			)
		);
	}
}

const GENERATOR_INTERNAL_TOKEN_HEADER = "x-generator-internal-token";

function getGeneratorInternalToken() {
	const token = process.env.GENERATOR_INTERNAL_TOKEN?.trim();
	return token && token.length > 0 ? token : null;
}

function postJson(path: string, payload: unknown) {
	const internalToken = getGeneratorInternalToken();
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (internalToken) {
		headers[GENERATOR_INTERNAL_TOKEN_HEADER] = internalToken;
	}
	return fetchServiceSnapshot("generator", path, {
		body: JSON.stringify(payload),
		headers,
		method: "POST",
	});
}

function fetchAdminLoras(query: string, token: string) {
	return fetchServiceSnapshot(
		"admin",
		`/api/internal/loras${query ? `?${query}` : ""}`,
		{
			headers: {
				authorization: `Bearer ${token}`,
			},
		}
	);
}

type McpDatabase = ReturnType<typeof createDb>;
type PersonRow = typeof person.$inferSelect;
type PersonGenerationRow = typeof personGeneration.$inferSelect;
type GeneratorExecutionRow = typeof generatorExecution.$inferSelect;
type LoraRow = typeof lora.$inferSelect;
type StudioRunRow = typeof studioRun.$inferSelect;
type StudioScenarioRow = typeof studioScenario.$inferSelect;
type GenerationDebugMetadata = ReturnType<typeof pickGenerationMetadata>;

let mcpDatabase: McpDatabase | null = null;

function getMcpDatabase() {
	mcpDatabase ??= createDb(getDatabaseUrl());
	return mcpDatabase;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readRecordString(record: Record<string, unknown> | null, key: string) {
	const value = record?.[key];
	return typeof value === "string" && value.length > 0 ? value : null;
}

function readRecordNumber(record: Record<string, unknown> | null, key: string) {
	const value = record?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readRecordBoolean(
	record: Record<string, unknown> | null,
	key: string
) {
	const value = record?.[key];
	return typeof value === "boolean" ? value : null;
}

function toIsoString(value: Date | null) {
	return value ? value.toISOString() : null;
}

function truncateText(value: string, maxLength = 500) {
	return value.length <= maxLength
		? value
		: `${value.slice(0, maxLength - 1)}…`;
}

const loraParamKeys = [
	"loraUrl",
	"extraLoraUrl",
	"loraUrlHigh",
	"loraUrlLow",
] as const;

const loraWeightParamKeys = [
	"loraWeight",
	"extraLoraWeight",
	"loraScale",
	"loraScaleHigh",
	"loraScaleLow",
] as const;

function pickLoraParams(params: Record<string, unknown> | null) {
	const picked: Record<string, unknown> = {};
	for (const key of [...loraParamKeys, ...loraWeightParamKeys]) {
		const value = params?.[key];
		if (value !== undefined) {
			picked[key] = value;
		}
	}
	return picked;
}

function collectLoraParamEntries(
	source: "execution.params" | "scenario.params",
	params: Record<string, unknown> | null
) {
	const entries: Array<{
		key: string;
		source: "execution.params" | "scenario.params";
		url: string;
	}> = [];
	for (const key of loraParamKeys) {
		const value = readRecordString(params, key);
		if (value) {
			entries.push({ key, source, url: value });
		}
	}
	return entries;
}

function collectProviderPayloadLoraEntries(
	providerPayload: ReturnType<typeof buildProviderPayloadDebug>
) {
	const payload = asRecord(providerPayload.payload);
	const loras = payload?.loras;
	if (!Array.isArray(loras)) {
		return [];
	}

	return loras
		.map((entry, index) => {
			const record = asRecord(entry);
			const url =
				readRecordString(record, "path") ?? readRecordString(record, "url");
			if (!url) {
				return null;
			}
			return {
				index,
				scale:
					readRecordNumber(record, "scale") ??
					readRecordNumber(record, "weight"),
				source: "providerPayload.loras" as const,
				transformer: readRecordString(record, "transformer"),
				url,
			};
		})
		.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function summarizeStudioScenario(row: StudioScenarioRow | null) {
	if (!row) {
		return null;
	}
	const params = asRecord(row.params);
	return {
		createdAt: toIsoString(row.createdAt),
		generatorScenarioId: row.generatorScenarioId,
		id: row.id,
		loraParams: pickLoraParams(params),
		name: row.name,
		params,
		promptLength: row.prompt.length,
		promptPreview: truncateText(row.prompt),
		updatedAt: toIsoString(row.updatedAt),
		workflowKey: row.workflowKey,
	};
}

function summarizeStudioRun(row: StudioRunRow) {
	return {
		completedAt: toIsoString(row.completedAt),
		createdAt: toIsoString(row.createdAt),
		errorSummary: row.errorSummary,
		generatorRunId: row.generatorRunId,
		id: row.id,
		inputImageUrl: row.inputImageUrl,
		inputPersonGenerationId: row.inputPersonGenerationId,
		inputPersonId: row.inputPersonId,
		loraPersonId: row.loraPersonId,
		progressPct: row.progressPct,
		providerEndpointId: row.providerEndpointId,
		providerJobId: row.providerJobId,
		scenarioId: row.scenarioId,
		status: row.status,
		updatedAt: toIsoString(row.updatedAt),
		workflowKey: row.workflowKey,
	};
}

function summarizeStudioExecution(row: GeneratorExecutionRow) {
	const params = asRecord(row.params);
	const providerPayload = buildProviderPayloadDebug(row);
	return {
		artifacts: row.artifacts,
		createdAt: toIsoString(row.createdAt),
		errorSummary: row.errorSummary,
		id: row.id,
		inputImageUrl: row.inputImageUrl,
		loraParams: pickLoraParams(params),
		params,
		progressPct: row.progressPct,
		promptLength: row.prompt.length,
		promptPreview: truncateText(row.prompt),
		providerEndpointId: row.providerEndpointId,
		providerJobId: row.providerJobId,
		providerPayload,
		queuePosition: row.queuePosition,
		status: row.status,
		updatedAt: toIsoString(row.updatedAt),
		workflowKey: row.workflowKey,
	};
}

function summarizeLoraRegistryRow(row: LoraRow) {
	return {
		baseModel: row.baseModel,
		defaultWeight: row.defaultWeight,
		exceedsFalOneGbLimit: row.sizeBytes >= FAL_LORA_SIZE_LIMIT_BYTES,
		id: row.id,
		name: row.name,
		pairGroupId: row.pairGroupId,
		s3Key: row.s3Key,
		s3Url: row.s3Url,
		sizeBytes: row.sizeBytes,
		sizeLimitBytes: FAL_LORA_SIZE_LIMIT_BYTES,
		slug: row.slug,
		sourceUrl: row.sourceUrl,
		status: row.status,
		triggerWords: row.triggerWords,
		variant: row.variant,
	};
}

function pickGenerationMetadata(metadata: Record<string, unknown>) {
	const record = asRecord(metadata);
	return {
		generatedWithLora: readRecordBoolean(record, "generatedWithLora"),
		generatorExecutionId: readRecordString(record, "generatorExecutionId"),
		generatorStatus: readRecordString(record, "generatorStatus"),
		generatorWorkflowKey: readRecordString(record, "generatorWorkflowKey"),
		workflowKey: readRecordString(record, "workflowKey"),
	};
}

function getPersonTrainingMetadata(row: PersonRow) {
	const metadata = asRecord(row.metadata);
	const training = asRecord(metadata?.training);
	const trainingDebug = asRecord(training?.debug);
	return {
		baseModel: readRecordString(trainingDebug, "baseModel"),
		completedAt: readRecordString(training, "completedAt"),
		defaultCaption: readRecordString(trainingDebug, "defaultCaption"),
		loraUrl: readRecordString(training, "loraUrl"),
		outputName: readRecordString(training, "outputName"),
		phase: readRecordString(training, "phase"),
		provider: readRecordString(training, "provider"),
		status: readRecordString(training, "status"),
		trainingModel: readRecordString(trainingDebug, "trainingModel"),
		trainingRunId: readRecordString(training, "trainingRunId"),
		trainingSteps: readRecordNumber(training, "trainingSteps"),
		triggerWord: readRecordString(training, "triggerWord"),
	};
}

const providerPayloadSummaryKeys = [
	"__falModel",
	"image_size",
	"image_url",
	"num_images",
	"num_inference_steps",
	"output_format",
	"strength",
	"enable_safety_checker",
	"loras",
] as const;

function summarizeProviderPayload(payload: Record<string, unknown>) {
	const summary: Record<string, unknown> = {};
	for (const key of providerPayloadSummaryKeys) {
		const value = payload[key];
		if (value !== undefined) {
			summary[key] = value;
		}
	}
	summary.loraCount = Array.isArray(payload.loras)
		? payload.loras.length
		: null;
	return summary;
}

function buildProviderPayloadDebug(execution: GeneratorExecutionRow) {
	const workflow = getWorkflowDefinition(execution.workflowKey);
	if (!workflow) {
		return {
			error: `Unknown workflow: ${execution.workflowKey}`,
			payload: null,
			workflowFound: false,
		};
	}

	try {
		const payload = workflow.buildProviderInput({
			inputImageUrl: execution.inputImageUrl ?? undefined,
			params: execution.params ?? {},
			prompt: execution.prompt,
		});
		return {
			error: null,
			payload: summarizeProviderPayload(payload),
			workflowFound: true,
		};
	} catch (error) {
		return {
			error:
				error instanceof Error
					? error.message
					: "Failed to build provider payload",
			payload: null,
			workflowFound: true,
		};
	}
}

function getProviderPayloadLoraCount(
	providerPayload: ReturnType<typeof buildProviderPayloadDebug>
) {
	const loraCount = providerPayload.payload?.loraCount;
	return typeof loraCount === "number" ? loraCount : null;
}

function summarizeExecutionDebug(input: {
	execution: GeneratorExecutionRow;
	generationMetadata: GenerationDebugMetadata | null;
	personLoraUrl: string | null;
	triggerWord: string | null;
}) {
	const params = asRecord(input.execution.params);
	const loraUrl = readRecordString(params, "loraUrl");
	const providerPayload = buildProviderPayloadDebug(input.execution);
	const providerLoraCount = getProviderPayloadLoraCount(providerPayload);
	const promptContainsTriggerWord = input.triggerWord
		? input.execution.prompt.includes(input.triggerWord)
		: null;
	const loraUrlMatchesPerson =
		input.personLoraUrl && loraUrl ? loraUrl === input.personLoraUrl : null;
	const checks = {
		generatedWithLoraFlag: input.generationMetadata?.generatedWithLora ?? null,
		loraUrlMatchesPerson,
		paramsHasLoraUrl: Boolean(loraUrl),
		promptContainsTriggerWord,
		providerPayloadHasLora:
			typeof providerLoraCount === "number" ? providerLoraCount > 0 : null,
	};

	let diagnosis = "lora_applied_by_pipeline";
	if (!input.personLoraUrl) {
		diagnosis = "person_has_no_lora_url";
	} else if (!checks.paramsHasLoraUrl) {
		diagnosis = "generator_execution_missing_lora_url";
	} else if (checks.loraUrlMatchesPerson === false) {
		diagnosis = "generator_execution_lora_url_mismatch";
	} else if (checks.providerPayloadHasLora === false) {
		diagnosis = "provider_payload_missing_lora";
	} else if (checks.promptContainsTriggerWord === false) {
		diagnosis = "prompt_missing_trigger_word";
	}

	return {
		artifacts: input.execution.artifacts,
		checks,
		createdAt: toIsoString(input.execution.createdAt),
		diagnosis,
		errorSummary: input.execution.errorSummary,
		id: input.execution.id,
		inputImageUrl: input.execution.inputImageUrl,
		params: {
			enableSafetyChecker: readRecordBoolean(params, "enableSafetyChecker"),
			extraLoraUrl: readRecordString(params, "extraLoraUrl"),
			extraLoraWeight: readRecordNumber(params, "extraLoraWeight"),
			imageSize: readRecordString(params, "imageSize"),
			loraUrl,
			loraWeight: readRecordNumber(params, "loraWeight"),
			numImages: readRecordNumber(params, "numImages"),
			numInferenceSteps: readRecordNumber(params, "numInferenceSteps"),
			outputFormat: readRecordString(params, "outputFormat"),
		},
		progressPct: input.execution.progressPct,
		prompt: input.execution.prompt,
		providerEndpointId: input.execution.providerEndpointId,
		providerJobId: input.execution.providerJobId,
		providerPayload,
		status: input.execution.status,
		updatedAt: toIsoString(input.execution.updatedAt),
		workflowKey: input.execution.workflowKey,
	};
}

function summarizeGenerationDebug(input: {
	executionById: Map<string, GeneratorExecutionRow>;
	generation: PersonGenerationRow;
}) {
	const metadata = pickGenerationMetadata(input.generation.metadata);
	return {
		createdAt: toIsoString(input.generation.createdAt),
		errorSummary: input.generation.errorSummary,
		executionFound: metadata.generatorExecutionId
			? input.executionById.has(metadata.generatorExecutionId)
			: null,
		id: input.generation.id,
		metadata,
		previewUrl: input.generation.previewUrl,
		prompt: input.generation.prompt,
		sourceUrl: input.generation.sourceUrl,
		status: input.generation.status,
		title: input.generation.title,
		updatedAt: toIsoString(input.generation.updatedAt),
	};
}

async function findPersonForLoraGenerationDebug(input: {
	database: McpDatabase;
	personId?: string;
	personSlug?: string;
}) {
	const [personRow] = await input.database
		.select()
		.from(person)
		.where(
			input.personId
				? eq(person.id, input.personId)
				: eq(person.slug, input.personSlug ?? "")
		);
	return personRow ?? null;
}

async function listGenerationsForLoraGenerationDebug(input: {
	database: McpDatabase;
	generationId?: string;
	limit: number;
	personId: string;
	requestedExecutionId?: string;
}) {
	if (input.generationId) {
		return await input.database
			.select()
			.from(personGeneration)
			.where(
				and(
					eq(personGeneration.id, input.generationId),
					eq(personGeneration.personId, input.personId)
				)
			)
			.limit(1);
	}

	return await input.database
		.select()
		.from(personGeneration)
		.where(eq(personGeneration.personId, input.personId))
		.orderBy(desc(personGeneration.createdAt))
		.limit(
			input.requestedExecutionId ? MAX_LORA_DEBUG_GENERATION_LIMIT : input.limit
		);
}

function selectVisibleGenerationRows(input: {
	generationId?: string;
	generationRows: PersonGenerationRow[];
	limit: number;
	requestedExecutionId?: string;
}) {
	if (!(input.requestedExecutionId && !input.generationId)) {
		return input.generationRows;
	}

	const selectedRows = input.generationRows.filter(
		(row) =>
			pickGenerationMetadata(row.metadata).generatorExecutionId ===
			input.requestedExecutionId
	);
	return selectedRows.length > 0
		? selectedRows
		: input.generationRows.slice(0, input.limit);
}

function collectExecutionDebugInputs(input: {
	generationRows: PersonGenerationRow[];
	requestedExecutionId?: string;
}) {
	const metadataByExecutionId = new Map<string, GenerationDebugMetadata>();
	const executionIds = new Set<string>();
	if (input.requestedExecutionId) {
		executionIds.add(input.requestedExecutionId);
	}
	for (const generation of input.generationRows) {
		const metadata = pickGenerationMetadata(generation.metadata);
		if (metadata.generatorExecutionId) {
			metadataByExecutionId.set(metadata.generatorExecutionId, metadata);
			executionIds.add(metadata.generatorExecutionId);
		}
	}
	return { executionIds, metadataByExecutionId };
}

async function listGeneratorExecutionsForLoraDebug(input: {
	database: McpDatabase;
	executionIds: Set<string>;
}) {
	return input.executionIds.size > 0
		? await input.database
				.select()
				.from(generatorExecution)
				.where(inArray(generatorExecution.id, [...input.executionIds]))
		: [];
}

async function handlePersonsLoraGenerationDebugToolCall(
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
) {
	const personId = parseOptionalString(argumentsPayload.personId);
	const personSlug = parseOptionalString(argumentsPayload.personSlug);
	if (!(personId || personSlug)) {
		return createErrorResponse(id, "personId or personSlug is required");
	}

	const generationId = parseOptionalString(argumentsPayload.generationId);
	const requestedExecutionId = parseOptionalString(
		argumentsPayload.executionId
	);
	const limit = clampInteger(
		parseOptionalNumber(argumentsPayload.limit),
		DEFAULT_LORA_DEBUG_GENERATION_LIMIT,
		MAX_LORA_DEBUG_GENERATION_LIMIT
	);
	const database = getMcpDatabase();
	const personRow = await findPersonForLoraGenerationDebug({
		database,
		personId,
		personSlug,
	});
	if (!personRow) {
		return createOkResponse(
			id,
			createToolResult(
				{
					error: "Person not found",
					personId: personId ?? null,
					personSlug: personSlug ?? null,
				},
				true
			)
		);
	}

	const generationRows = await listGenerationsForLoraGenerationDebug({
		database,
		generationId,
		limit,
		personId: personRow.id,
		requestedExecutionId,
	});
	const visibleGenerationRows = selectVisibleGenerationRows({
		generationId,
		generationRows,
		limit,
		requestedExecutionId,
	});
	const { executionIds, metadataByExecutionId } = collectExecutionDebugInputs({
		generationRows: visibleGenerationRows,
		requestedExecutionId,
	});
	const executionRows = await listGeneratorExecutionsForLoraDebug({
		database,
		executionIds,
	});
	const executionById = new Map(
		executionRows.map((execution) => [execution.id, execution])
	);
	const training = getPersonTrainingMetadata(personRow);
	const triggerWord = training.triggerWord ?? training.defaultCaption;

	return createOkResponse(
		id,
		createToolResult({
			executions: executionRows.map((execution) =>
				summarizeExecutionDebug({
					execution,
					generationMetadata: metadataByExecutionId.get(execution.id) ?? null,
					personLoraUrl: personRow.loraUrl,
					triggerWord,
				})
			),
			generations: visibleGenerationRows.map((generation) =>
				summarizeGenerationDebug({ executionById, generation })
			),
			limit,
			person: {
				hasLoraUrl: Boolean(personRow.loraUrl),
				id: personRow.id,
				loraUrl: personRow.loraUrl,
				name: personRow.name,
				slug: personRow.slug,
				training,
			},
			requested: {
				executionId: requestedExecutionId ?? null,
				generationId: generationId ?? null,
				personId: personId ?? null,
				personSlug: personSlug ?? null,
			},
		})
	);
}

function requireTrainingControlToken(id: JsonRpcResponse["id"]) {
	const token = process.env.TRAINING_CONTROL_TOKEN;
	if (!token) {
		return {
			error: createErrorResponse(
				id,
				"TRAINING_CONTROL_TOKEN is not configured for the MCP server"
			),
			token: null as string | null,
		};
	}
	return { error: null, token };
}

async function handlePersonsToolCall(
	name: string,
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
) {
	if (name === "persons_lora_generation_debug") {
		return handlePersonsLoraGenerationDebugToolCall(argumentsPayload, id);
	}

	const { error, token } = requireTrainingControlToken(id);
	if (error) {
		return error;
	}

	if (name === "persons_list") {
		return createOkResponse(
			id,
			createToolResult(
				await fetchServiceSnapshot("persons", "/api/internal/persons", {
					headers: {
						authorization: `Bearer ${token}`,
					},
				})
			)
		);
	}

	const personId = parseOptionalString(argumentsPayload.personId);
	if (!personId) {
		return createErrorResponse(id, "personId is required");
	}

	if (name === "persons_get") {
		return createOkResponse(
			id,
			createToolResult(
				await fetchServiceSnapshot(
					"persons",
					`/api/internal/persons/${encodeURIComponent(personId)}`,
					{
						headers: {
							authorization: `Bearer ${token}`,
						},
					}
				)
			)
		);
	}

	if (name === "persons_retrain_lora") {
		const body: Record<string, unknown> = {};
		const outputName = parseOptionalString(argumentsPayload.outputName);
		const referencePrompt = parseOptionalString(
			argumentsPayload.referencePrompt
		);
		const triggerWord = parseOptionalString(argumentsPayload.triggerWord);
		if (outputName) {
			body.outputName = outputName;
		}
		if (referencePrompt) {
			body.referencePrompt = referencePrompt;
		}
		if (triggerWord) {
			body.triggerWord = triggerWord;
		}
		return createOkResponse(
			id,
			createToolResult(
				await fetchServiceSnapshot(
					"persons",
					`/api/internal/persons/${encodeURIComponent(personId)}/retrain-lora`,
					{
						body: JSON.stringify(body),
						headers: {
							authorization: `Bearer ${token}`,
							"content-type": "application/json",
						},
						method: "POST",
					}
				)
			)
		);
	}

	if (name === "persons_reupload_adorely_assets") {
		const body: Record<string, unknown> = {};
		const apply = parseOptionalBoolean(argumentsPayload.apply);
		const companionId = parseOptionalString(argumentsPayload.companionId);
		const targetImportedAssetCount = parseOptionalNumber(
			argumentsPayload.targetImportedAssetCount
		);
		if (apply !== undefined) {
			body.apply = apply;
		}
		if (companionId) {
			body.companionId = companionId;
		}
		if (targetImportedAssetCount !== undefined) {
			body.targetImportedAssetCount = targetImportedAssetCount;
		}

		return createOkResponse(
			id,
			createToolResult(
				await fetchServiceSnapshot(
					"persons",
					`/api/internal/persons/${encodeURIComponent(personId)}/reupload-adorely-assets`,
					{
						body: JSON.stringify(body),
						headers: {
							authorization: `Bearer ${token}`,
							"content-type": "application/json",
						},
						method: "POST",
					}
				)
			)
		);
	}

	return createErrorResponse(id, `Unknown persons tool: ${name}`);
}

async function handleTrainingProviderToolCall(
	name: string,
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
) {
	const { error, token } = requireTrainingControlToken(id);
	if (error) {
		return error;
	}
	const authHeaders = { authorization: `Bearer ${token}` };

	if (name === "training_provider_get") {
		return createOkResponse(
			id,
			createToolResult(
				await fetchServiceSnapshot("admin", "/api/admin/training-provider", {
					headers: authHeaders,
				})
			)
		);
	}

	if (name === "training_provider_set") {
		const provider = parseOptionalString(argumentsPayload.provider);
		if (provider !== "fal" && provider !== "runpod") {
			return createErrorResponse(id, "provider must be 'fal' or 'runpod'");
		}
		return createOkResponse(
			id,
			createToolResult(
				await fetchServiceSnapshot("admin", "/api/admin/training-provider", {
					body: JSON.stringify({ provider }),
					headers: {
						...authHeaders,
						"content-type": "application/json",
					},
					method: "PUT",
				})
			)
		);
	}

	if (name === "admin_settings_get") {
		return createOkResponse(
			id,
			createToolResult(
				await fetchServiceSnapshot("admin", "/api/admin/settings", {
					headers: authHeaders,
				})
			)
		);
	}

	return createErrorResponse(id, `Unknown training-provider tool: ${name}`);
}

async function handleAdminLoraTrainingQueueToolCall(
	_name: string,
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
) {
	const { error, redisUrl } = requireRedisUrl(id);
	if (error) {
		return error;
	}

	const jobLimit = clampInteger(
		parseOptionalNumber(argumentsPayload.jobLimit),
		DEFAULT_QUEUE_JOB_LIMIT,
		MAX_QUEUE_JOB_LIMIT
	);
	const lockLimit = clampInteger(
		parseOptionalNumber(argumentsPayload.lockLimit),
		DEFAULT_LOCK_LIMIT,
		MAX_LOCK_LIMIT
	);
	const includeLocks =
		parseOptionalBoolean(argumentsPayload.includeLocks) ?? true;
	const connection = createRedisClient(redisUrl);
	const queue = new Queue(ADMIN_LORA_TRAINING_QUEUE, { connection });

	try {
		const [
			counts,
			activeJobs,
			waitingJobs,
			delayedJobs,
			failedJobs,
			prioritizedJobs,
			waitingChildrenJobs,
			isPaused,
		] = await Promise.all([
			queue.getJobCounts(
				"active",
				"completed",
				"delayed",
				"failed",
				"paused",
				"prioritized",
				"waiting",
				"waiting-children"
			),
			queue.getJobs(["active"], 0, jobLimit - 1, true),
			queue.getJobs(["waiting"], 0, jobLimit - 1, true),
			queue.getJobs(["delayed"], 0, jobLimit - 1, true),
			queue.getJobs(["failed"], 0, jobLimit - 1, true),
			queue.getJobs(["prioritized"], 0, jobLimit - 1, true),
			queue.getJobs(["waiting-children"], 0, jobLimit - 1, true),
			queue.isPaused(),
		]);
		const lockPatterns = {
			refill: "admin:person-dataset-refill:*",
			training: "admin:person-lora-training:*",
			trainingRecovery: "admin:training-recovery:*",
		};
		const locks = includeLocks
			? Object.fromEntries(
					await Promise.all(
						Object.entries(lockPatterns).map(async ([name, pattern]) => [
							name,
							await scanRedisKeys(connection, pattern, lockLimit),
						])
					)
				)
			: null;

		return createOkResponse(
			id,
			createToolResult({
				counts,
				includeLocks,
				isPaused,
				jobLimit,
				jobs: {
					active: activeJobs.map(serializeQueueJob),
					delayed: delayedJobs.map(serializeQueueJob),
					failed: failedJobs.map(serializeQueueJob),
					prioritized: prioritizedJobs.map(serializeQueueJob),
					waiting: waitingJobs.map(serializeQueueJob),
					waitingChildren: waitingChildrenJobs.map(serializeQueueJob),
				},
				lockLimit,
				locks,
				queueName: ADMIN_LORA_TRAINING_QUEUE,
			})
		);
	} catch (toolError) {
		return createOkResponse(
			id,
			createToolResult(
				{
					error:
						toolError instanceof Error
							? toolError.message
							: "Queue snapshot failed",
					tool: "admin_lora_training_queue_snapshot",
				},
				true
			)
		);
	} finally {
		await queue.close().catch(() => {
			// ignore close errors after diagnostics
		});
		await connection.quit().catch(() => {
			// ignore close errors after diagnostics
		});
	}
}

async function handleLoraToolCall(
	name: string,
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
) {
	const token = process.env.TRAINING_CONTROL_TOKEN;
	if (!token) {
		return createErrorResponse(
			id,
			"TRAINING_CONTROL_TOKEN is not configured for the MCP server"
		);
	}

	if (name === "lora_list") {
		const params = new URLSearchParams();
		const baseModel = parseOptionalString(argumentsPayload.baseModel);
		const status = parseOptionalString(argumentsPayload.status);
		if (baseModel) {
			params.set("baseModel", baseModel);
		}
		if (status) {
			params.set("status", status);
		}
		return createOkResponse(
			id,
			createToolResult(await fetchAdminLoras(params.toString(), token))
		);
	}

	const targetId = parseOptionalString(argumentsPayload.id);
	if (!targetId) {
		return createErrorResponse(id, "id is required");
	}
	const snapshot = await fetchAdminLoras("", token);
	const data = snapshot.body as { loras?: Array<{ id: string }> } | null;
	const lora = data?.loras?.find((entry) => entry.id === targetId) ?? null;
	return createOkResponse(
		id,
		createToolResult({
			...snapshot,
			body: { lora },
		})
	);
}

async function handleTestUserToolCall(
	name: string,
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
) {
	if (name === "test_user_upsert") {
		return createOkResponse(
			id,
			createToolResult(
				await upsertTestUser({
					email: parseOptionalString(argumentsPayload.email) ?? "",
					emailVerified: parseOptionalBoolean(argumentsPayload.emailVerified),
					name: parseOptionalString(argumentsPayload.name),
					password: parseOptionalString(argumentsPayload.password) ?? "",
				})
			)
		);
	}

	return createOkResponse(
		id,
		createToolResult(
			await getTestUser({
				email: parseOptionalString(argumentsPayload.email),
				userId: parseOptionalString(argumentsPayload.userId),
			})
		)
	);
}

async function handleGeneratorExecutionToolCall(
	name: string,
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
) {
	const path =
		name === "generator_execution_submit"
			? "/api/executions"
			: "/api/executions/sync";
	return createOkResponse(
		id,
		createToolResult(await postJson(path, argumentsPayload))
	);
}

async function handleAdminRequestToolCall(
	_name: string,
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
) {
	const path = parseOptionalString(argumentsPayload.path);
	if (!path) {
		return createErrorResponse(id, "path is required");
	}
	const { error, token } = requireTrainingControlToken(id);
	if (error) {
		return error;
	}
	const method = parseOptionalString(argumentsPayload.method) ?? "GET";
	const extraHeaders = parseHeaders(argumentsPayload.headers) ?? {};
	const body = argumentsPayload.body;
	const hasBody = body !== undefined;
	const headers: Record<string, string> = {
		authorization: `Bearer ${token}`,
		...extraHeaders,
	};
	if (hasBody) {
		headers["content-type"] = headers["content-type"] ?? "application/json";
	}
	return createOkResponse(
		id,
		createToolResult(
			await fetchServiceSnapshot("admin", path, {
				body: hasBody ? JSON.stringify(body) : undefined,
				headers,
				method,
			})
		)
	);
}

function addRowsById<T extends { id: string }>(
	target: Map<string, T>,
	rows: T[]
) {
	for (const row of rows) {
		target.set(row.id, row);
	}
}

function readCallbackRunId(execution: GeneratorExecutionRow) {
	const callback = asRecord(execution.callback);
	const context = asRecord(callback?.context);
	return readRecordString(context, "runId");
}

async function listStudioDebugRuns(input: {
	database: McpDatabase;
	executionIds: Set<string>;
	limit: number;
	providerJobId?: string;
	runId?: string;
	scenarioId?: string;
}) {
	const runRowsById = new Map<string, StudioRunRow>();
	if (input.runId) {
		addRowsById(
			runRowsById,
			await input.database
				.select()
				.from(studioRun)
				.where(eq(studioRun.id, input.runId))
				.limit(1)
		);
	}
	if (input.providerJobId) {
		addRowsById(
			runRowsById,
			await input.database
				.select()
				.from(studioRun)
				.where(eq(studioRun.providerJobId, input.providerJobId))
				.limit(5)
		);
	}
	for (const executionId of input.executionIds) {
		addRowsById(
			runRowsById,
			await input.database
				.select()
				.from(studioRun)
				.where(eq(studioRun.generatorRunId, executionId))
				.limit(5)
		);
	}
	if (input.scenarioId) {
		addRowsById(
			runRowsById,
			await input.database
				.select()
				.from(studioRun)
				.where(eq(studioRun.scenarioId, input.scenarioId))
				.orderBy(desc(studioRun.createdAt))
				.limit(input.limit)
		);
	}
	return [...runRowsById.values()].sort(
		(left, right) => right.createdAt.getTime() - left.createdAt.getTime()
	);
}

async function listStudioDebugExecutions(input: {
	database: McpDatabase;
	executionId?: string;
	providerJobId?: string;
	runRows: StudioRunRow[];
}) {
	const executionRowsById = new Map<string, GeneratorExecutionRow>();
	if (input.executionId) {
		addRowsById(
			executionRowsById,
			await input.database
				.select()
				.from(generatorExecution)
				.where(eq(generatorExecution.id, input.executionId))
				.limit(1)
		);
	}
	if (input.providerJobId) {
		addRowsById(
			executionRowsById,
			await input.database
				.select()
				.from(generatorExecution)
				.where(eq(generatorExecution.providerJobId, input.providerJobId))
				.limit(5)
		);
	}

	const runExecutionIds = input.runRows
		.map((run) => run.generatorRunId)
		.filter((executionId): executionId is string => Boolean(executionId));
	if (runExecutionIds.length > 0) {
		addRowsById(
			executionRowsById,
			await input.database
				.select()
				.from(generatorExecution)
				.where(inArray(generatorExecution.id, runExecutionIds))
		);
	}

	return [...executionRowsById.values()].sort(
		(left, right) => right.createdAt.getTime() - left.createdAt.getTime()
	);
}

async function findStudioScenarioForDebug(input: {
	database: McpDatabase;
	runRows: StudioRunRow[];
	scenarioId?: string;
}) {
	const scenarioId = input.scenarioId ?? input.runRows[0]?.scenarioId;
	if (!scenarioId) {
		return null;
	}
	const [row] = await input.database
		.select()
		.from(studioScenario)
		.where(eq(studioScenario.id, scenarioId))
		.limit(1);
	return row ?? null;
}

async function listLoraRegistryRowsForDebug(input: {
	database: McpDatabase;
	urls: string[];
}) {
	const urls = [...new Set(input.urls.filter((url) => url.length > 0))];
	if (urls.length === 0) {
		return [];
	}
	return await input.database
		.select()
		.from(lora)
		.where(inArray(lora.s3Url, urls));
}

function buildStudioLoraDebug(input: {
	executionRows: GeneratorExecutionRow[];
	loraRows: LoraRow[];
	scenarioRow: StudioScenarioRow | null;
}) {
	const urlEntries: Array<
		| ReturnType<typeof collectLoraParamEntries>[number]
		| ReturnType<typeof collectProviderPayloadLoraEntries>[number]
	> = [];
	if (input.scenarioRow) {
		urlEntries.push(
			...collectLoraParamEntries(
				"scenario.params",
				asRecord(input.scenarioRow.params)
			)
		);
	}
	for (const execution of input.executionRows) {
		const providerPayload = buildProviderPayloadDebug(execution);
		urlEntries.push(
			...collectLoraParamEntries(
				"execution.params",
				asRecord(execution.params)
			),
			...collectProviderPayloadLoraEntries(providerPayload)
		);
	}

	const loraByUrl = new Map(input.loraRows.map((row) => [row.s3Url, row]));
	const registryMatches = input.loraRows.map(summarizeLoraRegistryRow);
	const overLimit = registryMatches.filter((row) => row.exceedsFalOneGbLimit);
	const missingRegistryUrls = [...new Set(urlEntries.map((entry) => entry.url))]
		.filter((url) => !loraByUrl.has(url))
		.sort();

	return {
		falLoraSizeLimitBytes: FAL_LORA_SIZE_LIMIT_BYTES,
		findings: {
			missingRegistryUrls,
			overLimit,
		},
		registryMatches,
		urlEntries,
	};
}

async function handleStudioExecutionDebugToolCall(
	_name: string,
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
) {
	const executionId = parseOptionalString(argumentsPayload.executionId);
	const providerJobId = parseOptionalString(argumentsPayload.providerJobId);
	const runId = parseOptionalString(argumentsPayload.runId);
	const scenarioId = parseOptionalString(argumentsPayload.scenarioId);
	if (!(executionId || providerJobId || runId || scenarioId)) {
		return createErrorResponse(
			id,
			"scenarioId, runId, executionId, or providerJobId is required"
		);
	}

	const limit = clampInteger(
		parseOptionalNumber(argumentsPayload.limit),
		DEFAULT_STUDIO_EXECUTION_DEBUG_LIMIT,
		MAX_STUDIO_EXECUTION_DEBUG_LIMIT
	);
	const database = getMcpDatabase();
	const requestedExecutionIds = new Set<string>();
	if (executionId) {
		requestedExecutionIds.add(executionId);
	}

	let runRows = await listStudioDebugRuns({
		database,
		executionIds: requestedExecutionIds,
		limit,
		providerJobId,
		runId,
		scenarioId,
	});
	let executionRows = await listStudioDebugExecutions({
		database,
		executionId,
		providerJobId,
		runRows,
	});

	const callbackRunIds = executionRows
		.map(readCallbackRunId)
		.filter((callbackRunId): callbackRunId is string => Boolean(callbackRunId));
	for (const callbackRunId of callbackRunIds) {
		const extraRows = await listStudioDebugRuns({
			database,
			executionIds: new Set(),
			limit,
			runId: callbackRunId,
		});
		runRows = [
			...new Map(
				[...runRows, ...extraRows].map((run) => [run.id, run])
			).values(),
		];
	}

	executionRows = await listStudioDebugExecutions({
		database,
		executionId,
		providerJobId,
		runRows,
	});

	const scenarioRow = await findStudioScenarioForDebug({
		database,
		runRows,
		scenarioId,
	});
	const loraUrlEntries = [
		...(scenarioRow
			? collectLoraParamEntries("scenario.params", asRecord(scenarioRow.params))
			: []),
		...executionRows.flatMap((execution) => {
			const providerPayload = buildProviderPayloadDebug(execution);
			return [
				...collectLoraParamEntries(
					"execution.params",
					asRecord(execution.params)
				),
				...collectProviderPayloadLoraEntries(providerPayload),
			];
		}),
	];
	const loraRows = await listLoraRegistryRowsForDebug({
		database,
		urls: loraUrlEntries.map((entry) => entry.url),
	});

	return createOkResponse(
		id,
		createToolResult({
			executions: executionRows.map(summarizeStudioExecution),
			limit,
			loraDebug: buildStudioLoraDebug({
				executionRows,
				loraRows,
				scenarioRow,
			}),
			requested: {
				executionId: executionId ?? null,
				providerJobId: providerJobId ?? null,
				runId: runId ?? null,
				scenarioId: scenarioId ?? null,
			},
			runs: runRows.map(summarizeStudioRun),
			scenario: summarizeStudioScenario(scenarioRow),
		})
	);
}

async function handleStudioRunMarkFailedToolCall(
	_name: string,
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
) {
	const runId = parseOptionalString(argumentsPayload.runId);
	if (!runId) {
		return createErrorResponse(id, "runId is required");
	}
	const errorSummary = parseOptionalString(argumentsPayload.errorSummary);
	const callbackToken =
		process.env.GENERATOR_CALLBACK_TOKEN ?? "local-generator-callback-token";
	const body: Record<string, unknown> = {};
	if (errorSummary) {
		body.errorSummary = errorSummary;
	}
	return createOkResponse(
		id,
		createToolResult(
			await fetchServiceSnapshot(
				"studio",
				`/api/internal/runs/${encodeURIComponent(runId)}/mark-failed`,
				{
					body: JSON.stringify(body),
					headers: {
						"content-type": "application/json",
						"x-generator-callback-token": callbackToken,
					},
					method: "POST",
				}
			)
		)
	);
}

async function handleStudioScenarioUpdateToolCall(
	_name: string,
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
) {
	const scenarioId = parseOptionalString(argumentsPayload.scenarioId);
	if (!scenarioId) {
		return createErrorResponse(id, "scenarioId is required");
	}

	const body: Record<string, unknown> = {};
	const name = parseOptionalString(argumentsPayload.name);
	if (name) {
		body.name = name;
	}
	const prompt = parseOptionalString(argumentsPayload.prompt);
	if (prompt) {
		body.prompt = prompt;
	}
	const workflowKey = parseOptionalString(argumentsPayload.workflowKey);
	if (workflowKey) {
		body.workflowKey = workflowKey;
	}
	if (
		argumentsPayload.params &&
		typeof argumentsPayload.params === "object" &&
		!Array.isArray(argumentsPayload.params)
	) {
		body.params = argumentsPayload.params;
	}

	if (Object.keys(body).length === 0) {
		return createErrorResponse(
			id,
			"at least one of name/prompt/params/workflowKey must be provided"
		);
	}

	const callbackToken =
		process.env.GENERATOR_CALLBACK_TOKEN ?? "local-generator-callback-token";

	return createOkResponse(
		id,
		createToolResult(
			await fetchServiceSnapshot(
				"studio",
				`/api/internal/scenarios/${encodeURIComponent(scenarioId)}`,
				{
					body: JSON.stringify(body),
					headers: {
						"content-type": "application/json",
						"x-generator-callback-token": callbackToken,
					},
					method: "PATCH",
				}
			)
		)
	);
}

const RUNPOD_PUBLIC_BASE = "https://api.runpod.ai/v2";
const RUNPOD_REST_BASE = "https://rest.runpod.io/v1";

function getRunpodApiKey(): string | null {
	return process.env.RUNPOD_API_KEY ?? null;
}

interface RunpodFetchResult {
	body: unknown;
	ok: boolean;
	status: number;
}

async function runpodFetch(
	url: string,
	init: RequestInit = {}
): Promise<RunpodFetchResult> {
	const apiKey = getRunpodApiKey();
	if (!apiKey) {
		throw new Error("RUNPOD_API_KEY is not configured on the MCP server");
	}
	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		...((init.headers as Record<string, string> | undefined) ?? {}),
	};
	if (init.body && !headers["Content-Type"]) {
		headers["Content-Type"] = "application/json";
	}
	const response = await fetch(url, { ...init, headers });
	const text = await response.text();
	let parsed: unknown = text;
	if (text) {
		try {
			parsed = JSON.parse(text);
		} catch {
			// keep raw text
		}
	}
	return { body: parsed, ok: response.ok, status: response.status };
}

function runpodResult(
	id: JsonRpcResponse["id"],
	result: RunpodFetchResult
): JsonRpcResponse {
	return createOkResponse(id, createToolResult(result, !result.ok));
}

async function runRunpodServerlessRequestAction(
	name: "runpod_serverless_status" | "runpod_serverless_cancel",
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
): Promise<JsonRpcResponse> {
	const endpointId = parseOptionalString(argumentsPayload.endpointId);
	const requestId = parseOptionalString(argumentsPayload.requestId);
	if (!(endpointId && requestId)) {
		return createErrorResponse(id, "endpointId and requestId are required");
	}
	const verb = name === "runpod_serverless_cancel" ? "cancel" : "status";
	const init: RequestInit =
		name === "runpod_serverless_cancel" ? { method: "POST" } : {};
	return runpodResult(
		id,
		await runpodFetch(
			`${RUNPOD_PUBLIC_BASE}/${endpointId}/${verb}/${requestId}`,
			init
		)
	);
}

async function runRunpodServerlessEndpointAction(
	name:
		| "runpod_serverless_health"
		| "runpod_serverless_requests"
		| "runpod_serverless_purge_queue",
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
): Promise<JsonRpcResponse> {
	const endpointId = parseOptionalString(argumentsPayload.endpointId);
	if (!endpointId) {
		return createErrorResponse(id, "endpointId is required");
	}
	if (name === "runpod_serverless_health") {
		return runpodResult(
			id,
			await runpodFetch(`${RUNPOD_PUBLIC_BASE}/${endpointId}/health`)
		);
	}
	if (name === "runpod_serverless_purge_queue") {
		return runpodResult(
			id,
			await runpodFetch(`${RUNPOD_PUBLIC_BASE}/${endpointId}/purge-queue`, {
				method: "POST",
			})
		);
	}
	const lastId = parseOptionalString(argumentsPayload.lastId);
	const url = new URL(`${RUNPOD_PUBLIC_BASE}/${endpointId}/requests`);
	if (lastId) {
		url.searchParams.set("lastId", lastId);
	}
	return runpodResult(id, await runpodFetch(url.toString()));
}

async function runRunpodServerlessRunAction(
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
): Promise<JsonRpcResponse> {
	const endpointId = parseOptionalString(argumentsPayload.endpointId);
	if (!endpointId) {
		return createErrorResponse(id, "endpointId is required");
	}
	const input = argumentsPayload.input;
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return createErrorResponse(id, "input must be an object");
	}
	const sync = parseOptionalBoolean(argumentsPayload.sync) === true;
	const route = sync ? "runsync" : "run";
	const payload: Record<string, unknown> = { input };
	if (
		argumentsPayload.policy &&
		typeof argumentsPayload.policy === "object" &&
		!Array.isArray(argumentsPayload.policy)
	) {
		payload.policy = argumentsPayload.policy;
	}
	const webhook = parseOptionalString(argumentsPayload.webhook);
	if (webhook) {
		payload.webhook = webhook;
	}
	return runpodResult(
		id,
		await runpodFetch(`${RUNPOD_PUBLIC_BASE}/${endpointId}/${route}`, {
			body: JSON.stringify(payload),
			method: "POST",
		})
	);
}

async function runRunpodRestAction(
	name:
		| "runpod_endpoint_get"
		| "runpod_endpoint_patch"
		| "runpod_template_get"
		| "runpod_template_patch",
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
): Promise<JsonRpcResponse> {
	const isEndpoint = name.startsWith("runpod_endpoint_");
	const resource = isEndpoint ? "endpoints" : "templates";
	const idKey = isEndpoint ? "endpointId" : "templateId";
	const resourceId = parseOptionalString(argumentsPayload[idKey]);
	if (!resourceId) {
		return createErrorResponse(id, `${idKey} is required`);
	}
	const url = `${RUNPOD_REST_BASE}/${resource}/${resourceId}`;
	if (name === "runpod_endpoint_get" || name === "runpod_template_get") {
		return runpodResult(id, await runpodFetch(url));
	}
	const body = argumentsPayload.body;
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return createErrorResponse(id, "body must be an object");
	}
	return runpodResult(
		id,
		await runpodFetch(url, { body: JSON.stringify(body), method: "PATCH" })
	);
}

async function handleRunpodToolCall(
	name: string,
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
): Promise<JsonRpcResponse> {
	try {
		if (
			name === "runpod_serverless_status" ||
			name === "runpod_serverless_cancel"
		) {
			return await runRunpodServerlessRequestAction(name, argumentsPayload, id);
		}
		if (
			name === "runpod_serverless_health" ||
			name === "runpod_serverless_requests" ||
			name === "runpod_serverless_purge_queue"
		) {
			return await runRunpodServerlessEndpointAction(
				name,
				argumentsPayload,
				id
			);
		}
		if (name === "runpod_serverless_run") {
			return await runRunpodServerlessRunAction(argumentsPayload, id);
		}
		if (
			name === "runpod_endpoint_get" ||
			name === "runpod_endpoint_patch" ||
			name === "runpod_template_get" ||
			name === "runpod_template_patch"
		) {
			return await runRunpodRestAction(name, argumentsPayload, id);
		}
		return createErrorResponse(id, `Unknown runpod tool: ${name}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return createErrorResponse(id, `runpod tool failure: ${message}`);
	}
}

type ToolHandler = (
	name: string,
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
) => Promise<JsonRpcResponse>;

const toolHandlers: Record<string, ToolHandler> = {
	admin_lora_training_queue_snapshot: handleAdminLoraTrainingQueueToolCall,
	admin_request: handleAdminRequestToolCall,
	admin_settings_get: handleTrainingProviderToolCall,
	generator_execution_submit: handleGeneratorExecutionToolCall,
	generator_execution_sync: handleGeneratorExecutionToolCall,
	lora_get: handleLoraToolCall,
	lora_list: handleLoraToolCall,
	studio_execution_debug: handleStudioExecutionDebugToolCall,
	studio_run_mark_failed: handleStudioRunMarkFailedToolCall,
	studio_scenario_update: handleStudioScenarioUpdateToolCall,
	test_user_get: handleTestUserToolCall,
	test_user_upsert: handleTestUserToolCall,
	training_provider_get: handleTrainingProviderToolCall,
	training_provider_set: handleTrainingProviderToolCall,
};

function resolveToolHandler(name: string): ToolHandler | null {
	if (name.startsWith("kafka_")) {
		return handleKafkaToolCall;
	}
	if (name.startsWith("persons_")) {
		return handlePersonsToolCall;
	}
	if (name.startsWith("runpod_")) {
		return handleRunpodToolCall;
	}
	return toolHandlers[name] ?? null;
}

async function handleToolCall(message: JsonRpcRequest) {
	const name = parseOptionalString(message.params?.name);
	const argumentsPayload =
		(message.params?.arguments as Record<string, unknown> | undefined) ?? {};
	const id = message.id ?? null;

	if (!name) {
		return createErrorResponse(id, "Tool name is required");
	}

	const handler = resolveToolHandler(name);
	if (handler) {
		return handler(name, argumentsPayload, id);
	}

	switch (name) {
		case "workspace_summary":
			return createOkResponse(
				id,
				createToolResult({
					defaultServices: getDefaultServiceNames(),
					workspaceRoot: getWorkspaceRoot(),
				})
			);
		case "service_health":
			return createOkResponse(
				id,
				createToolResult(
					await collectServiceHealth(
						parseStringArray(argumentsPayload.services)
					)
				)
			);
		case "service_request": {
			const service = parseOptionalString(argumentsPayload.service);
			const path = parseOptionalString(argumentsPayload.path);
			if (!(service && supportedServices.has(service as ServiceName))) {
				return createErrorResponse(
					id,
					`Unsupported service: ${service ?? "unknown"}`
				);
			}
			if (!path) {
				return createErrorResponse(id, "path is required");
			}

			const method = parseOptionalString(argumentsPayload.method) ?? "GET";
			const headers = parseHeaders(argumentsPayload.headers);
			const body = argumentsPayload.body;
			return createOkResponse(
				id,
				createToolResult(
					await fetchServiceSnapshot(service as ServiceName, path, {
						body: body === undefined ? undefined : JSON.stringify(body),
						headers: {
							...(body === undefined
								? {}
								: { "content-type": "application/json" }),
							...(headers ?? {}),
						},
						method,
					})
				)
			);
		}
		case "generator_workflows_get": {
			const internalToken = getGeneratorInternalToken();
			return createOkResponse(
				id,
				createToolResult(
					await fetchServiceSnapshot("generator", "/api/workflows", {
						headers: internalToken
							? { [GENERATOR_INTERNAL_TOKEN_HEADER]: internalToken }
							: undefined,
					})
				)
			);
		}
		default:
			return createErrorResponse(id, `Unknown tool: ${name}`);
	}
}

function handleRequest(message: JsonRpcRequest) {
	const id = message.id ?? null;

	switch (message.method) {
		case "initialize":
			return createOkResponse(id, {
				capabilities: {
					tools: {
						listChanged: false,
					},
				},
				protocolVersion: "2024-11-05",
				serverInfo: {
					name: "generator-debug-mcp",
					version: "0.0.0",
				},
			});
		case "notifications/initialized":
		case "initialized":
			return createOkResponse(id, {});
		case "ping":
			return createOkResponse(id, {});
		case "tools/list":
			return createOkResponse(id, {
				tools: toolDefinitions,
			});
		case "tools/call":
			return handleToolCall(message);
		default:
			return createErrorResponse(id, `Unsupported method: ${message.method}`);
	}
}

export const createApp = ({ authToken }: AppOptions) => {
	const app = new Hono();

	app.get("/", (c) => c.text("generator debug mcp"));
	app.get("/api/health", (c) => c.json({ ok: true, server: "mcp" }));
	app.use(
		"/mcp",
		bearerAuth({
			token: authToken,
		})
	);
	app.post("/mcp", async (c) => {
		const payload = (await c.req.json()) as JsonRpcRequest;
		return c.json(await handleRequest(payload));
	});

	return app;
};
