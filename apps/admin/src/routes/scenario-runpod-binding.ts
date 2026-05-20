import { Hono } from "hono";

import {
	createNoopRunpodRegistryReloadBus,
	type RunpodRegistryReloadBus,
} from "@/domain/runpod-registry-reload-bus";
import type { ScenarioRunpodBindingRepository } from "@/repositories/scenario-runpod-binding";
import { toErrorResponse } from "@/routes/utils";

function parsePatchBody(body: unknown): { podTemplateId: string | null } {
	if (!body || typeof body !== "object") {
		throw new Error("Invalid request body");
	}
	const payload = body as Record<string, unknown>;
	if (payload.podTemplateId === null) {
		return { podTemplateId: null };
	}
	if (typeof payload.podTemplateId === "string") {
		const trimmed = payload.podTemplateId.trim();
		if (trimmed.length === 0) {
			return { podTemplateId: null };
		}
		return { podTemplateId: trimmed };
	}
	throw new Error("podTemplateId must be string or null");
}

/**
 * Admin route для привязки Studio-сценария к admin-managed RunPod pod
 * template'у. Поле живёт в `studio_scenario.runpodPodTemplateId`, но Studio
 * UI его не редактирует — это чисто административная настройка маршрутизации
 * (какой endpoint / volume использовать для этого сценария).
 *
 * Generator при выборе провайдера для execution смотрит на это поле в
 * первую очередь; если null — fallback на env-defaults.
 */
export interface ScenarioRunpodBindingRoutesOptions {
	reloadBus?: RunpodRegistryReloadBus;
	repository: ScenarioRunpodBindingRepository;
}

export function createScenarioRunpodBindingRoutes(
	optionsOrRepository:
		| ScenarioRunpodBindingRepository
		| ScenarioRunpodBindingRoutesOptions
) {
	const { repository, reloadBus } =
		"repository" in optionsOrRepository
			? optionsOrRepository
			: { reloadBus: undefined, repository: optionsOrRepository };
	const bus = reloadBus ?? createNoopRunpodRegistryReloadBus();
	const app = new Hono();

	app.get("/", async (c) => {
		const bindings = await repository.listBindings();
		return c.json({ bindings });
	});

	app.get("/:scenarioId", async (c) => {
		const binding = await repository.get(c.req.param("scenarioId"));
		return binding
			? c.json({ binding })
			: c.json({ error: "Scenario not found" }, 404);
	});

	app.patch("/:scenarioId", async (c) => {
		try {
			const patch = parsePatchBody(await c.req.json());
			const scenarioId = c.req.param("scenarioId");
			const binding = await repository.setBinding(
				scenarioId,
				patch.podTemplateId
			);
			if (!binding) {
				return c.json({ error: "Scenario not found" }, 404);
			}
			await bus.publish("scenario-binding-updated", {
				resourceId: scenarioId,
			});
			return c.json({ binding });
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	return app;
}
