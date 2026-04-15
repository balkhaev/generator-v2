import { describe, expect, it } from "bun:test";

import { createPublicPathMatcher } from "./public-paths";

describe("createPublicPathMatcher", () => {
	it("matches exact paths and prefixes", () => {
		const isPublicPath = createPublicPathMatcher({
			exact: ["/api/health", "/api/setup/status"],
			prefixes: ["/api/auth/", "/api/internal/"],
		});

		expect(isPublicPath("/api/health")).toBe(true);
		expect(isPublicPath("/api/setup/status")).toBe(true);
		expect(isPublicPath("/api/auth/get-session")).toBe(true);
		expect(isPublicPath("/api/internal/sync")).toBe(true);
		expect(isPublicPath("/api/persons")).toBe(false);
	});
});
