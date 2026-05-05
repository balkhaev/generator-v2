import type {
	AdminWorkflowDetailResponse,
	AdminWorkflowListResponse,
	AdminWorkflowSummary,
} from "@generator/contracts/admin";
import type { WorkflowSummary } from "@generator/contracts/generator";
import type {
	DomainName,
	StudioWorkflowSettings,
} from "@generator/runtime-config/domains";
import type { RuntimeConfigStore } from "@generator/runtime-config/store";
import {
	getWorkflowExpectedDurationMs,
	listWorkflows,
} from "@generator/workflows";
import { Hono } from "hono";
import { z } from "zod";

const WORKFLOW_SETTINGS_DOMAIN = "studio-workflows" satisfies DomainName;

const updateWorkflowBody = z.object({
	active: z.boolean(),
});

export interface WorkflowAdminRoutesDeps {
	publishInvalidation(domain: DomainName): Promise<void>;
	store: RuntimeConfigStore;
}

function uniqueSorted(values: Iterable<string>): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

async function readInactiveWorkflowKeys(
	deps?: WorkflowAdminRoutesDeps
): Promise<string[]> {
	if (!deps) {
		return [];
	}
	const snapshot = await deps.store.getSnapshot(WORKFLOW_SETTINGS_DOMAIN);
	const settings = snapshot.settings as StudioWorkflowSettings;
	return uniqueSorted(settings.inactiveWorkflowKeys);
}

function toAdminWorkflowSummary(
	workflow: WorkflowSummary,
	inactiveWorkflowKeys: ReadonlySet<string>
): AdminWorkflowSummary {
	const active = !inactiveWorkflowKeys.has(workflow.key);
	return {
		...workflow,
		active,
		expectedDurationMs: getWorkflowExpectedDurationMs(workflow.key),
	};
}

async function buildListResponse(
	deps?: WorkflowAdminRoutesDeps
): Promise<AdminWorkflowListResponse> {
	const inactiveWorkflowKeys = await readInactiveWorkflowKeys(deps);
	const inactive = new Set(inactiveWorkflowKeys);
	return {
		inactiveWorkflowKeys,
		workflows: listWorkflows().map((workflow) =>
			toAdminWorkflowSummary(workflow, inactive)
		),
	};
}

export function createWorkflowAdminRoutes(deps?: WorkflowAdminRoutesDeps) {
	const app = new Hono();

	app.get("/", async (c) => c.json(await buildListResponse(deps)));

	app.get("/:workflowKey", async (c) => {
		const workflowKey = c.req.param("workflowKey");
		const response = await buildListResponse(deps);
		const workflow = response.workflows.find(
			(item) => item.key === workflowKey
		);
		if (!workflow) {
			return c.json({ error: "Workflow not found" }, 404);
		}
		return c.json({
			inactiveWorkflowKeys: response.inactiveWorkflowKeys,
			workflow,
		} satisfies AdminWorkflowDetailResponse);
	});

	app.patch("/:workflowKey", async (c) => {
		if (!deps) {
			return c.json({ error: "Runtime config is not enabled" }, 503);
		}

		const workflowKey = c.req.param("workflowKey");
		const workflowExists = listWorkflows().some(
			(workflow) => workflow.key === workflowKey
		);
		if (!workflowExists) {
			return c.json({ error: "Workflow not found" }, 404);
		}

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		const parsed = updateWorkflowBody.safeParse(body);
		if (!parsed.success) {
			return c.json(
				{ error: parsed.error.issues[0]?.message ?? "Invalid request" },
				400
			);
		}

		const inactive = new Set(await readInactiveWorkflowKeys(deps));
		if (parsed.data.active) {
			inactive.delete(workflowKey);
		} else {
			inactive.add(workflowKey);
		}

		await deps.store.setSetting(
			WORKFLOW_SETTINGS_DOMAIN,
			"inactiveWorkflowKeys",
			uniqueSorted(inactive)
		);
		await deps.publishInvalidation(WORKFLOW_SETTINGS_DOMAIN);

		const response = await buildListResponse(deps);
		const workflow = response.workflows.find(
			(item) => item.key === workflowKey
		);
		if (!workflow) {
			return c.json({ error: "Workflow not found" }, 404);
		}
		return c.json({
			inactiveWorkflowKeys: response.inactiveWorkflowKeys,
			workflow,
		} satisfies AdminWorkflowDetailResponse);
	});

	return app;
}
