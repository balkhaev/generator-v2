import { describe, expect, it, mock } from "bun:test";

import { createArtifactPersister } from "./artifact-persister";
import type { S3ClientLike } from "./client";
import type { S3StorageConfig } from "./config";

const config: S3StorageConfig = {
	accessKeyId: "test",
	bucket: "generator",
	endpoint: "https://hel1.example.com",
	publicBaseUrl: "https://cdn.example.com/generator",
	region: "hel1",
	secretAccessKey: "test",
};

function createFakeClient() {
	const writes: Array<{ body: unknown; key: string }> = [];
	const client: S3ClientLike = {
		file() {
			throw new Error("not used");
		},
		write(key: string, body: unknown) {
			writes.push({ body, key });
			return Promise.resolve(0) as never;
		},
	};
	return { client, writes };
}

function createPngResponse(byteLength = 16) {
	const data = new Uint8Array(byteLength).fill(7);
	return new Response(data, {
		headers: { "content-type": "image/png" },
		status: 200,
	});
}

describe("createArtifactPersister", () => {
	it("returns data URLs unchanged", async () => {
		const { client } = createFakeClient();
		const persister = createArtifactPersister({ client, config });
		const dataUrl =
			"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

		const result = await persister.persistArtifactUrl({
			executionId: "exec-1",
			url: dataUrl,
		});

		expect(result).toBe(dataUrl);
	});

	it("returns owned-bucket URLs unchanged", async () => {
		const { client, writes } = createFakeClient();
		const persister = createArtifactPersister({ client, config });
		const ownedUrl = `${config.publicBaseUrl}/runs/abc/result.png`;

		const result = await persister.persistArtifactUrl({
			executionId: "exec-1",
			url: ownedUrl,
		});

		expect(result).toBe(ownedUrl);
		expect(writes).toHaveLength(0);
	});

	it("downloads remote artifacts and uploads them under a deterministic key", async () => {
		const { client, writes } = createFakeClient();
		const fetchImpl = mock(() => Promise.resolve(createPngResponse(32)));
		const persister = createArtifactPersister({
			client,
			config,
			downloadOptions: { attempts: 1, fetchImpl },
		});

		const externalUrl = "https://v3.fal.media/files/abc/result.png";
		const persistedFirst = await persister.persistArtifactUrl({
			executionId: "exec-42",
			index: 0,
			url: externalUrl,
		});
		const persistedSecond = await persister.persistArtifactUrl({
			executionId: "exec-42",
			index: 0,
			url: externalUrl,
		});

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(persistedFirst).toBe(persistedSecond);
		expect(persistedFirst.startsWith(`${config.publicBaseUrl}/`)).toBe(true);
		expect(persistedFirst.endsWith(".png")).toBe(true);
		expect(persistedFirst).toContain("/exec-42/00-");
		expect(writes).toHaveLength(2);
		expect(writes[0]?.key).toContain("exec-42/00-");
	});

	it("processes multiple artifact URLs in parallel keeping order", async () => {
		const { client } = createFakeClient();
		const fetchImpl = mock(() => Promise.resolve(createPngResponse(8)));
		const persister = createArtifactPersister({
			client,
			config,
			downloadOptions: { attempts: 1, fetchImpl },
		});

		const persisted = await persister.persistArtifactUrls({
			executionId: "exec-7",
			urls: [
				"https://v3.fal.media/files/a/img.png",
				`${config.publicBaseUrl}/already-here.png`,
				"https://v3.fal.media/files/b/img.png",
			],
		});

		expect(persisted).toHaveLength(3);
		expect(persisted[1]).toBe(`${config.publicBaseUrl}/already-here.png`);
		expect(persisted[0]).toContain("/exec-7/00-");
		expect(persisted[2]).toContain("/exec-7/02-");
	});

	it("propagates fetch failures so callers can mark the execution as failed", async () => {
		const { client } = createFakeClient();
		const fetchImpl = mock(() =>
			Promise.resolve(new Response("nope", { status: 503 }))
		);
		const persister = createArtifactPersister({
			client,
			config,
			downloadOptions: { attempts: 1, fetchImpl },
		});

		await expect(
			persister.persistArtifactUrl({
				executionId: "exec-fail",
				url: "https://v3.fal.media/files/missing.png",
			})
		).rejects.toThrow("Failed to download asset");
	});
});
