import { beforeEach, describe, expect, it } from "bun:test";
import type { LoraRegistryEntry } from "@generator/contracts/loras";
import type { S3StorageConfig } from "@generator/storage";
import {
	LoraRegistryService,
	normalizeTriggerWords,
	slugify,
} from "@/domain/loras";
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
			triggerWords: input.triggerWords ?? [],
			variant: input.variant ?? null,
			pairGroupId: input.pairGroupId ?? null,
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
		createMany(inputs) {
			const created = inputs.map((input) => {
				const entry = toEntry(input);
				rows.set(entry.id, entry);
				return entry;
			});
			return Promise.resolve(created);
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
		getByPairGroupId(pairGroupId) {
			const result = Array.from(rows.values()).filter(
				(entry) => entry.pairGroupId === pairGroupId
			);
			return Promise.resolve(result);
		},
		getByS3Urls(urls) {
			const set = new Set(urls);
			const result = Array.from(rows.values()).filter((entry) =>
				set.has(entry.s3Url)
			);
			return Promise.resolve(result);
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
				...(patch.triggerWords === undefined
					? {}
					: { triggerWords: patch.triggerWords }),
				...(patch.variant === undefined ? {} : { variant: patch.variant }),
				...(patch.pairGroupId === undefined
					? {}
					: { pairGroupId: patch.pairGroupId }),
				updatedAt: new Date().toISOString(),
			};
			rows.set(id, next);
			return Promise.resolve(next);
		},
	};
}

function expectSingle(
	value: LoraRegistryEntry | LoraRegistryEntry[]
): LoraRegistryEntry {
	if (Array.isArray(value)) {
		throw new Error("Expected single LoRA entry, received an array.");
	}
	return value;
}

function expectMany(
	value: LoraRegistryEntry | LoraRegistryEntry[]
): LoraRegistryEntry[] {
	if (!Array.isArray(value)) {
		throw new Error("Expected multiple LoRA entries, received a single one.");
	}
	return value;
}

describe("slugify", () => {
	it("converts to lowercase hyphenated slug", () => {
		expect(slugify("Hello World")).toBe("hello-world");
		expect(slugify("  ZIT / Mystic (xxx) ")).toBe("zit-mystic-xxx");
		expect(slugify("---foo---")).toBe("foo");
	});
});

describe("normalizeTriggerWords", () => {
	it("trims, drops empties and de-duplicates case-insensitively", () => {
		expect(
			normalizeTriggerWords([
				"  mystic ",
				"Mystic",
				"",
				"   ",
				"neon city",
				"NEON CITY",
			])
		).toEqual(["mystic", "neon city"]);
	});

	it("returns empty array on undefined input", () => {
		expect(normalizeTriggerWords(undefined)).toEqual([]);
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
		const entry = expectSingle(
			await service.createFromUrl({
				name: "Mystic XXX",
				sourceUrl: "https://civitai.com/api/download/123/mystic.safetensors",
				baseModel: "z-image",
			})
		);

		expect(entry.slug).toBe("mystic-xxx");
		expect(entry.baseModel).toBe("z-image");
		expect(entry.s3Key).toBe("loras/mystic.safetensors");
		expect(entry.s3Url).toBe("https://cdn.test/loras/mystic.safetensors");
		expect(entry.status).toBe("active");
		expect(entry.defaultWeight).toBe(1);
		expect(entry.variant).toBeNull();
		expect(entry.pairGroupId).toBeNull();
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

		const entry = expectSingle(
			await service.createFromUrl({
				sourceUrl: "https://civitai.com/models/9?modelVersionId=123",
				baseModel: "flux",
			})
		);

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
		const first = expectSingle(
			await service.createFromUrl({
				name: "Same Name",
				sourceUrl: "https://example.com/a.safetensors",
				baseModel: "flux",
			})
		);
		const second = expectSingle(
			await service.createFromUrl({
				name: "Same Name",
				sourceUrl: "https://example.com/b.safetensors",
				baseModel: "flux",
			})
		);

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
		const entry = expectSingle(
			await service.createFromUrl({
				name: "Alpha",
				sourceUrl: "https://example.com/a.safetensors",
				baseModel: "z-image",
			})
		);
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
		const entry = expectSingle(
			await service.createFromUrl({
				name: "Toggler",
				sourceUrl: "https://example.com/t.safetensors",
				baseModel: "sdxl",
			})
		);
		const archived = await service.archive(entry.id);
		expect(archived?.status).toBe("archived");
		const restored = await service.update(entry.id, { status: "active" });
		expect(restored?.status).toBe("active");
	});

	it("hard-deletes a LoRA", async () => {
		const entry = expectSingle(
			await service.createFromUrl({
				name: "Doomed",
				sourceUrl: "https://example.com/d.safetensors",
				baseModel: "z-image",
			})
		);
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

	it("defaults variant to 'both' for dual-expert single imports", async () => {
		const entry = expectSingle(
			await service.createFromUrl({
				name: "Wan Solo",
				sourceUrl: "https://example.com/wan-solo.safetensors",
				baseModel: "wan-2-2",
			})
		);
		expect(entry.variant).toBe("both");
		expect(entry.pairGroupId).toBeNull();
	});

	it("appends a noise suffix when variant is high/low for a single import", async () => {
		const entry = expectSingle(
			await service.createFromUrl({
				name: "Sky LoRA",
				sourceUrl: "https://example.com/sky-high.safetensors",
				baseModel: "wan-2-2",
				variant: "high",
			})
		);
		expect(entry.name).toBe("Sky LoRA (High Noise)");
		expect(entry.variant).toBe("high");
	});

	it("creates a high+low pair sharing the same pairGroupId", async () => {
		const created = expectMany(
			await service.createFromUrl({
				name: "Cinematic Look",
				sourceUrl: "https://example.com/look-high.safetensors",
				baseModel: "wan-2-2",
				variant: "high",
				pair: {
					sourceUrl: "https://example.com/look-low.safetensors",
					variant: "low",
				},
			})
		);
		expect(created).toHaveLength(2);
		const [primary, secondary] = created;
		expect(primary?.variant).toBe("high");
		expect(secondary?.variant).toBe("low");
		expect(primary?.pairGroupId).toBeTruthy();
		expect(primary?.pairGroupId).toBe(secondary?.pairGroupId);
		expect(primary?.name).toBe("Cinematic Look (High Noise)");
		expect(secondary?.name).toBe("Cinematic Look (Low Noise)");
		expect(primary?.slug).not.toBe(secondary?.slug);
		expect(cachedArgs).toHaveLength(2);

		if (primary) {
			const paired = await service.getPairedLora(primary);
			expect(paired?.id).toBe(secondary?.id ?? "");
		}
	});

	it("rejects pair import for non dual-expert base models", async () => {
		await expect(
			service.createFromUrl({
				name: "Flux Pair",
				sourceUrl: "https://example.com/flux-high.safetensors",
				baseModel: "flux",
				variant: "high",
				pair: {
					sourceUrl: "https://example.com/flux-low.safetensors",
					variant: "low",
				},
			})
		).rejects.toThrow("dual-expert");
	});

	it("rejects pair import when both entries share the same variant", async () => {
		await expect(
			service.createFromUrl({
				name: "Bad Pair",
				sourceUrl: "https://example.com/bad-high.safetensors",
				baseModel: "wan-2-2",
				variant: "high",
				pair: {
					sourceUrl: "https://example.com/bad-high-2.safetensors",
					variant: "high",
				},
			})
		).rejects.toThrow("different variants");
	});

	it("persists trainedWords from the resolved source as triggerWords", async () => {
		service = new LoraRegistryService({
			repository: repo,
			s3Config: fakeS3Config,
			cacheLora: () =>
				Promise.resolve({
					key: "loras/civitai-mystic.safetensors",
					sizeBytes: 12_345,
					url: "https://cdn.test/loras/civitai-mystic.safetensors",
				}),
			generateId: () => "lora-civitai",
			resolveSource: () =>
				Promise.resolve({
					description: "Provider notes",
					downloadUrl: "https://civitai.com/api/download/123",
					name: "Mystic",
					provider: "civitai",
					sourceUrl: "https://civitai.com/models/9?modelVersionId=123",
					trainedWords: ["mystic", "Mystic", " neon "],
				}),
		});

		const entry = expectSingle(
			await service.createFromUrl({
				sourceUrl: "https://civitai.com/models/9?modelVersionId=123",
				baseModel: "flux",
			})
		);

		expect(entry.triggerWords).toEqual(["mystic", "neon"]);
	});

	it("respects an explicit triggerWords override on createFromUrl", async () => {
		const entry = expectSingle(
			await service.createFromUrl({
				name: "Override",
				sourceUrl: "https://example.com/override.safetensors",
				baseModel: "flux",
				triggerWords: ["alpha", "alpha", "  beta "],
			})
		);
		expect(entry.triggerWords).toEqual(["alpha", "beta"]);
	});

	it("normalizes triggerWords on update", async () => {
		const entry = expectSingle(
			await service.createFromUrl({
				name: "Editable",
				sourceUrl: "https://example.com/editable.safetensors",
				baseModel: "flux",
			})
		);
		const updated = await service.update(entry.id, {
			triggerWords: ["foo", "Foo", "  bar  ", ""],
		});
		expect(updated?.triggerWords).toEqual(["foo", "bar"]);
	});

	it("returns null from getPairedLora when entry is not part of a pair", async () => {
		const solo = expectSingle(
			await service.createFromUrl({
				name: "Solo",
				sourceUrl: "https://example.com/solo.safetensors",
				baseModel: "z-image",
			})
		);
		expect(await service.getPairedLora(solo)).toBeNull();
	});
});
