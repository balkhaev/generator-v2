import { beforeEach, describe, expect, it } from "bun:test";
import type { LoraRegistryEntry } from "@generator/contracts/loras";
import type { S3StorageConfig } from "@generator/storage";
import { LoraRegistryService, slugify } from "@/domain/loras";
import type {
	CreateLoraRecordInput,
	ListLorasFilter,
	LoraRepository,
	UpdateLoraRecordInput,
} from "@/repositories/loras";

const fakeS3Config: S3StorageConfig = {
	accessKeyId: "ak",
	bucket: "test",
	endpoint: "https://s3.test",
	publicBaseUrl: "https://cdn.test",
	region: "us-east-1",
	secretAccessKey: "sk",
};

function createInMemoryRepo(): LoraRepository & {
	rows: Map<string, LoraRegistryEntry>;
} {
	const rows = new Map<string, LoraRegistryEntry>();

	function toEntry(input: CreateLoraRecordInput): LoraRegistryEntry {
		const now = new Date().toISOString();
		return {
			id: input.id,
			slug: input.slug,
			name: input.name,
			description: input.description,
			baseModel: input.baseModel,
			sourceUrl: input.sourceUrl,
			s3Key: input.s3Key,
			s3Url: input.s3Url,
			sizeBytes: input.sizeBytes,
			defaultWeight: input.defaultWeight,
			status: "active",
			createdAt: now,
			updatedAt: now,
		};
	}

	return {
		rows,
		create(input) {
			const entry = toEntry(input);
			rows.set(entry.id, entry);
			return Promise.resolve(entry);
		},
		delete(id) {
			const existing = rows.get(id) ?? null;
			if (existing) {
				rows.delete(id);
			}
			return Promise.resolve(existing);
		},
		getById(id) {
			return Promise.resolve(rows.get(id) ?? null);
		},
		getBySlug(slug) {
			for (const entry of rows.values()) {
				if (entry.slug === slug) {
					return Promise.resolve(entry);
				}
			}
			return Promise.resolve(null);
		},
		list(filter: ListLorasFilter) {
			const result = Array.from(rows.values()).filter((entry) => {
				if (filter.baseModel && entry.baseModel !== filter.baseModel) {
					return false;
				}
				if (filter.status && entry.status !== filter.status) {
					return false;
				}
				return true;
			});
			return Promise.resolve(result);
		},
		update(id, patch: UpdateLoraRecordInput) {
			const existing = rows.get(id);
			if (!existing) {
				return Promise.resolve(null);
			}
			const next: LoraRegistryEntry = {
				...existing,
				...(patch.name === undefined ? {} : { name: patch.name }),
				...(patch.description === undefined
					? {}
					: { description: patch.description }),
				...(patch.baseModel === undefined
					? {}
					: { baseModel: patch.baseModel }),
				...(patch.defaultWeight === undefined
					? {}
					: { defaultWeight: patch.defaultWeight }),
				...(patch.status === undefined ? {} : { status: patch.status }),
				updatedAt: new Date().toISOString(),
			};
			rows.set(id, next);
			return Promise.resolve(next);
		},
	};
}

describe("slugify", () => {
	it("converts to lowercase hyphenated slug", () => {
		expect(slugify("Hello World")).toBe("hello-world");
		expect(slugify("  ZIT / Mystic (xxx) ")).toBe("zit-mystic-xxx");
		expect(slugify("---foo---")).toBe("foo");
	});
});

describe("LoraRegistryService", () => {
	let repo: ReturnType<typeof createInMemoryRepo>;
	let service: LoraRegistryService;
	let cachedArgs: [
		string,
		unknown,
		{ headers?: Record<string, string> } | undefined,
	][];
	let idCounter: number;

	beforeEach(() => {
		repo = createInMemoryRepo();
		cachedArgs = [];
		idCounter = 0;
		service = new LoraRegistryService({
			repository: repo,
			s3Config: fakeS3Config,
			cacheLora: (sourceUrl, s3Config) => {
				cachedArgs.push([sourceUrl, s3Config, undefined]);
				return Promise.resolve({
					key: `loras/${sourceUrl.split("/").pop()}`,
					sizeBytes: 12_345,
					url: `https://cdn.test/loras/${sourceUrl.split("/").pop()}`,
				});
			},
			generateId: () => {
				idCounter += 1;
				return `lora-${idCounter}`;
			},
		});
	});

	it("creates a LoRA from URL and caches it to S3", async () => {
		const entry = await service.createFromUrl({
			name: "Mystic XXX",
			sourceUrl: "https://civitai.com/api/download/123/mystic.safetensors",
			baseModel: "z-image",
		});

		expect(entry.slug).toBe("mystic-xxx");
		expect(entry.baseModel).toBe("z-image");
		expect(entry.s3Key).toBe("loras/mystic.safetensors");
		expect(entry.s3Url).toBe("https://cdn.test/loras/mystic.safetensors");
		expect(entry.status).toBe("active");
		expect(entry.defaultWeight).toBe(1);
		expect(cachedArgs).toHaveLength(1);
	});

	it("resolves provider sources before caching", async () => {
		const headers = { authorization: "Bearer token" };
		service = new LoraRegistryService({
			repository: repo,
			s3Config: fakeS3Config,
			cacheLora: (sourceUrl, s3Config, options) => {
				cachedArgs.push([sourceUrl, s3Config, options]);
				return Promise.resolve({
					key: "loras/external/provider.safetensors",
					sizeBytes: 12_345,
					url: "https://cdn.test/loras/external/provider.safetensors",
				});
			},
			generateId: () => "lora-provider",
			resolveSource: () =>
				Promise.resolve({
					description: "Provider metadata",
					downloadHeaders: headers,
					downloadUrl: "https://civitai.com/api/download/models/123",
					name: "Provider LoRA",
					provider: "civitai",
					sourceUrl: "https://civitai.com/models/9?modelVersionId=123",
				}),
		});

		const entry = await service.createFromUrl({
			sourceUrl: "https://civitai.com/models/9?modelVersionId=123",
			baseModel: "flux",
		});

		expect(entry.name).toBe("Provider LoRA");
		expect(entry.description).toBe("Provider metadata");
		expect(entry.sourceUrl).toBe(
			"https://civitai.com/models/9?modelVersionId=123"
		);
		expect(cachedArgs[0]?.[0]).toBe(
			"https://civitai.com/api/download/models/123"
		);
		expect(cachedArgs[0]?.[2]?.headers).toBe(headers);
	});

	it("creates unique slugs on conflict", async () => {
		const first = await service.createFromUrl({
			name: "Same Name",
			sourceUrl: "https://example.com/a.safetensors",
			baseModel: "flux",
		});
		const second = await service.createFromUrl({
			name: "Same Name",
			sourceUrl: "https://example.com/b.safetensors",
			baseModel: "flux",
		});

		expect(first.slug).toBe("same-name");
		expect(second.slug).toBe("same-name-2");
	});

	it("rejects when name is empty", async () => {
		await expect(
			service.createFromUrl({
				name: "   ",
				sourceUrl: "https://example.com/a.safetensors",
				baseModel: "flux",
			})
		).rejects.toThrow("LoRA name is required");
	});

	it("lists only active entries by default", async () => {
		const entry = await service.createFromUrl({
			name: "Alpha",
			sourceUrl: "https://example.com/a.safetensors",
			baseModel: "z-image",
		});
		await service.archive(entry.id);
		await service.createFromUrl({
			name: "Beta",
			sourceUrl: "https://example.com/b.safetensors",
			baseModel: "z-image",
		});

		const active = await service.list();
		const all = await service.listAll();
		expect(active).toHaveLength(1);
		expect(active[0]?.name).toBe("Beta");
		expect(all).toHaveLength(2);
	});

	it("filters by baseModel", async () => {
		await service.createFromUrl({
			name: "Zed",
			sourceUrl: "https://example.com/z.safetensors",
			baseModel: "z-image",
		});
		await service.createFromUrl({
			name: "Flux",
			sourceUrl: "https://example.com/f.safetensors",
			baseModel: "flux",
		});

		const zImage = await service.list({ baseModel: "z-image" });
		expect(zImage).toHaveLength(1);
		expect(zImage[0]?.name).toBe("Zed");
	});

	it("archives and can be toggled back via update", async () => {
		const entry = await service.createFromUrl({
			name: "Toggler",
			sourceUrl: "https://example.com/t.safetensors",
			baseModel: "sdxl",
		});
		const archived = await service.archive(entry.id);
		expect(archived?.status).toBe("archived");
		const restored = await service.update(entry.id, { status: "active" });
		expect(restored?.status).toBe("active");
	});

	it("hard-deletes a LoRA", async () => {
		const entry = await service.createFromUrl({
			name: "Doomed",
			sourceUrl: "https://example.com/d.safetensors",
			baseModel: "z-image",
		});
		const removed = await service.delete(entry.id);
		expect(removed?.id).toBe(entry.id);
		expect(await service.getById(entry.id)).toBeNull();
		expect(await service.delete(entry.id)).toBeNull();
	});

	it("throws when s3 is not configured", async () => {
		const svc = new LoraRegistryService({ repository: repo });
		await expect(
			svc.createFromUrl({
				name: "NoS3",
				sourceUrl: "https://example.com/n.safetensors",
				baseModel: "flux",
			})
		).rejects.toThrow("S3 is not configured");
	});
});
