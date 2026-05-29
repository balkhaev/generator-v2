/* biome-ignore-all lint/suspicious/noConsole: smoke script */
import { createWanVideoServerlessWorkflow } from "../src/workflows/wan-2-2-video-serverless";

const REF_IMG =
	process.env.WAN_SMOKE_INPUT_URL ??
	"https://generator.hel1.your-objectstorage.com/studio-inputs/smoke/sample.png";

async function main(): Promise<void> {
	const apiKey = process.env.RUNPOD_API_KEY;
	if (!apiKey) {
		throw new Error("RUNPOD_API_KEY env not set");
	}
	const endpointId =
		process.env.RUNPOD_WAN22_SERVERLESS_ENDPOINT_ID ??
		process.env.RUNPOD_ENDPOINT_ID;
	if (!endpointId) {
		throw new Error(
			"RUNPOD_WAN22_SERVERLESS_ENDPOINT_ID or RUNPOD_ENDPOINT_ID required"
		);
	}
	const wf = createWanVideoServerlessWorkflow({ endpointId });
	const payload = await wf.buildPayload(
		{
			fps: 16,
			height: 832,
			inputImageUrl: REF_IMG,
			loraHighFilename:
				process.env.WAN_PUSSY_LORA_HIGH ?? "wan22-pussy-high_noise.safetensors",
			loraLowFilename:
				process.env.WAN_PUSSY_LORA_LOW ?? "wan22-pussy-low_noise.safetensors",
			loraScale: 1,
			negativePrompt: "",
			numFrames: 81,
			prompt: "cinematic portrait, subtle motion, natural lighting",
			seed: 42,
			steps: 20,
			width: 480,
		},
		{ requestId: `wan-smoke-${Date.now()}` }
	);

	const resp = await fetch(`https://api.runpod.ai/v2/${endpointId}/run`, {
		body: JSON.stringify({ input: payload }),
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		method: "POST",
	});
	const body = await resp.text();
	console.log("submit_status:", resp.status);
	console.log("submit_body:", body);
}

main().catch((err) => {
	console.error("err:", err);
	process.exit(1);
});
