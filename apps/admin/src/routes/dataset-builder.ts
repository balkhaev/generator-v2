import type { DatasetBuilderSettings as DatasetBuilderSettingsSnapshot } from "@generator/contracts/admin";
import { Hono } from "hono";
import { z } from "zod";

import type { DatasetBuilderSettings } from "@/domain/dataset-builder-settings";
import {
	DATASET_EDITOR_MODEL_DESCRIPTORS,
	isKnownDatasetEditorModelId,
} from "@/providers/dataset-editor-models";
import {
	DEFAULT_DATASET_POLL_MS,
	DEFAULT_DATASET_TIMEOUT_MS,
	IDENTITY_NEGATIVE_PROMPT,
} from "@/providers/lora-dataset-builder";

const putBodySchema = z.object({
	model: z.string().trim().min(1).refine(isKnownDatasetEditorModelId, {
		message: "Unknown dataset editor model id",
	}),
});

async function buildSnapshot(deps: {
	settings: DatasetBuilderSettings;
}): Promise<DatasetBuilderSettingsSnapshot> {
	const model = await deps.settings.getEditorModelId();
	return {
		availableModels: DATASET_EDITOR_MODEL_DESCRIPTORS.map((d) => ({
			description: d.description,
			id: d.id,
			label: d.label,
			supportsNegativePrompt: d.supportsNegativePrompt,
		})),
		model,
		negativePromptPreview: IDENTITY_NEGATIVE_PROMPT,
		note: "Editor model для генерации синтетических вариаций референса. Меняется без рестарта воркера — применится к следующему job-у.",
		pollMs: DEFAULT_DATASET_POLL_MS,
		timeoutMs: DEFAULT_DATASET_TIMEOUT_MS,
	};
}

export function createDatasetBuilderRoutes(deps: {
	settings: DatasetBuilderSettings;
}) {
	const app = new Hono();

	app.get("/", async (c) => c.json(await buildSnapshot(deps)));

	app.put("/", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		const parsed = putBodySchema.safeParse(body);
		if (!parsed.success) {
			return c.json(
				{ error: parsed.error.issues[0]?.message ?? "Invalid request" },
				400
			);
		}

		await deps.settings.setEditorModelId(parsed.data.model);
		return c.json(await buildSnapshot(deps));
	});

	return app;
}
