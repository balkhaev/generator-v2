/* biome-ignore-all lint/suspicious/noConsole: dev script */
import { createLtx23VideoServerlessWorkflow } from "../src/workflows/ltx-2-3-video-serverless";

const endpointId =
	process.env.RUNPOD_LTX23_SERVERLESS_ENDPOINT_ID ?? "hr1a398xx75thx";
const apiKey = process.env.RUNPOD_API_KEY;
if (!apiKey) {
	console.error("RUNPOD_API_KEY env required");
	process.exit(1);
}

const wf = createLtx23VideoServerlessWorkflow({ endpointId });
const payload = (await wf.buildPayload(
	{
		fps: 24,
		height: 512,
		inputImageUrl:
			"https://hel1.your-objectstorage.com/generator/studio-inputs/smoke/sample.png",
		negativePrompt: "",
		numFrames: 25,
		prompt:
			"A woman walks toward the camera on a sandy beach, gentle waves in the background.",
		seed: 42,
		steps: 6,
		width: 512,
	} as unknown as Parameters<typeof wf.buildPayload>[0],
	{ requestId: "smoke-bypass" } as unknown as Parameters<
		typeof wf.buildPayload
	>[1]
)) as Record<string, unknown>;

const submitRes = await fetch(`https://api.runpod.ai/v2/${endpointId}/run`, {
	body: JSON.stringify({ input: payload }),
	headers: {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
	},
	method: "POST",
});
const submitJson = (await submitRes.json()) as { id?: string; error?: string };
console.log("submit:", JSON.stringify(submitJson));
if (!submitJson.id) {
	process.exit(1);
}
const jobId = submitJson.id;

const deadline = Date.now() + 12 * 60 * 1000;
let last = "";
while (Date.now() < deadline) {
	await new Promise((r) => setTimeout(r, 5000));
	const r = await fetch(
		`https://api.runpod.ai/v2/${endpointId}/status/${jobId}`,
		{ headers: { Authorization: `Bearer ${apiKey}` } }
	);
	const j = (await r.json()) as {
		status?: string;
		delayTime?: number;
		executionTime?: number;
		output?: unknown;
		error?: string;
	};
	const summary = `${j.status} delay=${j.delayTime ?? "?"} exec=${j.executionTime ?? "?"}`;
	if (summary !== last) {
		console.log(summary);
		last = summary;
	}
	if (
		j.status === "COMPLETED" ||
		j.status === "FAILED" ||
		j.status === "CANCELLED"
	) {
		console.log("final:", JSON.stringify(j, null, 2));
		break;
	}
}
