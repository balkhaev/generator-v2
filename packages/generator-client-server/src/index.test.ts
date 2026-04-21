import { describe, expect, it } from "bun:test";

import { createGeneratorExecutionClient } from "./index";

describe("generator execution client", () => {
	it("includes JSON error details in failed requests", async () => {
		const client = createGeneratorExecutionClient(
			"https://generator.test",
			() =>
				Promise.resolve(
					new Response(
						JSON.stringify({ error: "Input image URL is invalid" }),
						{
							headers: {
								"content-type": "application/json",
							},
							status: 500,
							statusText: "Internal Server Error",
						}
					)
				)
		);

		await expect(
			client.createExecution({
				prompt: "Generate a clip",
				workflowKey: "fal-wan-2-2-image-to-video",
			})
		).rejects.toThrow("500 Internal Server Error: Input image URL is invalid");
	});
});
