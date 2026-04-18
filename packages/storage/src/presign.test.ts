import { describe, expect, it } from "bun:test";

import { createPresignedPutUrl } from "./presign";

const HEX_64_PATTERN = /^[0-9a-f]{64}$/;

const config = {
	accessKeyId: "AKIA-test",
	bucket: "lora-bucket",
	endpoint: "https://s3.example.com",
	publicBaseUrl: "https://assets.example.com",
	region: "us-east-1",
	secretAccessKey: "secret",
};

describe("createPresignedPutUrl", () => {
	it("produces a SigV4 query-string-signed URL with required parameters", async () => {
		const url = await createPresignedPutUrl(
			{
				contentType: "application/octet-stream",
				expiresInSeconds: 3600,
				key: "loras/runpod-pod/test.safetensors",
			},
			config
		);

		const parsed = new URL(url);

		expect(parsed.origin).toBe("https://s3.example.com");
		expect(parsed.pathname).toBe(
			"/lora-bucket/loras/runpod-pod/test.safetensors"
		);
		expect(parsed.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
		expect(parsed.searchParams.get("X-Amz-Credential")).toContain("AKIA-test/");
		expect(parsed.searchParams.get("X-Amz-Credential")).toContain(
			"/us-east-1/s3/aws4_request"
		);
		expect(parsed.searchParams.get("X-Amz-Expires")).toBe("3600");
		expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toBe(
			"content-type;host"
		);
		expect(parsed.searchParams.get("X-Amz-Signature")).toMatch(HEX_64_PATTERN);
	});

	it("omits content-type from signed headers when not provided", async () => {
		const url = await createPresignedPutUrl(
			{ expiresInSeconds: 600, key: "x/y.bin" },
			config
		);
		const parsed = new URL(url);
		expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
	});

	it("encodes special characters in keys", async () => {
		const url = await createPresignedPutUrl(
			{ expiresInSeconds: 60, key: "loras/run pod/тест.safetensors" },
			config
		);
		const parsed = new URL(url);
		expect(parsed.pathname).toContain("/lora-bucket/");
		expect(parsed.pathname).toContain("run%20pod");
	});
});
