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
		expect(toolNames).toContain("studio_run_mark_failed");
	});

	it("returns public health without auth", async () => {
		const response = await app.request("/api/health");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, server: "mcp" });
	});
});
