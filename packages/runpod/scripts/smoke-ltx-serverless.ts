/* biome-ignore-all lint/suspicious/noConsole: smoke script */
import { createLtx23VideoServerlessWorkflow } from "../src/workflows/ltx-2-3-video-serverless";

const REF_IMG =
	process.env.LTX_SMOKE_INPUT_URL ??
	"https://generator.hel1.your-objectstorage.com/studio-inputs/smoke/sample.png";

async function main(): Promise<void> {
	const apiKey = process.env.RUNPOD_API_KEY;
	if (!apiKey) {
		throw new Error("RUNPOD_API_KEY env not set");
	}
	const endpointId = process.env.RUNPOD_ENDPOINT_ID ?? "hr1a398xx75thx";
	const wf = createLtx23VideoServerlessWorkflow({
		baseModelFilename:
			process.env.LTX_BASE_MODEL ??
			"diffusion_models/ltx-2.3-22b-dev_transformer_only_bf16.safetensors",
		distillLoraFilename:
			process.env.LTX_DISTILL_LORA ??
			"loras/ltx-2.3-22b-distilled-1.1_lora-dynamic_fro09_avg_rank_111_bf16.safetensors",
		endpointId,
	});
	const payload = await wf.buildPayload(
		{
			fps: 24,
			height: 736,
			inputImageUrl: REF_IMG,
			negativePrompt: undefined,
			numFrames: 24,
			prompt: "a futuristic city skyline at golden hour, cinematic camera pan",
			seed: 12_345,
			steps: 6,
			width: 1280,
		} as unknown as Parameters<typeof wf.buildPayload>[0],
		{
			requestId: `smoke-${Date.now()}`,
		} as unknown as Parameters<typeof wf.buildPayload>[1]
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
