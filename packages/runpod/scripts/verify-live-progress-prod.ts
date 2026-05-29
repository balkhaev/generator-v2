/* biome-ignore-all lint/suspicious/noConsole: prod verification script */
/**
 * Live prod check: real progress from ComfyUI → RunPod → generator.
 * Reads PROD_MCP_URL + PROD_MCP_TOKEN from repo root .env.local (never logged).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TRAILING_SLASH = /\/$/u;

function loadEnvLocal(): Record<string, string> {
	const path = resolve(import.meta.dir, "../../../.env.local");
	const text = readFileSync(path, "utf8");
	const out: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}
		const eq = trimmed.indexOf("=");
		if (eq <= 0) {
			continue;
		}
		out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
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
	const mcpEndpoint = base.includes("/mcp") ? base : `${base}/mcp`;
	const response = await fetch(mcpEndpoint, {
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

const submitPayload = {
	inputImageUrl:
		"https://hel1.your-objectstorage.com/generator/studio-inputs/smoke/sample.png",
	params: {
		cfgScale: 1,
		fps: 24,
		height: 512,
		loraCivitaiModelId: 2_509_189,
		loraCivitaiVersionId: 2_820_451,
		loraScale: 0.8,
		numFrames: 25,
		steps: 6,
		width: 512,
	},
	prompt:
		"woman walking on beach, cinematic motion, synth style test for progress tracking",
	workflowKey: "runpod-ltx-2-3-image-to-video",
};

console.log("submitting execution via prod MCP...");
const submitEnvelope = asRecord(
	await mcpCall(mcpUrl, mcpToken, "generator_execution_submit", submitPayload)
);
const submitted =
	asRecord(submitEnvelope?.body)?.execution ??
	submitEnvelope?.execution ??
	submitEnvelope;
function readExecutionId(
	record: Record<string, unknown> | null
): string | null {
	if (typeof record?.id === "string") {
		return record.id;
	}
	if (typeof record?.executionId === "string") {
		return record.executionId;
	}
	return null;
}

const executionId = readExecutionId(asRecord(submitted));
if (!executionId) {
	console.error("unexpected submit shape:", JSON.stringify(submitEnvelope));
	process.exit(1);
}
console.log("executionId:", executionId);

let sawRealProgress = false;
let sawLogLine = false;
const deadline = Date.now() + 15 * 60 * 1000;
let lastLine = "";

while (Date.now() < deadline) {
	await new Promise((r) => setTimeout(r, 8000));

	const pollEnvelope = asRecord(
		await mcpCall(mcpUrl, mcpToken, "service_request", {
			method: "GET",
			path: `/api/executions/${executionId}`,
			service: "generator",
		})
	);
	const row =
		asRecord(pollEnvelope?.body)?.execution ??
		pollEnvelope?.execution ??
		pollEnvelope;
	if (!row) {
		console.log("poll: empty response");
		continue;
	}
	const status = String(row?.status ?? "unknown");
	const progressPct = row?.progressPct;
	const lastLogLine = row?.lastLogLine;
	const etaMs = row?.etaMs;
	const phase = row?.phase;

	if (typeof progressPct === "number" && progressPct > 12) {
		sawRealProgress = true;
	}
	if (typeof lastLogLine === "string" && lastLogLine.length > 0) {
		sawLogLine = true;
	}

	const line = `${status} phase=${phase ?? "?"} progress=${progressPct ?? "?"}% eta=${etaMs ?? "?"}ms log=${lastLogLine ?? "-"}`;
	if (line !== lastLine) {
		console.log(line);
		lastLine = line;
	}

	if (status === "succeeded" || status === "failed") {
		const artifacts = row?.artifacts;
		console.log("terminal:", status);
		if (Array.isArray(artifacts)) {
			console.log("artifacts:", artifacts.length);
			for (const a of artifacts.slice(0, 2)) {
				const url = asRecord(a)?.url;
				if (typeof url === "string") {
					console.log(" artifact:", url.slice(0, 120));
				}
			}
		}
		if (status === "failed") {
			console.log("error:", row?.errorSummary ?? "unknown");
		}
		console.log(
			"checks:",
			`sawRealProgress=${sawRealProgress}`,
			`sawLogLine=${sawLogLine}`
		);
		process.exit(
			status === "succeeded" && sawRealProgress && sawLogLine ? 0 : 1
		);
	}
}

console.error("timeout waiting for terminal status");
process.exit(1);
