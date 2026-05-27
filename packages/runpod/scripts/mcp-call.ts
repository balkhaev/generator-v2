/* biome-ignore-all lint/suspicious/noConsole: dev script */
/**
 * Tiny CLI wrapper around the prod MCP HTTP endpoint so the agent can issue
 * `tools/call` requests without manually wrangling JSON-RPC + headers each
 * time. Reads creds from `.env.local` (PROD_MCP_URL, PROD_MCP_TOKEN).
 *
 * Usage:
 *   bun run packages/runpod/scripts/mcp-call.ts <toolName> '<jsonArgs>'
 *
 * Example:
 *   bun run packages/runpod/scripts/mcp-call.ts runpod_template_get '{"templateId":"esnxflkb5c"}'
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ENV_LINE_SPLITTER = /\r?\n/;

function loadEnv(): void {
	try {
		const raw = readFileSync(
			join(import.meta.dir, "../../../.env.local"),
			"utf-8"
		);
		for (const line of raw.split(ENV_LINE_SPLITTER)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) {
				continue;
			}
			const eq = trimmed.indexOf("=");
			if (eq === -1) {
				continue;
			}
			const k = trimmed.slice(0, eq);
			const v = trimmed.slice(eq + 1);
			if (!process.env[k]) {
				process.env[k] = v;
			}
		}
	} catch {
		// .env.local is optional — silently skip if absent or unreadable
	}
}

loadEnv();
const url = process.env.PROD_MCP_URL ?? "https://mcp.gen.balkhaev.com/mcp";
const token = process.env.PROD_MCP_TOKEN;
if (!token) {
	console.error("PROD_MCP_TOKEN missing (.env.local)");
	process.exit(2);
}

const toolName = process.argv[2];
const argsRaw = process.argv[3] ?? "{}";
if (!toolName) {
	console.error(
		"usage: mcp-call.ts <toolName> '<jsonArgs>'  (default args = {})"
	);
	process.exit(2);
}
let args: unknown;
try {
	args = JSON.parse(argsRaw);
} catch (e) {
	console.error("invalid JSON args:", e);
	process.exit(2);
}

const resp = await fetch(url, {
	body: JSON.stringify({
		id: Date.now(),
		jsonrpc: "2.0",
		method: "tools/call",
		params: { arguments: args, name: toolName },
	}),
	headers: {
		Accept: "application/json, text/event-stream",
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	},
	method: "POST",
});

const text = await resp.text();
if (!resp.ok) {
	console.error(`HTTP ${resp.status}: ${text}`);
	process.exit(1);
}

// MCP returns either application/json (full response) or text/event-stream
// (one or more `data: <json>\n\n` frames). Normalise to a single result.
let payload: unknown = null;
const ct = resp.headers.get("content-type") ?? "";
if (ct.includes("text/event-stream")) {
	const frames: unknown[] = [];
	for (const block of text.split(/\n\n+/)) {
		const line = block.trim();
		if (!line.startsWith("data:")) {
			continue;
		}
		const json = line.slice("data:".length).trim();
		if (!json) {
			continue;
		}
		try {
			frames.push(JSON.parse(json));
		} catch {
			// ignore non-JSON event lines (keepalive comments, etc.)
		}
	}
	payload = frames.at(-1) ?? frames;
} else {
	payload = JSON.parse(text);
}

const result = (payload as { result?: { content?: unknown } })?.result;
const content = result?.content;
if (Array.isArray(content)) {
	for (const item of content as Array<{ text?: string; type?: string }>) {
		if (item.type === "text" && item.text) {
			// Try to pretty-print embedded JSON, otherwise raw text
			try {
				const parsed = JSON.parse(item.text);
				console.log(JSON.stringify(parsed, null, 2));
			} catch {
				console.log(item.text);
			}
		} else {
			console.log(JSON.stringify(item, null, 2));
		}
	}
} else {
	console.log(JSON.stringify(payload, null, 2));
}
