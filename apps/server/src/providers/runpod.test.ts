import { describe, expect, it, mock } from "bun:test";

import {
  createRunpodClient,
  normalizeRunpodError,
  normalizeRunpodStatus,
} from "@/providers/runpod";

describe("runpod provider", () => {
  it("normalizes request and status payloads", async () => {
    const fetchImpl = mock(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/run")) {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({ authorization: "token" });
        expect(init?.body).toBe(JSON.stringify({ input: { prompt: "hello" } }));
        return new Response(JSON.stringify({ id: "job-1", status: "IN_QUEUE" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({ id: "job-1", status: "COMPLETED", output: { videoUrl: "https://cdn/video.mp4" } }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const client = createRunpodClient({
      apiKey: "token",
      endpointId: "endpoint-id",
      apiBaseUrl: "https://api.runpod.ai/v2",
      fetchImpl,
    });

    await expect(client.submit({ prompt: "hello" })).resolves.toEqual({
      jobId: "job-1",
      status: "queued",
    });

    await expect(client.getStatus("job-1")).resolves.toEqual({
      jobId: "job-1",
      status: "succeeded",
      output: { videoUrl: "https://cdn/video.mp4" },
      errorSummary: null,
    });
  });

  it("normalizes provider errors", () => {
    expect(normalizeRunpodStatus("FAILED")).toBe("failed");
    expect(normalizeRunpodError({ message: "boom" }, 500)).toBe("boom");
  });
});
