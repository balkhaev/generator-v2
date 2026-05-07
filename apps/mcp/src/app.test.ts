import { describe, expect, it } from "bun:test";

import { createApp } from "@/app";

describe("mcp app", () => {
	const token = "test-token";
	const app = createApp({ authToken: token });

	it("rejects unauthenticated MCP requests", async () => {
		const response = await app.request("/mcp", {
			body: JSON.stringify({
				id: 1,
				jsonrpc: "2.0",
				method: "tools/list",
			}),
			method: "POST",
		});

		expect(response.status).toBe(401);
	});

	it("lists MCP tools for authenticated requests", async () => {
		const response = await app.request("/mcp", {
			body: JSON.stringify({
				id: 1,
				jsonrpc: "2.0",
				method: "tools/list",
			}),
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			method: "POST",
		});

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			result: {
				tools: Array<{ name: string }>;
			};
		};
		const toolNames = payload.result.tools.map((tool) => tool.name);
		expect(toolNames).toContain("service_request");
		expect(toolNames).toContain("kafka_cluster_info");
		expect(toolNames).toContain("kafka_topic_sample");
		expect(toolNames).toContain("test_user_upsert");
		expect(toolNames).toContain("test_user_get");
		expect(toolNames).toContain("lora_list");
		expect(toolNames).toContain("lora_get");
		expect(toolNames).toContain("persons_reupload_adorely_assets");
		expect(toolNames).toContain("persons_lora_generation_debug");
		expect(toolNames).toContain("studio_execution_debug");
		expect(toolNames).toContain("studio_run_mark_failed");
		expect(toolNames).toContain("studio_scenario_update");
		expect(toolNames).toContain("admin_lora_training_queue_snapshot");
	});

	it("validates studio scenario update arguments", async () => {
		const noScenario = await app.request("/mcp", {
			body: JSON.stringify({
				id: 1,
				jsonrpc: "2.0",
				method: "tools/call",
				params: {
					arguments: {},
					name: "studio_scenario_update",
				},
			}),
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			method: "POST",
		});
		expect(noScenario.status).toBe(200);
		const noScenarioPayload = (await noScenario.json()) as {
			error?: { message: string };
		};
		expect(noScenarioPayload.error?.message).toBe("scenarioId is required");

		const noFields = await app.request("/mcp", {
			body: JSON.stringify({
				id: 2,
				jsonrpc: "2.0",
				method: "tools/call",
				params: {
					arguments: { scenarioId: "scenario-1" },
					name: "studio_scenario_update",
				},
			}),
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			method: "POST",
		});
		expect(noFields.status).toBe(200);
		const noFieldsPayload = (await noFields.json()) as {
			error?: { message: string };
		};
		expect(noFieldsPayload.error?.message).toBe(
			"at least one of name/prompt/params/workflowKey must be provided"
		);
	});

	it("validates lora generation debug target before touching data sources", async () => {
		const response = await app.request("/mcp", {
			body: JSON.stringify({
				id: 1,
				jsonrpc: "2.0",
				method: "tools/call",
				params: {
					arguments: {},
					name: "persons_lora_generation_debug",
				},
			}),
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			method: "POST",
		});

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			error?: { message: string };
		};
		expect(payload.error?.message).toBe("personId or personSlug is required");
	});

	it("validates studio execution debug target before touching data sources", async () => {
		const response = await app.request("/mcp", {
			body: JSON.stringify({
				id: 1,
				jsonrpc: "2.0",
				method: "tools/call",
				params: {
					arguments: {},
					name: "studio_execution_debug",
				},
			}),
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
			},
			method: "POST",
		});

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			error?: { message: string };
		};
		expect(payload.error?.message).toBe(
			"scenarioId, runId, executionId, or providerJobId is required"
		);
	});

	it("returns public health without auth", async () => {
		const response = await app.request("/api/health");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, server: "mcp" });
	});
});
