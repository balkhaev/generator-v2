/* biome-ignore-all lint/suspicious/noConsole: prod verification script */
/**
 * One-shot / loop poll of a generator execution via prod MCP studio_execution_debug
 * (reads generatorExecution row directly from prod DB, no HTTP auth needed).
 * Reads PROD_MCP_URL + PROD_MCP_TOKEN from repo root .env.local.
 *
 * Usage: bun poll-execution-prod.ts <executionId> [loopSeconds]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TRAILING_SLASH = /\/$/u;

function loadEnvLocal(): Record<string, string> {
	const path = resolve(import.meta.dir, "../../../.env.local");
	const out: Record<string, string> = {};
	for (const line of readFileSync(path, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const eq = trimmed.indexOf("=");
		if (eq > 0) {
			out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
		}
	}
	return out;
}

async function mcpCall(
	baseUrl: string,
	token: string,
	toolName: string,
	argumentsPayload: Record<string, unknown>
): Promise<unknown> {
	const base = baseUrl.replace(TRAILING_SLASH, "");
	const endpoint = base.includes("/mcp") ? base : `${base}/mcp`;
	const response = await fetch(endpoint, {
		body: JSON.stringify({
			id: 1,
			jsonrpc: "2.0",
			method: "tools/call",
			params: { arguments: argumentsPayload, name: toolName },
		}),
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(`MCP HTTP ${response.status}: ${await response.text()}`);
	}
	const envelope = (await response.json()) as {
		error?: { message: string };
		result?: { content?: Array<{ text?: string }> };
	};
	if (envelope.error) {
		throw new Error(envelope.error.message);
	}
	const text = envelope.result?.content?.[0]?.text;
	if (!text) {
		throw new Error("MCP empty tool result");
	}
	return JSON.parse(text) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

const env = loadEnvLocal();
const mcpUrl = env.PROD_MCP_URL;
const mcpToken = env.PROD_MCP_TOKEN;
if (!(mcpUrl && mcpToken)) {
	console.error("PROD_MCP_URL and PROD_MCP_TOKEN required in .env.local");
	process.exit(1);
}

const executionId = process.argv[2];
if (!executionId) {
	console.error(
		"usage: bun poll-execution-prod.ts <executionId> [loopSeconds]"
	);
	process.exit(1);
}
const loopSeconds = Number(process.argv[3] ?? "0");

let sawRealProgress = false;
let lastLine = "";
const deadline = Date.now() + 15 * 60 * 1000;

async function pollOnce(): Promise<string> {
	const result = asRecord(
		await mcpCall(mcpUrl, mcpToken, "studio_execution_debug", {
			executionId,
		})
	);
	const executions = Array.isArray(result?.executions) ? result.executions : [];
	const row = asRecord(executions[0]);
	if (!row) {
		return "no-row";
	}
	const status = String(row.status ?? "?");
	const progressPct = row.progressPct;
	const lastLogLine = row.lastLogLine ?? "(field-not-exposed)";
	const providerJobId = row.providerJobId ?? "-";
	if (typeof progressPct === "number" && progressPct > 12) {
		sawRealProgress = true;
	}
	const artifacts = Array.isArray(row.artifacts) ? row.artifacts.length : 0;
	return `${status} progress=${progressPct ?? "?"}% job=${providerJobId} artifacts=${artifacts} log=${lastLogLine}`;
}

if (loopSeconds <= 0) {
	console.log(await pollOnce());
	process.exit(0);
}

while (Date.now() < deadline) {
	const line = await pollOnce();
	if (line !== lastLine) {
		console.log(`[${new Date().toISOString()}] ${line}`);
		lastLine = line;
	}
	if (line.startsWith("succeeded") || line.startsWith("failed")) {
		console.log(`checks: sawRealProgress=${sawRealProgress}`);
		process.exit(line.startsWith("succeeded") ? 0 : 1);
	}
	await new Promise((r) => setTimeout(r, loopSeconds * 1000));
}
console.error("timeout");
process.exit(1);
