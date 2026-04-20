import type { GeneratorExecutionRecord } from "@generator/contracts/generator";
import {
	LORA_BASE_MODELS,
	type LoraRegistryEntry,
} from "@generator/contracts/loras";
import { Kafka, logLevel, type Producer, type SASLOptions } from "kafkajs";
import { z } from "zod";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const generatorArtifactSchema = z.object({
	url: z.string().nullable().optional(),
});

const executionPhaseSchema = z.enum([
	"queued",
	"submitting",
	"in_queue",
	"running",
	"finalizing",
	"done",
	"failed",
]);

const generatorExecutionSchema = z.object({
	artifacts: z.array(generatorArtifactSchema),
	errorSummary: z.string().nullable(),
	etaMs: z.number().nullable().optional(),
	id: z.string().min(1),
	inputImageUrl: z.string(),
	lastLogLine: z.string().nullable().optional(),
	phase: executionPhaseSchema.nullable().optional(),
	progressPct: z.number().nullable().optional(),
	providerEndpointId: z.string().nullable(),
	providerJobId: z.string().nullable(),
	queuePosition: z.number().nullable().optional(),
	status: z.enum(["queued", "running", "succeeded", "failed"]),
	workflowKey: z.string().min(1),
});

const contextSchema = z.record(z.string(), z.unknown());

export const eventTopics = {
	generatorExecutionUpdates: "generator.execution.updates.v1",
	loraRegistryChanges: "loras.registry.changes.v1",
	personDatasetVariantRefillRequests:
		"persons.dataset.variant-refill-requests.v1",
	personLoraTrainingConfirmations: "persons.lora-training.confirmations.v1",
	personLoraTrainingRequests: "persons.lora-training.requests.v1",
	personLoraTrainingUpdates: "persons.lora-training.updates.v1",
} as const;

export const eventNames = {
	generatorExecutionUpdated: "generator.execution.updated",
	loraRegistryChanged: "loras.registry.changed",
	personDatasetVariantRefillRequested:
		"persons.dataset.variant-refill-requested",
	personLoraTrainingConfirmed: "persons.lora-training.confirmed",
	personLoraTrainingRequested: "persons.lora-training.requested",
	personLoraTrainingUpdated: "persons.lora-training.updated",
} as const;

const loraRegistryEntrySchema = z.object({
	baseModel: z.enum(LORA_BASE_MODELS),
	createdAt: z.string(),
	defaultWeight: z.number(),
	description: z.string(),
	id: z.string().min(1),
	name: z.string(),
	pairGroupId: z.string().nullable(),
	s3Key: z.string(),
	s3Url: z.string(),
	sizeBytes: z.number(),
	slug: z.string(),
	sourceProvider: z.enum(["civitai", "huggingface", "direct"]).optional(),
	sourceUrl: z.string().nullable(),
	status: z.enum(["active", "archived"]),
	triggerWords: z.array(z.string()),
	updatedAt: z.string(),
	variant: z.enum(["high", "low", "both"]).nullable(),
}) satisfies z.ZodType<LoraRegistryEntry>;

export const loraRegistryChangeKinds = [
	"created",
	"updated",
	"archived",
	"restored",
	"deleted",
] as const;

export type LoraRegistryChangeKind = (typeof loraRegistryChangeKinds)[number];

const personLoraTrainingRequestSchema = z.object({
	debugCorrelationId: z.string().optional(),
	description: z.string().optional(),
	/**
	 * Operating mode for the runner:
	 *   - "prep-only" — generate the dataset photos individually and stop
	 *     at status `awaiting-approval`, waiting for the operator to confirm
	 *     in the persons UI before submitting to the trainer.
	 *   - "auto-train" — legacy behaviour: prep + zip + submit + poll in one
	 *     run() call. Used for retrains with `reuseDatasetUrl`, where there
	 *     is nothing to review.
	 */
	mode: z.enum(["prep-only", "auto-train"]).optional(),
	outputName: z.string().optional(),
	personId: z.string().min(1),
	personName: z.string().min(1),
	personSlug: z.string().min(1),
	referencePhotoUrl: z.string().min(1),
	referencePrompt: z.string().optional(),
	seedReferenceImages: z
		.array(
			z.object({
				caption: z.string(),
				s3Key: z.string().nullable().optional(),
				url: z.string().min(1),
				variantId: z.string().min(1),
			})
		)
		.optional(),
	/**
	 * Если задано — runner пропускает повторную генерацию reference-датасета
	 * через fal.ai/flux-2/edit и передаёт этот URL прямо в pod_runner как
	 * DATASET_URL. Кладётся persons-сервисом из `person.datasetUrl` при
	 * retrain'е, если оператор не запросил `regenerateDataset=true` явно.
	 */
	reuseDatasetUrl: z.string().min(1).optional(),
	trainingRunId: z.string().min(1),
	triggerWord: z.string().optional(),
});

const approvedDatasetItemSchema = z.object({
	caption: z.string().min(1),
	s3Key: z.string().min(1).nullable(),
	url: z.string().min(1),
	variantId: z.string().min(1),
});

export type ApprovedDatasetItem = z.infer<typeof approvedDatasetItemSchema>;

/**
 * Published by persons-service when the operator clicks "Train LoRA" on a
 * person whose dataset has been generated and reviewed. Carries the same
 * envelope as the original training request plus the explicit list of
 * approved photos so the admin runner can rebuild the zip without going
 * through persons-api.
 */
const personLoraTrainingConfirmationSchema =
	personLoraTrainingRequestSchema.extend({
		approvedItems: z.array(approvedDatasetItemSchema).min(1),
	});

/**
 * Published by persons-service for a single rejected dataset photo. Admin
 * worker generates exactly one new variant via fal.ai/flux-2/edit, uploads
 * it to S3 and emits a `lora-training.updated` event with one
 * `referenceImageItems[]` entry so persons can upsert the slot.
 */
const personDatasetVariantRefillRequestSchema = z.object({
	debugCorrelationId: z.string().optional(),
	description: z.string().optional(),
	personId: z.string().min(1),
	personSlug: z.string().min(1),
	referencePhotoUrl: z.string().min(1),
	referencePrompt: z.string().optional(),
	requestNonce: z.string().min(1),
	trainingRunId: z.string().min(1),
	triggerWord: z.string().min(1),
	variantId: z.string().min(1),
});

const eventEnvelopeBaseSchema = z.object({
	id: z.string().min(1),
	name: z.enum([
		eventNames.generatorExecutionUpdated,
		eventNames.loraRegistryChanged,
		eventNames.personDatasetVariantRefillRequested,
		eventNames.personLoraTrainingConfirmed,
		eventNames.personLoraTrainingRequested,
		eventNames.personLoraTrainingUpdated,
	]),
	occurredAt: z.string().datetime(),
	source: z.string().min(1),
	version: z.literal(1),
});

export const loraRegistryChangedEventSchema = eventEnvelopeBaseSchema.extend({
	data: z.object({
		change: z.enum(loraRegistryChangeKinds),
		context: contextSchema.default({}),
		lora: loraRegistryEntrySchema,
	}),
	name: z.literal(eventNames.loraRegistryChanged),
});

export const generatorExecutionUpdatedEventSchema =
	eventEnvelopeBaseSchema.extend({
		data: z.object({
			context: contextSchema.default({}),
			execution: generatorExecutionSchema,
		}),
		name: z.literal(eventNames.generatorExecutionUpdated),
	});

export const personLoraTrainingUpdatedEventSchema =
	eventEnvelopeBaseSchema.extend({
		data: z.object({
			context: contextSchema.default({}),
			event: z.unknown(),
		}),
		name: z.literal(eventNames.personLoraTrainingUpdated),
	});

export const personLoraTrainingRequestedEventSchema =
	eventEnvelopeBaseSchema.extend({
		data: personLoraTrainingRequestSchema,
		name: z.literal(eventNames.personLoraTrainingRequested),
	});

export const personLoraTrainingConfirmedEventSchema =
	eventEnvelopeBaseSchema.extend({
		data: personLoraTrainingConfirmationSchema,
		name: z.literal(eventNames.personLoraTrainingConfirmed),
	});

export const personDatasetVariantRefillRequestedEventSchema =
	eventEnvelopeBaseSchema.extend({
		data: personDatasetVariantRefillRequestSchema,
		name: z.literal(eventNames.personDatasetVariantRefillRequested),
	});

export const eventEnvelopeSchema = z.discriminatedUnion("name", [
	generatorExecutionUpdatedEventSchema,
	loraRegistryChangedEventSchema,
	personDatasetVariantRefillRequestedEventSchema,
	personLoraTrainingConfirmedEventSchema,
	personLoraTrainingRequestedEventSchema,
	personLoraTrainingUpdatedEventSchema,
]);

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type GeneratorExecutionUpdatedEvent = z.infer<
	typeof generatorExecutionUpdatedEventSchema
>;
export type LoraRegistryChangedEvent = z.infer<
	typeof loraRegistryChangedEventSchema
>;
export type PersonLoraTrainingUpdatedEvent = z.infer<
	typeof personLoraTrainingUpdatedEventSchema
>;
export type PersonLoraTrainingRequestedEvent = z.infer<
	typeof personLoraTrainingRequestedEventSchema
>;
export type PersonLoraTrainingRequest = z.infer<
	typeof personLoraTrainingRequestSchema
>;
export type PersonLoraTrainingConfirmedEvent = z.infer<
	typeof personLoraTrainingConfirmedEventSchema
>;
export type PersonLoraTrainingConfirmation = z.infer<
	typeof personLoraTrainingConfirmationSchema
>;
export type PersonDatasetVariantRefillRequestedEvent = z.infer<
	typeof personDatasetVariantRefillRequestedEventSchema
>;
export type PersonDatasetVariantRefillRequest = z.infer<
	typeof personDatasetVariantRefillRequestSchema
>;

export interface EventPublisher {
	close(): Promise<void>;
	publishGeneratorExecutionUpdated(input: {
		context?: Record<string, unknown>;
		execution: GeneratorExecutionRecord;
	}): Promise<void>;
	publishLoraRegistryChanged(input: {
		change: LoraRegistryChangeKind;
		context?: Record<string, unknown>;
		lora: LoraRegistryEntry;
	}): Promise<void>;
	publishPersonDatasetVariantRefillRequested(
		input: PersonDatasetVariantRefillRequest
	): Promise<void>;
	publishPersonLoraTrainingConfirmed(
		input: PersonLoraTrainingConfirmation
	): Promise<void>;
	publishPersonLoraTrainingRequested(
		input: PersonLoraTrainingRequest
	): Promise<void>;
	publishPersonLoraTrainingUpdated(input: {
		context?: Record<string, unknown>;
		event: unknown;
	}): Promise<void>;
}

export interface EventConsumerRuntime {
	close(): Promise<void>;
}

export interface KafkaSaslConfig {
	mechanism: "plain" | "scram-sha-256" | "scram-sha-512";
	password: string;
	username: string;
}

export interface KafkaEventBusConfig {
	brokers: string[];
	clientId: string;
	connectTimeoutMs?: number;
	requestTimeoutMs?: number;
	sasl?: KafkaSaslConfig;
	ssl?: boolean;
}

export interface EventLogger {
	error(message: string, metadata?: Record<string, unknown>): void;
	info?(message: string, metadata?: Record<string, unknown>): void;
	warn?(message: string, metadata?: Record<string, unknown>): void;
}

export function parseKafkaBrokers(raw: string | undefined): string[] {
	return (raw ?? "")
		.split(",")
		.map((broker) => broker.trim())
		.filter((broker) => broker.length > 0);
}

function toKafkaSasl(
	config: KafkaSaslConfig | undefined
): SASLOptions | undefined {
	if (!config) {
		return undefined;
	}

	return {
		mechanism: config.mechanism,
		password: config.password,
		username: config.username,
	};
}

function createKafka(config: KafkaEventBusConfig) {
	return new Kafka({
		brokers: config.brokers,
		clientId: config.clientId,
		connectionTimeout: config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
		logLevel: logLevel.ERROR,
		requestTimeout: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
		sasl: toKafkaSasl(config.sasl),
		ssl: config.ssl,
	});
}

function createEnvelope<TName extends EventEnvelope["name"]>(
	name: TName,
	source: string,
	data: Extract<EventEnvelope, { name: TName }>["data"]
): Extract<EventEnvelope, { name: TName }> {
	return {
		data,
		id: crypto.randomUUID(),
		name,
		occurredAt: new Date().toISOString(),
		source,
		version: 1,
	} as Extract<EventEnvelope, { name: TName }>;
}

export function createNoopEventPublisher(): EventPublisher {
	return {
		async close() {
			await Promise.resolve();
		},
		async publishGeneratorExecutionUpdated() {
			await Promise.resolve();
		},
		async publishLoraRegistryChanged() {
			await Promise.resolve();
		},
		async publishPersonDatasetVariantRefillRequested() {
			await Promise.resolve();
		},
		async publishPersonLoraTrainingConfirmed() {
			await Promise.resolve();
		},
		async publishPersonLoraTrainingRequested() {
			await Promise.resolve();
		},
		async publishPersonLoraTrainingUpdated() {
			await Promise.resolve();
		},
	};
}

export function createKafkaEventPublisher(
	config: KafkaEventBusConfig,
	options: {
		source: string;
	} = { source: config.clientId }
): EventPublisher {
	const kafka = createKafka(config);
	let producerPromise: Promise<Producer> | null = null;

	const getProducer = () => {
		if (!producerPromise) {
			const producer = kafka.producer();
			const connected = producer.connect().then(() => producer);
			producerPromise = connected;
			connected.catch(() => {
				if (producerPromise === connected) {
					producerPromise = null;
				}
			});
		}
		return producerPromise;
	};

	const publish = async (topic: string, key: string, event: EventEnvelope) => {
		try {
			const producer = await getProducer();
			await producer.send({
				messages: [
					{
						key,
						value: JSON.stringify(event),
					},
				],
				topic,
			});
		} catch (error) {
			producerPromise = null;
			throw error;
		}
	};

	return {
		async close() {
			const pending = producerPromise;
			producerPromise = null;
			try {
				const producer = await pending;
				if (producer) {
					await producer.disconnect();
				}
			} catch {
				// connect failed earlier, nothing to disconnect
			}
		},
		async publishGeneratorExecutionUpdated(input) {
			const event = createEnvelope(
				eventNames.generatorExecutionUpdated,
				options.source,
				{
					context: input.context ?? {},
					execution: input.execution,
				}
			);
			await publish(
				eventTopics.generatorExecutionUpdates,
				input.execution.id,
				event
			);
		},
		async publishLoraRegistryChanged(input) {
			const event = createEnvelope(
				eventNames.loraRegistryChanged,
				options.source,
				{
					change: input.change,
					context: input.context ?? {},
					lora: input.lora,
				}
			);
			await publish(eventTopics.loraRegistryChanges, input.lora.id, event);
		},
		async publishPersonLoraTrainingUpdated(input) {
			const event = createEnvelope(
				eventNames.personLoraTrainingUpdated,
				options.source,
				{
					context: input.context ?? {},
					event: input.event,
				}
			);
			const key =
				typeof input.context?.trainingRunId === "string"
					? input.context.trainingRunId
					: event.id;
			await publish(eventTopics.personLoraTrainingUpdates, key, event);
		},
		async publishPersonLoraTrainingRequested(input) {
			const event = createEnvelope(
				eventNames.personLoraTrainingRequested,
				options.source,
				input
			);
			await publish(
				eventTopics.personLoraTrainingRequests,
				input.trainingRunId,
				event
			);
		},
		async publishPersonLoraTrainingConfirmed(input) {
			const event = createEnvelope(
				eventNames.personLoraTrainingConfirmed,
				options.source,
				input
			);
			await publish(
				eventTopics.personLoraTrainingConfirmations,
				input.trainingRunId,
				event
			);
		},
		async publishPersonDatasetVariantRefillRequested(input) {
			const event = createEnvelope(
				eventNames.personDatasetVariantRefillRequested,
				options.source,
				input
			);
			// Partition by `${trainingRunId}:${variantId}` so refills for the same
			// slot land on the same partition and are processed in order, while
			// refills for different slots can run concurrently across partitions.
			await publish(
				eventTopics.personDatasetVariantRefillRequests,
				`${input.trainingRunId}:${input.variantId}`,
				event
			);
		},
	};
}

export interface EventConsumerHandlers {
	onGeneratorExecutionUpdated?: (
		event: GeneratorExecutionUpdatedEvent
	) => Promise<void>;
	onLoraRegistryChanged?: (event: LoraRegistryChangedEvent) => Promise<void>;
	onPersonDatasetVariantRefillRequested?: (
		event: PersonDatasetVariantRefillRequestedEvent
	) => Promise<void>;
	onPersonLoraTrainingConfirmed?: (
		event: PersonLoraTrainingConfirmedEvent
	) => Promise<void>;
	onPersonLoraTrainingRequested?: (
		event: PersonLoraTrainingRequestedEvent
	) => Promise<void>;
	onPersonLoraTrainingUpdated?: (
		event: PersonLoraTrainingUpdatedEvent
	) => Promise<void>;
}

async function dispatchParsedEvent(
	parsed: EventEnvelope,
	handlers: EventConsumerHandlers,
	logger: EventLogger | undefined,
	topic: string
) {
	if (
		parsed.name === eventNames.generatorExecutionUpdated &&
		handlers.onGeneratorExecutionUpdated
	) {
		await handlers.onGeneratorExecutionUpdated(parsed);
		return;
	}

	if (
		parsed.name === eventNames.loraRegistryChanged &&
		handlers.onLoraRegistryChanged
	) {
		await handlers.onLoraRegistryChanged(parsed);
		return;
	}

	if (
		parsed.name === eventNames.personLoraTrainingRequested &&
		handlers.onPersonLoraTrainingRequested
	) {
		await handlers.onPersonLoraTrainingRequested(parsed);
		return;
	}

	if (
		parsed.name === eventNames.personLoraTrainingConfirmed &&
		handlers.onPersonLoraTrainingConfirmed
	) {
		await handlers.onPersonLoraTrainingConfirmed(parsed);
		return;
	}

	if (
		parsed.name === eventNames.personDatasetVariantRefillRequested &&
		handlers.onPersonDatasetVariantRefillRequested
	) {
		await handlers.onPersonDatasetVariantRefillRequested(parsed);
		return;
	}

	if (
		parsed.name === eventNames.personLoraTrainingUpdated &&
		handlers.onPersonLoraTrainingUpdated
	) {
		await handlers.onPersonLoraTrainingUpdated(parsed);
		return;
	}

	logger?.info?.("events.kafka.unhandled", {
		eventName: parsed.name,
		topic,
	});
}

function parseEnvelopeOrLog(
	rawValue: string,
	logger: EventLogger | undefined,
	context: { offset: string; partition: number; topic: string }
): EventEnvelope | null {
	try {
		return eventEnvelopeSchema.parse(JSON.parse(rawValue));
	} catch (error) {
		logger?.error("events.kafka.parse-failed", {
			error: error instanceof Error ? error.message : "unknown error",
			...context,
		});
		return null;
	}
}

/**
 * Ensure the given topics exist on the broker. KafkaJS's `consumer.subscribe`
 * issues a `Metadata` RPC for the topic and surfaces `UNKNOWN_TOPIC_OR_PARTITION`
 * as an unhandled rejection if the topic has never been produced to before —
 * which on Bun crashes the worker process and traps it in a restart loop. By
 * calling `admin.createTopics({ waitForLeaders: true })` first, we make boot
 * idempotent: if the topic already exists kafkajs returns `false` without
 * throwing, and otherwise it is created with the broker's default partition /
 * replication settings.
 */
async function ensureTopicsExist(
	kafka: Kafka,
	topics: readonly string[],
	logger: EventLogger | undefined
): Promise<void> {
	if (topics.length === 0) {
		return;
	}
	const admin = kafka.admin();
	try {
		await admin.connect();
		await admin.createTopics({
			topics: topics.map((topic) => ({ topic })),
			waitForLeaders: true,
		});
	} catch (error) {
		logger?.warn?.("events.kafka.ensure-topics-failed", {
			error: error instanceof Error ? error.message : "unknown error",
			topics: [...topics],
		});
	} finally {
		await admin.disconnect().catch(() => {
			// ignore disconnect errors
		});
	}
}

export async function createKafkaEventConsumer(options: {
	config: KafkaEventBusConfig;
	groupId: string;
	handlers: EventConsumerHandlers;
	logger?: EventLogger;
	/**
	 * If true, propagate handler errors back to kafkajs so the message is retried
	 * (offsets are not committed). Defaults to false: errors are logged and the
	 * message is skipped to avoid poison-pill loops.
	 */
	rethrowHandlerErrors?: boolean;
	topics: string[];
}): Promise<EventConsumerRuntime> {
	const kafka = createKafka(options.config);
	await ensureTopicsExist(kafka, options.topics, options.logger);
	const consumer = kafka.consumer({ groupId: options.groupId });

	await consumer.connect();
	for (const topic of options.topics) {
		await consumer.subscribe({ fromBeginning: false, topic });
	}

	await consumer.run({
		eachMessage: async ({ message, partition, topic }) => {
			if (!message.value) {
				return;
			}

			const parsed = parseEnvelopeOrLog(
				message.value.toString(),
				options.logger,
				{ offset: message.offset, partition, topic }
			);
			if (!parsed) {
				return;
			}

			try {
				await dispatchParsedEvent(
					parsed,
					options.handlers,
					options.logger,
					topic
				);
			} catch (error) {
				options.logger?.error("events.kafka.handler-failed", {
					error: error instanceof Error ? error.message : "unknown error",
					eventId: parsed.id,
					eventName: parsed.name,
					offset: message.offset,
					partition,
					topic,
				});
				if (options.rethrowHandlerErrors) {
					throw error;
				}
			}
		},
	});

	return {
		async close() {
			await consumer.disconnect();
		},
	};
}
