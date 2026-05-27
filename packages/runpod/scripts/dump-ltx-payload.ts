/* biome-ignore-all lint/suspicious/noConsole: dev script */
import { createLtx23VideoServerlessWorkflow } from "../src/workflows/ltx-2-3-video-serverless";

const wf = createLtx23VideoServerlessWorkflow({ endpointId: "x" });
const payload = await wf.buildPayload(
	{
		fps: 24,
		height: 736,
		inputImageUrl:
			"https://generator.hel1.your-objectstorage.com/studio-inputs/smoke/sample.png",
		negativePrompt: undefined,
		numFrames: 24,
		prompt: "x",
		seed: 1,
		steps: 6,
		width: 1280,
	} as unknown as Parameters<typeof wf.buildPayload>[0],
	{ requestId: "dump" } as unknown as Parameters<typeof wf.buildPayload>[1]
);

const wf2 = (payload as { workflow: Record<string, unknown> }).workflow;
const ids = Object.keys(wf2).sort();
console.log("total nodes:", ids.length);
console.log("has 9001 (fallback SaveImage)?", "9001" in wf2);
console.log("has 9002 (fallback SaveAnimatedWEBP)?", "9002" in wf2);
console.log("has 140 (VHS_VideoCombine)?", "140" in wf2);
console.log("has 349 (TextGenerateLTX2Prompt)?", "349" in wf2);
console.log("has 350 (PROMPT INSTRUCT)?", "350" in wf2);
console.log("has 347 (StringConcatenate)?", "347" in wf2);
console.log("has 361 (PreviewAny)?", "361" in wf2);
console.log("has 366 (LoraManager)?", "366" in wf2);
console.log("has 364 (VAEDecode)?", "364" in wf2);
if ("121" in wf2) {
	const n = wf2["121"] as { class_type: string; inputs: unknown };
	console.log("node 121 (positive CLIP) inputs:", JSON.stringify(n.inputs));
}
if ("9001" in wf2) {
	console.log("node 9001:", JSON.stringify(wf2["9001"], null, 2));
}
if ("9002" in wf2) {
	console.log("node 9002:", JSON.stringify(wf2["9002"], null, 2));
}
if ("140" in wf2) {
	const n = wf2["140"] as { class_type: string; inputs: unknown };
	console.log("node 140 class:", n.class_type);
	console.log("node 140 inputs:", JSON.stringify(n.inputs, null, 2));
}
