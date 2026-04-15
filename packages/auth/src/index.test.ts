import { describe, expect, it } from "bun:test";

import { deriveCrossSubdomainCookieDomain } from "./cookie-domain";

describe("deriveCrossSubdomainCookieDomain", () => {
	it("returns the parent domain for subdomain auth hosts", () => {
		expect(
			deriveCrossSubdomainCookieDomain("https://admin-api.gen.balkhaev.com")
		).toBe("gen.balkhaev.com");
	});

	it("returns null for localhost", () => {
		expect(
			deriveCrossSubdomainCookieDomain("http://localhost:3000")
		).toBeNull();
	});

	it("returns null for bare registrable domains", () => {
		expect(deriveCrossSubdomainCookieDomain("https://example.com")).toBeNull();
	});
});
