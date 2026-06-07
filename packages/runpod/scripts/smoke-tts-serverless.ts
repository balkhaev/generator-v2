/* biome-ignore-all lint/suspicious/noConsole: smoke script */
import { createTtsServerlessWorkflow } from "../src/workflows/tts-serverless";

async function main(): Promise<void> {
	const apiKey = process.env.RUNPOD_API_KEY;
	if (!apiKey) {
		throw new Error("RUNPOD_API_KEY env not set");
	}
	const endpointId =
		process.env.RUNPOD_VOXCPM_TTS_ENDPOINT_ID ??
		process.env.RUNPOD_HIGGS_TTS_ENDPOINT_ID ??
		process.env.RUNPOD_ENDPOINT_ID;
	if (!endpointId) {
		throw new Error(
			"RUNPOD_VOXCPM_TTS_ENDPOINT_ID / RUNPOD_HIGGS_TTS_ENDPOINT_ID / RUNPOD_ENDPOINT_ID required"
		);
	}
	const wf = createTtsServerlessWorkflow({ endpointId, id: "tts-smoke" });
	const payload = await wf.buildPayload({
		referenceAudioUrl: process.env.TTS_SMOKE_REFERENCE_URL,
		text:
			process.env.TTS_SMOKE_TEXT ??
			"Привет! Это проверка синтеза речи через RunPod.",
	});

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
