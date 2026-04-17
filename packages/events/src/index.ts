import type { GeneratorExecutionRecord } from "@generator/contracts/generator";
import { Kafka, logLevel, type Producer, type SASLOptions } from "kafkajs";
import { z } from "zod";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const generatorArtifactSchema = z.object({
	url: z.string().nullable().optional(),
});

const generatorExecutionSchema = z.object({
	artifacts: z.array(generatorArtifactSchema),
	errorSummary: z.string().nullable(),
	id: z.string().min(1),
	inputImageUrl: z.string(),
	progressPct: z.number().nullable().optional(),
	providerEndpointId: z.string().nullable(),
	providerJobId: z.string().nullable(),
	status: z.enum(["queued", "running", "succeeded", "failed"]),
	workflowKey: z.string().min(1),
});

const contextSchema = z.record(z.string(), z.unknown());

export const eventTopics = {
	generatorExecutionUpdates: "generator.execution.updates.v1",
	personLoraTrainingRequests: "persons.lora-training.requests.v1",
	personLoraTrainingUpdates: "persons.lora-training.updates.v1",
} as const;

export const eventNames = {
	generatorExecutionUpdated: "generator.execution.updated",
	personLoraTrainingRequested: "persons.lora-training.requested",
	personLoraTrainingUpdated: "persons.lora-training.updated",
} as const;

const personLoraTrainingRequestSchema = z.object({
	debugCorrelationId: z.string().optional(),
	description: z.string().optional(),
	outputName: z.string().optional(),
	personId: z.string().min(1),
	personName: z.string().min(1),
	personSlug: z.string().min(1),
	referencePhotoUrl: z.string().min(1),
	referencePrompt: z.string().optional(),
	trainingRunId: z.string().min(1),
	triggerWord: z.string().optional(),
});

const eventEnvelopeBaseSchema = z.object({
	id: z.string().min(1),
	name: z.enum([
		eventNames.generatorExecutionUpdated,
		eventNames.personLoraTrainingRequested,
		eventNames.personLoraTrainingUpdated,
	]),
	occurredAt: z.string().datetime(),
	source: z.string().min(1),
	version: z.literal(1),
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

export const eventEnvelopeSchema = z.discriminatedUnion("name", [
	generatorExecutionUpdatedEventSchema,
	personLoraTrainingRequestedEventSchema,
	personLoraTrainingUpdatedEventSchema,
]);

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type GeneratorExecutionUpdatedEvent = z.infer<
	typeof generatorExecutionUpdatedEventSchema
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

export interface EventPublisher {
	close(): Promise<void>;
	publishGeneratorExecutionUpdated(input: {
		context?: Record<string, unknown>;
		execution: GeneratorExecutionRecord;
	}): Promise<void>;
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
			producerPromise = producer.connect().then(() => producer);
		}
		return producerPromise;
	};

	const publish = async (topic: string, key: string, event: EventEnvelope) => {
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
	};

	return {
		async close() {
			const producer = await producerPromise;
			if (producer) {
				await producer.disconnect();
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
	};
}

export async function createKafkaEventConsumer(options: {
	config: KafkaEventBusConfig;
	groupId: string;
	handlers: {
		onGeneratorExecutionUpdated?: (
			event: GeneratorExecutionUpdatedEvent
		) => Promise<void>;
		onPersonLoraTrainingRequested?: (
			event: PersonLoraTrainingRequestedEvent
		) => Promise<void>;
		onPersonLoraTrainingUpdated?: (
			event: PersonLoraTrainingUpdatedEvent
		) => Promise<void>;
	};
	logger?: EventLogger;
	topics: string[];
}): Promise<EventConsumerRuntime> {
	const kafka = createKafka(options.config);
	const consumer = kafka.consumer({ groupId: options.groupId });

	await consumer.connect();
	for (const topic of options.topics) {
		await consumer.subscribe({ fromBeginning: false, topic });
	}

	await consumer.run({
		eachMessage: async ({ message, topic }) => {
			if (!message.value) {
				return;
			}

			const parsed = eventEnvelopeSchema.parse(
				JSON.parse(message.value.toString())
			);

			if (
				parsed.name === eventNames.generatorExecutionUpdated &&
				options.handlers.onGeneratorExecutionUpdated
			) {
				await options.handlers.onGeneratorExecutionUpdated(parsed);
				return;
			}

			if (
				parsed.name === eventNames.personLoraTrainingRequested &&
				options.handlers.onPersonLoraTrainingRequested
			) {
				await options.handlers.onPersonLoraTrainingRequested(parsed);
				return;
			}

			if (
				parsed.name === eventNames.personLoraTrainingUpdated &&
				options.handlers.onPersonLoraTrainingUpdated
			) {
				await options.handlers.onPersonLoraTrainingUpdated(parsed);
				return;
			}

			options.logger?.info?.("events.kafka.unhandled", {
				eventName: parsed.name,
				topic,
			});
		},
	});

	return {
		async close() {
			await consumer.disconnect();
		},
	};
}
