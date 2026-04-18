import {
	collectServiceHealth,
	fetchServiceSnapshot,
	getDefaultServiceNames,
	getWorkspaceRoot,
	type ServiceName,
} from "@generator/debug-tools/shared";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
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

function postJson(path: string, payload: unknown) {
	return fetchServiceSnapshot("generator", path, {
		body: JSON.stringify(payload),
		headers: {
			"content-type": "application/json",
		},
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

type ToolHandler = (
	name: string,
	argumentsPayload: Record<string, unknown>,
	id: JsonRpcResponse["id"]
) => Promise<JsonRpcResponse>;

const toolHandlers: Record<string, ToolHandler> = {
	admin_settings_get: handleTrainingProviderToolCall,
	generator_execution_submit: handleGeneratorExecutionToolCall,
	generator_execution_sync: handleGeneratorExecutionToolCall,
	lora_get: handleLoraToolCall,
	lora_list: handleLoraToolCall,
	studio_run_mark_failed: handleStudioRunMarkFailedToolCall,
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
		case "generator_workflows_get":
			return createOkResponse(
				id,
				createToolResult(
					await fetchServiceSnapshot("generator", "/api/workflows")
				)
			);
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
