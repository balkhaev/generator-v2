import { relations, sql } from "drizzle-orm";
import {
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Mode пользовательских RunPod конфигураций.
 *
 * `pod` — disposable pod из RunPod template (см. LTX 2.3 как референс),
 * volume передаётся в spec на каждый запрос. SDK уже умеет multi-volume
 * failover при capacity-ошибках.
 *
 * `serverless` — для RunPod queue-based endpoint'ов (Fooocus и потенциальные
 * новые). Network volume у RunPod serverless привязан к endpoint'у в console,
 * не к request'у, — конфиг в нашей таблице описывает endpoint id, а связь
 * с volume хранится только для документирования / health-check'ов.
 */
export const runpodTemplateModeEnum = pgEnum("runpod_template_mode", [
	"pod",
	"serverless",
]);

/**
 * Каталог наших network volume'ов в RunPod. Это metadata над реальным
 * объектом, который оператор уже создал в RunPod console (мы не создаём
 * volume автоматически — это всё ещё ручная операция в UI RunPod). Поле
 * `runpodVolumeId` — то, что отдаёт RunPod GraphQL endpoint при создании.
 */
export const runpodNetworkVolume = pgTable(
	"runpod_network_volume",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		runpodVolumeId: text("runpod_volume_id").notNull(),
		datacenter: text("datacenter").notNull(),
		sizeGb: integer("size_gb").notNull().default(0),
		/**
		 * Список GPU type id, доступных в этом datacenter'е (например
		 * ["NVIDIA A40", "NVIDIA RTX A6000"]). Используется engine'ом
		 * чтобы выбрать совместимый GPU при создании pod'а с этим volume.
		 */
		gpuTypeIds: text("gpu_type_ids")
			.array()
			.notNull()
			.default(sql`ARRAY[]::text[]`),
		description: text("description").notNull().default(""),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("runpod_network_volume_name_uidx").on(table.name),
		uniqueIndex("runpod_network_volume_runpod_id_uidx").on(
			table.runpodVolumeId
		),
		index("runpod_network_volume_datacenter_idx").on(table.datacenter),
	]
);

/**
 * Конфигурация воспроизводимого RunPod inference target'а — pod-template
 * или serverless endpoint, который admin зарегистрировал в админке.
 *
 * Поле `workflowKey` отвечает за маппинг на runtime workflow в
 * `@generator/runpod` (см. `id` у `createLtx23VideoWorkflow` и
 * `createFooocusSdxlWorkflow`). Generator при старте читает все
 * включённые template'ы и регистрирует соответствующие workflows
 * с per-template конфигом (image, GPU priority, network volumes).
 */
export const runpodPodTemplate = pgTable(
	"runpod_pod_template",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		/** Какой runtime workflow в @generator/runpod это инстансит. */
		workflowKey: text("workflow_key").notNull(),
		mode: runpodTemplateModeEnum("mode").notNull().default("pod"),
		/** Для pod: RunPod template id (например "p4f6rm9tb4"). */
		runpodTemplateId: text("runpod_template_id"),
		/** Для serverless: RunPod queue endpoint id. */
		runpodEndpointId: text("runpod_endpoint_id"),
		/** Docker image для pod template — override если нужен другой билд. */
		imageName: text("image_name"),
		/**
		 * GPU priority — пробуем по порядку при capacity-ошибках. Только для
		 * pod-режима; для serverless RunPod сам решает.
		 */
		gpuTypeIds: text("gpu_type_ids")
			.array()
			.notNull()
			.default(sql`ARRAY[]::text[]`),
		/** Container disk в GB (только для pod). */
		containerDiskInGb: integer("container_disk_in_gb"),
		/** Mounted volume size в GB (только для pod). */
		volumeInGb: integer("volume_in_gb"),
		/** RunPod cloud type: "SECURE" | "COMMUNITY" (pod). */
		cloudType: text("cloud_type"),
		/** Сколько pod остаётся в warm pool после release (ms). */
		keepAliveMs: integer("keep_alive_ms"),
		/** Hard timeout pod-задачи (ms). */
		timeoutMs: integer("timeout_ms"),
		/**
		 * Произвольные env vars, которые pod-engine добавит к pod'у при
		 * запуске. Хранится как jsonb, чтобы не плодить колонки.
		 */
		defaultEnv: jsonb("default_env")
			.$type<Record<string, string>>()
			.notNull()
			.default({}),
		description: text("description").notNull().default(""),
		/**
		 * Включён ли template. Generator при старте читает только enabled,
		 * чтобы можно было быстро выключить без удаления.
		 */
		enabled: text("enabled").notNull().default("true"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("runpod_pod_template_name_uidx").on(table.name),
		index("runpod_pod_template_workflow_key_idx").on(table.workflowKey),
		index("runpod_pod_template_mode_idx").on(table.mode),
	]
);

/**
 * Join-таблица: какие volumes привязаны к pod-template'у и в каком порядке
 * приоритета. Engine идёт по priority asc; при capacity-ошибке падает на
 * следующий. Для serverless template'а тут обычно один volume (или ни одного),
 * для pod — список как раньше в `RUNPOD_LTX23_POD_NETWORK_VOLUMES`.
 */
export const runpodPodTemplateVolume = pgTable(
	"runpod_pod_template_volume",
	{
		podTemplateId: text("pod_template_id")
			.notNull()
			.references(() => runpodPodTemplate.id, { onDelete: "cascade" }),
		volumeId: text("volume_id")
			.notNull()
			.references(() => runpodNetworkVolume.id, { onDelete: "restrict" }),
		priority: integer("priority").notNull().default(0),
	},
	(table) => [
		primaryKey({ columns: [table.podTemplateId, table.volumeId] }),
		index("runpod_pod_template_volume_priority_idx").on(
			table.podTemplateId,
			table.priority
		),
	]
);

export const runpodPodTemplateRelations = relations(
	runpodPodTemplate,
	({ many }) => ({
		volumes: many(runpodPodTemplateVolume),
	})
);

export const runpodNetworkVolumeRelations = relations(
	runpodNetworkVolume,
	({ many }) => ({
		podTemplates: many(runpodPodTemplateVolume),
	})
);

export const runpodPodTemplateVolumeRelations = relations(
	runpodPodTemplateVolume,
	({ one }) => ({
		podTemplate: one(runpodPodTemplate, {
			fields: [runpodPodTemplateVolume.podTemplateId],
			references: [runpodPodTemplate.id],
		}),
		volume: one(runpodNetworkVolume, {
			fields: [runpodPodTemplateVolume.volumeId],
			references: [runpodNetworkVolume.id],
		}),
	})
);
