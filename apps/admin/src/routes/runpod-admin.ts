import type {
	CreateRunpodNetworkVolumeInput,
	CreateRunpodPodTemplateInput,
	ListRunpodPodTemplatesQuery,
	PodTemplateVolumeAssignment,
	RunpodTemplateMode,
	UpdateRunpodNetworkVolumeInput,
	UpdateRunpodPodTemplateInput,
} from "@generator/contracts/runpod-admin";
import { RUNPOD_TEMPLATE_MODES } from "@generator/contracts/runpod-admin";
import { Hono } from "hono";

import type { RunpodAdminService } from "@/domain/runpod-admin";
import { toErrorResponse } from "@/routes/utils";

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asOptionalString(value: unknown): string | undefined | null {
	if (value === null) {
		return null;
	}
	return typeof value === "string" ? value : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return;
	}
	const rounded = Math.trunc(value);
	return rounded > 0 ? rounded : undefined;
}

function asNonNegativeInt(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return;
	}
	const rounded = Math.trunc(value);
	return rounded >= 0 ? rounded : undefined;
}

function asNullablePositiveInt(value: unknown): number | undefined | null {
	if (value === null) {
		return null;
	}
	return asPositiveInt(value);
}

function asNullableNonNegativeInt(value: unknown): number | undefined | null {
	if (value === null) {
		return null;
	}
	return asNonNegativeInt(value);
}

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return;
	}
	return value.filter((item): item is string => typeof item === "string");
}

function asTemplateMode(value: unknown): RunpodTemplateMode {
	if (
		typeof value === "string" &&
		RUNPOD_TEMPLATE_MODES.includes(value as RunpodTemplateMode)
	) {
		return value as RunpodTemplateMode;
	}
	throw new Error(`mode must be one of: ${RUNPOD_TEMPLATE_MODES.join(", ")}`);
}

function asDefaultEnv(value: unknown): Record<string, string> | undefined {
	if (!value || typeof value !== "object") {
		return;
	}
	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (typeof key !== "string") {
			continue;
		}
		if (typeof raw === "string") {
			out[key] = raw;
		} else if (raw !== null && raw !== undefined) {
			out[key] = String(raw);
		}
	}
	return out;
}

function asVolumeAssignments(
	value: unknown
): PodTemplateVolumeAssignment[] | undefined {
	if (!Array.isArray(value)) {
		return;
	}
	const seen = new Set<string>();
	const out: PodTemplateVolumeAssignment[] = [];
	let nextPriority = 0;
	for (const raw of value) {
		if (!raw || typeof raw !== "object") {
			continue;
		}
		const entry = raw as Record<string, unknown>;
		const volumeId = asString(entry.volumeId);
		if (!volumeId || seen.has(volumeId)) {
			continue;
		}
		seen.add(volumeId);
		const priorityCandidate =
			typeof entry.priority === "number" ? entry.priority : nextPriority;
		out.push({
			priority: Number.isFinite(priorityCandidate)
				? Math.trunc(priorityCandidate)
				: nextPriority,
			volumeId,
		});
		nextPriority += 1;
	}
	return out;
}

function parseCreateVolume(body: unknown): CreateRunpodNetworkVolumeInput {
	if (!body || typeof body !== "object") {
		throw new Error("Invalid request body");
	}
	const payload = body as Record<string, unknown>;
	const name = asString(payload.name);
	const runpodVolumeId = asString(payload.runpodVolumeId);
	const datacenter = asString(payload.datacenter);
	if (!(name && runpodVolumeId && datacenter)) {
		throw new Error("name, runpodVolumeId and datacenter are required");
	}
	return {
		datacenter,
		description: asString(payload.description),
		gpuTypeIds: asStringArray(payload.gpuTypeIds),
		name,
		runpodVolumeId,
		sizeGb: asNonNegativeInt(payload.sizeGb),
	};
}

function parseUpdateVolume(body: unknown): UpdateRunpodNetworkVolumeInput {
	if (!body || typeof body !== "object") {
		throw new Error("Invalid request body");
	}
	const payload = body as Record<string, unknown>;
	return {
		datacenter: asString(payload.datacenter),
		description: asString(payload.description),
		gpuTypeIds: asStringArray(payload.gpuTypeIds),
		name: asString(payload.name),
		runpodVolumeId: asString(payload.runpodVolumeId),
		sizeGb: asNonNegativeInt(payload.sizeGb),
	};
}

function parseCreatePodTemplate(body: unknown): CreateRunpodPodTemplateInput {
	if (!body || typeof body !== "object") {
		throw new Error("Invalid request body");
	}
	const payload = body as Record<string, unknown>;
	const name = asString(payload.name);
	const workflowKey = asString(payload.workflowKey);
	const mode = asTemplateMode(payload.mode);
	if (!(name && workflowKey)) {
		throw new Error("name and workflowKey are required");
	}
	return {
		cloudType: asString(payload.cloudType),
		containerDiskInGb: asPositiveInt(payload.containerDiskInGb),
		defaultEnv: asDefaultEnv(payload.defaultEnv),
		description: asString(payload.description),
		enabled: typeof payload.enabled === "boolean" ? payload.enabled : undefined,
		gpuTypeIds: asStringArray(payload.gpuTypeIds),
		imageName: asString(payload.imageName),
		keepAliveMs: asNonNegativeInt(payload.keepAliveMs),
		mode,
		name,
		runpodEndpointId: asString(payload.runpodEndpointId),
		runpodTemplateId: asString(payload.runpodTemplateId),
		timeoutMs: asPositiveInt(payload.timeoutMs),
		volumeInGb: asPositiveInt(payload.volumeInGb),
		volumes: asVolumeAssignments(payload.volumes),
		workflowKey,
	};
}

function parseUpdatePodTemplate(body: unknown): UpdateRunpodPodTemplateInput {
	if (!body || typeof body !== "object") {
		throw new Error("Invalid request body");
	}
	const payload = body as Record<string, unknown>;
	return {
		cloudType: asOptionalString(payload.cloudType),
		containerDiskInGb: asNullablePositiveInt(payload.containerDiskInGb),
		defaultEnv: asDefaultEnv(payload.defaultEnv),
		description: asString(payload.description),
		enabled: typeof payload.enabled === "boolean" ? payload.enabled : undefined,
		gpuTypeIds: asStringArray(payload.gpuTypeIds),
		imageName: asOptionalString(payload.imageName),
		keepAliveMs: asNullableNonNegativeInt(payload.keepAliveMs),
		name: asString(payload.name),
		runpodEndpointId: asOptionalString(payload.runpodEndpointId),
		runpodTemplateId: asOptionalString(payload.runpodTemplateId),
		timeoutMs: asNullablePositiveInt(payload.timeoutMs),
		volumeInGb: asNullablePositiveInt(payload.volumeInGb),
		volumes: asVolumeAssignments(payload.volumes),
		workflowKey: asString(payload.workflowKey),
	};
}

function parseEnabledQuery(value: string | undefined): boolean | undefined {
	if (value === "true") {
		return true;
	}
	if (value === "false") {
		return false;
	}
	return;
}

function parseListPodTemplatesQuery(c: {
	req: { query(key: string): string | undefined };
}): ListRunpodPodTemplatesQuery {
	const modeRaw = c.req.query("mode");
	return {
		enabled: parseEnabledQuery(c.req.query("enabled")),
		mode:
			modeRaw && RUNPOD_TEMPLATE_MODES.includes(modeRaw as RunpodTemplateMode)
				? (modeRaw as RunpodTemplateMode)
				: undefined,
		workflowKey: c.req.query("workflowKey") || undefined,
	};
}

export function createRunpodAdminRoutes(service: RunpodAdminService) {
	const app = new Hono();

	app.get("/volumes", async (c) => {
		const volumes = await service.listVolumes();
		return c.json({ volumes });
	});

	app.post("/volumes", async (c) => {
		try {
			const input = parseCreateVolume(await c.req.json());
			const volume = await service.createVolume(input);
			return c.json({ volume }, 201);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.get("/volumes/:id", async (c) => {
		const volume = await service.getVolume(c.req.param("id"));
		return volume
			? c.json({ volume })
			: c.json({ error: "Volume not found" }, 404);
	});

	app.patch("/volumes/:id", async (c) => {
		try {
			const patch = parseUpdateVolume(await c.req.json());
			const volume = await service.updateVolume(c.req.param("id"), patch);
			return volume
				? c.json({ volume })
				: c.json({ error: "Volume not found" }, 404);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.delete("/volumes/:id", async (c) => {
		try {
			const volume = await service.deleteVolume(c.req.param("id"));
			return volume
				? c.json({ volume })
				: c.json({ error: "Volume not found" }, 404);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.get("/pod-templates", async (c) => {
		const templates = await service.listPodTemplates(
			parseListPodTemplatesQuery(c)
		);
		return c.json({ templates });
	});

	app.post("/pod-templates", async (c) => {
		try {
			const input = parseCreatePodTemplate(await c.req.json());
			const template = await service.createPodTemplate(input);
			return c.json({ template }, 201);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.get("/pod-templates/:id", async (c) => {
		const template = await service.getPodTemplate(c.req.param("id"));
		return template
			? c.json({ template })
			: c.json({ error: "Pod template not found" }, 404);
	});

	app.patch("/pod-templates/:id", async (c) => {
		try {
			const patch = parseUpdatePodTemplate(await c.req.json());
			const template = await service.updatePodTemplate(
				c.req.param("id"),
				patch
			);
			return template
				? c.json({ template })
				: c.json({ error: "Pod template not found" }, 404);
		} catch (error) {
			const response = toErrorResponse(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.delete("/pod-templates/:id", async (c) => {
		const template = await service.deletePodTemplate(c.req.param("id"));
		return template
			? c.json({ template })
			: c.json({ error: "Pod template not found" }, 404);
	});

	return app;
}
