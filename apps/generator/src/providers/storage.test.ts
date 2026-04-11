import { describe, expect, it } from "bun:test";
import { createStorageAdapter } from "@/providers/storage";

describe("storage adapter", () => {
	it("preserves data urls for inline artifacts", () => {
		const adapter = createStorageAdapter({
			inputBaseUrl: "https://assets.example.com/input",
			outputBaseUrl: "https://assets.example.com/output",
		});

		const dataUrl =
			"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

		expect(adapter.normalizeOutputUrl(dataUrl)).toBe(dataUrl);
	});

	it("prefixes relative output paths with the configured base url", () => {
		const adapter = createStorageAdapter({
			inputBaseUrl: "https://assets.example.com/input",
			outputBaseUrl: "https://assets.example.com/output",
		});

		expect(adapter.normalizeOutputUrl("runs/demo/result.gif")).toBe(
			"https://assets.example.com/output/runs/demo/result.gif"
		);
	});
});
