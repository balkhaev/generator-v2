import { describe, expect, it } from "bun:test";
import type { S3ListedObject } from "@generator/storage";

import { analyzeOrphanObjects } from "@/domain/storage-cleanup";

function createObject(input: {
	key: string;
	lastModified?: Date | null;
	sizeBytes?: number;
}): S3ListedObject {
	return {
		etag: null,
		key: input.key,
		lastModified:
			input.lastModified === undefined
				? new Date("2026-04-20T00:00:00.000Z")
				: input.lastModified,
		sizeBytes: input.sizeBytes ?? 100,
		type: "application/octet-stream",
		url: `https://assets.example.com/${input.key}`,
	};
}

describe("analyzeOrphanObjects", () => {
	it("keeps referenced, recent, and unknown-age objects out of orphan results", () => {
		const result = analyzeOrphanObjects({
			minimumAgeHours: 24,
			now: new Date("2026-04-22T00:00:00.000Z"),
			objects: [
				createObject({ key: "generator-artifacts/referenced.png" }),
				createObject({ key: "generator-artifacts/orphan.png", sizeBytes: 250 }),
				createObject({
					key: "studio-inputs/recent.png",
					lastModified: new Date("2026-04-21T12:30:00.000Z"),
				}),
				createObject({ key: "persons-inputs/unknown.png", lastModified: null }),
			],
			referencedKeys: new Set(["generator-artifacts/referenced.png"]),
		});

		expect(result.objects.map((object) => object.key)).toEqual([
			"generator-artifacts/orphan.png",
		]);
		expect(result.orphanSizeBytes).toBe(250);
		expect(result.protectedRecentCount).toBe(1);
		expect(result.unknownAgeCount).toBe(1);
	});
});
