import {
	collectServiceHealth,
	fetchServiceSnapshot,
	getDefaultServiceNames,
	getWorkspaceRoot,
	type ServiceName,
} from "@generator/debug-tools/shared";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";

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

function postJson(path: string, payload: unknown) {
	return fetchServiceSnapshot("generator", path, {
		body: JSON.stringify(payload),
		headers: {
			"content-type": "application/json",
		},
		method: "POST",
	});
}

async function handleToolCall(message: JsonRpcRequest) {
	const name = parseOptionalString(message.params?.name);
	const argumentsPayload =
		(message.params?.arguments as Record<string, unknown> | undefined) ?? {};
	const id = message.id ?? null;

	if (!name) {
		return createErrorResponse(id, "Tool name is required");
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
		case "generator_execution_submit":
			return createOkResponse(
				id,
				createToolResult(await postJson("/api/executions", argumentsPayload))
			);
		case "generator_execution_sync":
			return createOkResponse(
				id,
				createToolResult(
					await postJson("/api/executions/sync", argumentsPayload)
				)
			);
		case "test_user_upsert":
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
		case "test_user_get":
			return createOkResponse(
				id,
				createToolResult(
					await getTestUser({
						email: parseOptionalString(argumentsPayload.email),
						userId: parseOptionalString(argumentsPayload.userId),
					})
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
