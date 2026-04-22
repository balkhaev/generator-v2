import { describe, expect, it } from "bun:test";
import type { S3StorageConfig } from "./config";
import { listS3Objects, statS3Object } from "./objects";

const config: S3StorageConfig = {
	accessKeyId: "test",
	bucket: "generator",
	endpoint: "https://s3.example.com",
	publicBaseUrl: "https://assets.example.com/generator",
	region: "us-east-1",
	secretAccessKey: "secret",
};

function createFakeClient() {
	const client = {
		list() {
			return Promise.resolve({
				contents: [
					{
						etag: '"abc"',
						key: "generator-artifacts/run-1/00-result.png",
						lastModified: new Date("2026-01-01T00:00:00.000Z"),
						size: 1024,
						type: "image/png",
					},
				],
				isTruncated: true,
			});
		},
		stat(key: string) {
			return Promise.resolve({
				etag: '"def"',
				key,
				lastModified: "2026-01-02T00:00:00.000Z",
				size: 2048,
				type: "application/octet-stream",
			});
		},
	} as unknown as Bun.S3Client;
	return client;
}

describe("S3 object helpers", () => {
	it("normalizes list results and exposes a startAfter cursor", async () => {
		const result = await listS3Objects(
			{ maxKeys: 500, prefix: "generator-artifacts/" },
			config,
			createFakeClient()
		);

		expect(result.contents).toHaveLength(1);
		expect(result.contents[0]?.key).toBe(
			"generator-artifacts/run-1/00-result.png"
		);
		expect(result.contents[0]?.url).toBe(
			"https://assets.example.com/generator/generator-artifacts/run-1/00-result.png"
		);
		expect(result.nextStartAfter).toBe(
			"generator-artifacts/run-1/00-result.png"
		);
		expect(result.totalSizeBytes).toBe(1024);
	});

	it("normalizes object metadata", async () => {
		const stat = await statS3Object(
			"loras/model.safetensors",
			config,
			createFakeClient()
		);

		expect(stat.etag).toBe('"def"');
		expect(stat.sizeBytes).toBe(2048);
		expect(stat.lastModified?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
		expect(stat.url).toBe(
			"https://assets.example.com/generator/loras/model.safetensors"
		);
	});
});
