import { spawn } from "node:child_process";
import {
	collectServiceHealth,
	fetchServiceSnapshot,
	getAdminDebugHeaders,
	getDefaultServiceNames,
	getStudioDebugHeaders,
	getWorkspaceRoot,
} from "./shared";

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

const decoder = new TextDecoder();
const contentLengthPattern = /Content-Length:\s*(\d+)/iu;
let readBuffer = Buffer.alloc(0);
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
		description:
			"Check health for local backends through their public health endpoints.",
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
			"Read the authenticated admin dashboard snapshot from the admin gateway.",
		inputSchema: {
			properties: {},
			type: "object",
		},
		name: "admin_dashboard_get",
	},
	{
		description:
			"Read the authenticated studio snapshot from the studio backend.",
		inputSchema: {
			properties: {},
			type: "object",
		},
		name: "studio_snapshot_get",
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
		description:
			"Submit a generator execution directly to the generator api for debugging.",
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
		description:
			"Sync an existing generator execution against the provider for debugging.",
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
			"Collect a timestamped debug bundle under .artifacts/debug-bundles.",
		inputSchema: {
			properties: {
				includeDashboard: {
					type: "boolean",
				},
				includeStudioSnapshot: {
					type: "boolean",
				},
				outputDir: {
					type: "string",
				},
			},
			type: "object",
		},
		name: "collect_debug_bundle",
	},
] as const;

function writeMessage(payload: JsonRpcResponse) {
	const body = JSON.stringify(payload);
	process.stdout.write(
		`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`
	);
}

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

function ok(id: JsonRpcResponse["id"], result: unknown) {
	writeMessage({
		id,
		jsonrpc: "2.0",
		result,
	});
}

function fail(id: JsonRpcResponse["id"], message: string) {
	writeMessage({
		error: {
			code: -32_000,
			message,
		},
		id,
		jsonrpc: "2.0",
	});
}

async function runBundle(args: {
	includeDashboard?: boolean;
	includeStudioSnapshot?: boolean;
	outputDir?: string;
}) {
	const commandArgs = ["packages/debug-tools/src/collect-debug-bundle.ts"];

	if (args.includeDashboard) {
		commandArgs.push("--include-dashboard");
	}
	if (args.includeStudioSnapshot) {
		commandArgs.push("--include-studio-snapshot");
	}
	if (args.outputDir) {
		commandArgs.push(`--output-dir=${args.outputDir}`);
	}

	const child = spawn("bun", commandArgs, {
		cwd: getWorkspaceRoot(),
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	});

	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];

	child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
	child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

	const exitCode = await new Promise<number>((resolve, reject) => {
		child.on("error", reject);
		child.on("close", (code) => resolve(code ?? 0));
	});

	const output = Buffer.concat(stdout).toString("utf8");
	return {
		exitCode,
		ok: exitCode === 0,
		stderr: Buffer.concat(stderr).toString("utf8"),
		summary: output.length > 0 ? (JSON.parse(output) as unknown) : null,
	};
}

function postJson(service: "generator", path: string, payload: unknown) {
	return fetchServiceSnapshot(service, path, {
		body: JSON.stringify(payload),
		headers: {
			"content-type": "application/json",
		},
		method: "POST",
	});
}

function parseStringArray(value: unknown) {
	if (!Array.isArray(value)) {
		return undefined;
	}

	return value.filter((entry): entry is string => typeof entry === "string");
}

function parseOptionalString(value: unknown) {
	return typeof value === "string" ? value : undefined;
}

function handleInitialize(message: JsonRpcRequest) {
	ok(message.id ?? null, {
		capabilities: {
			tools: {
				listChanged: false,
			},
		},
		protocolVersion: "2024-11-05",
		serverInfo: {
			name: "@generator/debug-tools",
			version: "0.0.0",
		},
	});
}

function handleToolsList(message: JsonRpcRequest) {
	ok(message.id ?? null, {
		tools: toolDefinitions,
	});
}

type ToolHandler = (
	message: JsonRpcRequest,
	argumentsPayload: Record<string, unknown>
) => Promise<void> | void;

const toolHandlers: Record<string, ToolHandler> = {
	admin_dashboard_get: async (message) => {
		ok(
			message.id ?? null,
			createToolResult(
				await fetchServiceSnapshot("admin", "/api/dashboard", {
					headers: getAdminDebugHeaders(),
				})
			)
		);
	},
	collect_debug_bundle: async (message, argumentsPayload) => {
		ok(
			message.id ?? null,
			createToolResult(
				await runBundle({
					includeDashboard: argumentsPayload.includeDashboard === true,
					includeStudioSnapshot:
						argumentsPayload.includeStudioSnapshot === true,
					outputDir: parseOptionalString(argumentsPayload.outputDir),
				})
			)
		);
	},
	generator_execution_submit: async (message, argumentsPayload) => {
		ok(
			message.id ?? null,
			createToolResult(
				await postJson("generator", "/api/executions", argumentsPayload)
			)
		);
	},
	generator_execution_sync: async (message, argumentsPayload) => {
		ok(
			message.id ?? null,
			createToolResult(
				await postJson("generator", "/api/executions/sync", argumentsPayload)
			)
		);
	},
	generator_workflows_get: async (message) => {
		ok(
			message.id ?? null,
			createToolResult(
				await fetchServiceSnapshot("generator", "/api/workflows")
			)
		);
	},
	service_health: async (message, argumentsPayload) => {
		ok(
			message.id ?? null,
			createToolResult(
				await collectServiceHealth(parseStringArray(argumentsPayload.services))
			)
		);
	},
	studio_snapshot_get: async (message) => {
		ok(
			message.id ?? null,
			createToolResult(
				await fetchServiceSnapshot("studio", "/api/studio-snapshot", {
					headers: getStudioDebugHeaders(),
				})
			)
		);
	},
	workspace_summary: (message) => {
		ok(
			message.id ?? null,
			createToolResult({
				defaultServices: getDefaultServiceNames(),
				workspaceRoot: getWorkspaceRoot(),
			})
		);
	},
};

async function handleToolCall(message: JsonRpcRequest) {
	const name = parseOptionalString(message.params?.name);
	const argumentsPayload =
		(message.params?.arguments as Record<string, unknown> | undefined) ?? {};

	if (!name) {
		fail(message.id ?? null, "Tool name is required");
		return;
	}

	const handler = toolHandlers[name];
	if (!handler) {
		fail(message.id ?? null, `Unknown tool: ${name}`);
		return;
	}

	await handler(message, argumentsPayload);
}

async function handleRequest(message: JsonRpcRequest) {
	switch (message.method) {
		case "initialize":
			handleInitialize(message);
			return;
		case "notifications/initialized":
		case "initialized":
			return;
		case "ping":
			ok(message.id ?? null, {});
			return;
		case "tools/list":
			handleToolsList(message);
			return;
		case "tools/call":
			await handleToolCall(message);
			return;
		default:
			fail(message.id ?? null, `Unsupported method: ${message.method}`);
	}
}

function readNextMessage() {
	const separator = readBuffer.indexOf("\r\n\r\n");
	if (separator === -1) {
		return null;
	}

	const headerText = decoder.decode(readBuffer.subarray(0, separator));
	const contentLengthMatch = headerText.match(contentLengthPattern);
	if (!contentLengthMatch) {
		throw new Error("Missing Content-Length header");
	}

	const contentLength = Number.parseInt(contentLengthMatch[1] ?? "0", 10);
	const messageStart = separator + 4;
	const messageEnd = messageStart + contentLength;
	if (readBuffer.length < messageEnd) {
		return null;
	}

	const payloadBuffer = readBuffer.subarray(messageStart, messageEnd);
	readBuffer = readBuffer.subarray(messageEnd);
	return JSON.parse(decoder.decode(payloadBuffer)) as JsonRpcRequest;
}

process.stdin.on("data", async (chunk: Buffer) => {
	readBuffer = Buffer.concat([readBuffer, chunk]);

	try {
		while (true) {
			const message = readNextMessage();
			if (!message) {
				break;
			}
			await handleRequest(message);
		}
	} catch (error) {
		fail(null, error instanceof Error ? error.message : "Invalid MCP payload");
	}
});

process.stdin.on("end", () => {
	process.exit(0);
});
