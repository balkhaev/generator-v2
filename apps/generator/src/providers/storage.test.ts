import { describe, expect, it } from "bun:test";
import type { S3StorageConfig } from "@generator/storage";

import {
	createProviderArtifactDownloadOptions,
	createStorageAdapter,
} from "@/providers/storage";

const trustedStorageErrorPattern = /must be hosted in trusted S3 storage/u;
const unsupportedSchemeErrorPattern = /must use http\(s\) or data: scheme/u;

const config: S3StorageConfig = {
	accessKeyId: "test",
	bucket: "generator",
	endpoint: "https://hel1.example.com",
	publicBaseUrl: "https://cdn.example.com/generator",
	region: "hel1",
	secretAccessKey: "test",
};

function createTestAdapter() {
	const writes: Array<{ body: unknown; key: string }> = [];
	const adapter = createStorageAdapter({
		artifactPersister: {
			isOwnedAssetUrl(url) {
				return url.startsWith(`${config.publicBaseUrl}/`);
			},
			persistArtifactUrl({ url }) {
				if (url.startsWith("data:") || url.startsWith(config.publicBaseUrl)) {
					return Promise.resolve(url);
				}
				const persisted = `${config.publicBaseUrl}/persisted/${encodeURIComponent(url)}`;
				writes.push({ body: url, key: persisted });
				return Promise.resolve(persisted);
			},
			persistArtifactUrls({ urls }) {
				return Promise.all(
					urls.map((url) => this.persistArtifactUrl({ executionId: "x", url }))
				);
			},
		},
		config,
	});
	return { adapter, writes };
}

describe("storage adapter", () => {
	it("accepts data URLs as input image", () => {
		const { adapter } = createTestAdapter();
		const dataUrl = "data:image/svg+xml;base64,abc";
		expect(adapter.normalizeInputImageUrl(dataUrl)).toBe(dataUrl);
	});

	it("accepts owned-bucket URLs as input image", () => {
		const { adapter } = createTestAdapter();
		const owned = `${config.publicBaseUrl}/studio-inputs/foo.png`;
		expect(adapter.normalizeInputImageUrl(owned)).toBe(owned);
	});

	it("accepts sibling bucket URLs from the configured storage endpoint", () => {
		const { adapter } = createTestAdapter();
		const sibling =
			"https://hel1.example.com/adorely/tenants/default/gallery/uploaded/source.png";
		expect(adapter.normalizeInputImageUrl(sibling)).toBe(sibling);
	});

	it("rejects external HTTP(S) input image URLs", () => {
		const { adapter } = createTestAdapter();
		expect(() =>
			adapter.normalizeInputImageUrl("https://v3.fal.media/files/abc.png")
		).toThrow(trustedStorageErrorPattern);
	});

	it("rejects unsupported schemes", () => {
		const { adapter } = createTestAdapter();
		expect(() =>
			adapter.normalizeInputImageUrl("ftp://example.com/x.png")
		).toThrow(unsupportedSchemeErrorPattern);
	});

	it("delegates artifact persistence to the persister", async () => {
		const { adapter } = createTestAdapter();
		const persisted = await adapter.persistArtifactUrls({
			executionId: "exec-1",
			urls: [
				"https://v3.fal.media/files/a.png",
				`${config.publicBaseUrl}/already-here.png`,
			],
		});
		expect(persisted).toHaveLength(2);
		expect(persisted[0]).toContain(`${config.publicBaseUrl}/persisted/`);
		expect(persisted[1]).toBe(`${config.publicBaseUrl}/already-here.png`);
	});

	it("scopes Replicate download auth headers to replicate.delivery", () => {
		const options = createProviderArtifactDownloadOptions({
			replicateApiToken: "r8_test",
		});

		expect(options?.headers).toBeTypeOf("function");
		if (typeof options?.headers !== "function") {
			throw new Error("expected dynamic headers");
		}
		expect(options.headers("https://replicate.delivery/pbxt/out.png")).toEqual({
			authorization: "Bearer r8_test",
		});
		expect(
			options.headers("https://sub.replicate.delivery/pbxt/out.png")
		).toEqual({
			authorization: "Bearer r8_test",
		});
		expect(
			options.headers("https://v3.fal.media/files/out.png")
		).toBeUndefined();
	});
});
