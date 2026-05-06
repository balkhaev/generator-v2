import { describe, expect, it, mock } from "bun:test";

import { createComfyUIClient } from "./client";

const LOGIN_FAILED_PATTERN = /comfyui \/login failed/u;

interface MockHandlerArgs {
	body?: unknown;
	init?: RequestInit;
	url: string;
}

interface MockHandler {
	body?: unknown;
	headers?: Record<string, string>;
	match: (args: MockHandlerArgs) => boolean;
	status?: number;
	text?: string;
}

function mockFetch(handlers: MockHandler[]) {
	const calls: MockHandlerArgs[] = [];
	const impl = mock((url: string, init?: RequestInit): Promise<Response> => {
		let body: unknown;
		const rawBody = init?.body;
		if (typeof rawBody === "string") {
			body = rawBody;
		} else if (rawBody instanceof URLSearchParams) {
			body = Object.fromEntries(rawBody.entries());
		} else if (rawBody instanceof FormData) {
			body = Object.fromEntries(
				[...rawBody.entries()].map(([k, v]) => [
					k,
					typeof v === "string"
						? v
						: `Blob(${(v as { size?: number }).size ?? 0})`,
				])
			);
		} else {
			body = rawBody;
		}
		const args: MockHandlerArgs = { body, init, url };
		calls.push(args);
		const handler = handlers.find((h) => h.match(args));
		if (!handler) {
			throw new Error(`No mock handler for ${init?.method ?? "GET"} ${url}`);
		}
		const responseInit: ResponseInit = {
			headers: handler.headers,
			status: handler.status ?? 200,
		};
		if (handler.body !== undefined) {
			return Promise.resolve(
				new Response(JSON.stringify(handler.body), {
					...responseInit,
					headers: {
						"content-type": "application/json",
						...(handler.headers ?? {}),
					},
				})
			);
		}
		return Promise.resolve(new Response(handler.text ?? "", responseInit));
	});
	return { calls, impl };
}

describe("ComfyUIClient", () => {
	it("logs in via /login and stores AIOHTTP_SESSION cookie", async () => {
		const { calls, impl } = mockFetch([
			{
				headers: {
					"set-cookie":
						'AIOHTTP_SESSION="abc123token=="; HttpOnly; Path=/; Secure',
				},
				match: ({ url }) => url.endsWith("/login"),
				status: 302,
				text: "302: Found",
			},
			{
				body: {
					devices: [
						{
							index: 0,
							name: "RTX A5000",
							type: "cuda",
							vram_free: 1,
							vram_total: 2,
						},
					],
					system: { os: "linux", ram_free: 1, ram_total: 2 },
				},
				match: ({ url }) => url.endsWith("/system_stats"),
			},
		]);

		const client = createComfyUIClient({
			baseUrl: "https://podid-8188.proxy.runpod.net/",
			fetchImpl: impl as unknown as typeof fetch,
			password: "p4ss",
			username: "agent",
		});

		const stats = await client.getSystemStats();
		expect(stats.system.os).toBe("linux");

		const loginCall = calls[0];
		expect(loginCall?.url).toBe("https://podid-8188.proxy.runpod.net/login");
		expect(loginCall?.body).toEqual({
			guest_mode: "",
			password: "p4ss",
			username: "agent",
		});

		const statsCall = calls[1];
		expect(statsCall?.url).toBe(
			"https://podid-8188.proxy.runpod.net/system_stats"
		);
		const cookie = (statsCall?.init?.headers as Headers).get("cookie");
		expect(cookie).toBe("AIOHTTP_SESSION=abc123token==");
	});

	it("submits a prompt with API graph and returns prompt_id", async () => {
		const { calls, impl } = mockFetch([
			{
				headers: { "set-cookie": "AIOHTTP_SESSION=token; Path=/" },
				match: ({ url }) => url.endsWith("/login"),
				status: 302,
			},
			{
				body: { number: 1, prompt_id: "p-1" },
				match: ({ url, init }) =>
					url.endsWith("/prompt") && init?.method === "POST",
			},
		]);

		const client = createComfyUIClient({
			baseUrl: "https://pod.proxy.runpod.net",
			fetchImpl: impl as unknown as typeof fetch,
			password: "x",
			username: "u",
		});

		const result = await client.submitPrompt({
			clientId: "client-1",
			prompt: {
				"1": { class_type: "UNETLoader", inputs: { unet_name: "x.bin" } },
			},
		});
		expect(result.prompt_id).toBe("p-1");
		const promptBody = JSON.parse(calls[1]?.body as string);
		expect(promptBody).toMatchObject({
			client_id: "client-1",
			prompt: { "1": { class_type: "UNETLoader" } },
		});
	});

	it("starts a Lora download with civitai model+version ids", async () => {
		const { calls, impl } = mockFetch([
			{
				headers: { "set-cookie": "AIOHTTP_SESSION=t; Path=/" },
				match: ({ url }) => url.endsWith("/login"),
				status: 302,
			},
			{
				body: { ok: true },
				match: ({ url }) => url.endsWith("/api/lm/download-model"),
			},
		]);
		const client = createComfyUIClient({
			baseUrl: "https://pod.proxy.runpod.net",
			fetchImpl: impl as unknown as typeof fetch,
			password: "x",
			username: "u",
		});

		await client.startLoraDownload({
			downloadId: "dl-1",
			modelId: 2_509_189,
			modelVersionId: 2_841_299,
		});
		const dlBody = JSON.parse(calls[1]?.body as string);
		expect(dlBody).toMatchObject({
			download_id: "dl-1",
			model_id: 2_509_189,
			model_root: "loras",
			model_version_id: 2_841_299,
			use_default_paths: false,
		});
	});

	it("polls Lora download progress and unwraps {downloads:[]} shape", async () => {
		const { impl } = mockFetch([
			{
				headers: { "set-cookie": "AIOHTTP_SESSION=t; Path=/" },
				match: ({ url }) => url.endsWith("/login"),
				status: 302,
			},
			{
				body: {
					downloads: [
						{
							bytes_downloaded: 50,
							bytes_total: 100,
							download_id: "dl-1",
							progress: 0.5,
							status: "downloading",
						},
					],
				},
				match: ({ url }) => url.includes("/api/lm/download-progress"),
			},
		]);
		const client = createComfyUIClient({
			baseUrl: "https://pod.proxy.runpod.net",
			fetchImpl: impl as unknown as typeof fetch,
			password: "x",
			username: "u",
		});
		const progress = await client.pollLoraDownload("dl-1");
		expect(progress.progress).toBe(0.5);
		expect(progress.status).toBe("downloading");
	});

	it("downloads artifact bytes via /view", async () => {
		const fakeBytes = new Uint8Array([1, 2, 3, 4]);
		const { calls, impl } = mockFetch([
			{
				headers: { "set-cookie": "AIOHTTP_SESSION=t; Path=/" },
				match: ({ url }) => url.endsWith("/login"),
				status: 302,
			},
			{
				match: ({ url }) => url.includes("/view"),
				status: 200,
				text: "ignored", // overridden below
			},
		]);
		// override the second handler to return raw bytes
		impl.mockImplementationOnce(() =>
			Promise.resolve(
				new Response("", {
					headers: { "set-cookie": "AIOHTTP_SESSION=t; Path=/" },
					status: 302,
				})
			)
		);
		impl.mockImplementationOnce((url: string) => {
			expect(url).toContain("filename=output.mp4");
			expect(url).toContain("type=output");
			return Promise.resolve(new Response(fakeBytes, { status: 200 }));
		});

		const client = createComfyUIClient({
			baseUrl: "https://pod.proxy.runpod.net",
			fetchImpl: impl as unknown as typeof fetch,
			password: "x",
			username: "u",
		});

		const buf = await client.downloadArtifact({
			filename: "output.mp4",
			subfolder: "",
			type: "output",
		});
		expect(new Uint8Array(buf)).toEqual(fakeBytes);
		expect(calls).toHaveLength(0); // we replaced fetch, so handlers list isn't populated; just sanity check on no extra calls
	});

	it("throws on non-302 login response", async () => {
		const { impl } = mockFetch([
			{
				body: { error: "wrong password" },
				match: ({ url }) => url.endsWith("/login"),
				status: 401,
			},
		]);
		const client = createComfyUIClient({
			baseUrl: "https://pod.proxy.runpod.net",
			fetchImpl: impl as unknown as typeof fetch,
			password: "x",
			username: "u",
		});
		await expect(client.login()).rejects.toThrow(LOGIN_FAILED_PATTERN);
	});

	it("returns null history entry when prompt_id missing", async () => {
		const { impl } = mockFetch([
			{
				headers: { "set-cookie": "AIOHTTP_SESSION=t; Path=/" },
				match: ({ url }) => url.endsWith("/login"),
				status: 302,
			},
			{
				body: {},
				match: ({ url }) => url.includes("/history/"),
			},
		]);
		const client = createComfyUIClient({
			baseUrl: "https://pod.proxy.runpod.net",
			fetchImpl: impl as unknown as typeof fetch,
			password: "x",
			username: "u",
		});
		const entry = await client.getHistoryEntry("p-missing");
		expect(entry).toBeNull();
	});
});
