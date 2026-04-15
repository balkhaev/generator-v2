import { createApp } from "@/app";

const authToken = process.env.MCP_AUTH_TOKEN;

if (!authToken) {
	throw new Error("MCP_AUTH_TOKEN is required");
}

const app = createApp({ authToken });

export default {
	port: Number(process.env.PORT ?? 3010),
	fetch: app.fetch,
};
