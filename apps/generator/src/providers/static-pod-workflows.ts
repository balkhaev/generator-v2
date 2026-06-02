import {
	type AnyWorkflowDefinition,
	createFluxImagePodWorkflow,
	createLtxVideoPodWorkflow,
	createWanVideoPodWorkflow,
} from "@generator/runpod";

const COMFYUI_PROXY_PORT = 8188;
const TRAILING_SLASH = /\/$/u;

/**
 * Резолвит base URL ComfyUI единого персистентного пода. Приоритет —
 * явный `RUNPOD_COMFYUI_BASE_URL`, иначе строим из `RUNPOD_COMFYUI_POD_ID`
 * (`https://<id>-8188.proxy.runpod.net`). Возвращает `null`, если ни одна
 * переменная не задана (тогда генератор работает в serverless/disposable-pod
 * режиме).
 */
export function resolveComfyPodBaseUrl(source: {
	baseUrl?: string | null;
	podId?: string | null;
}): string | null {
	const explicit = source.baseUrl?.trim();
	if (explicit) {
		return explicit.replace(TRAILING_SLASH, "");
	}
	const podId = source.podId?.trim();
	if (podId) {
		return `https://${podId}-${COMFYUI_PROXY_PORT}.proxy.runpod.net`;
	}
	return null;
}

export interface StaticPodWorkflowOverrides {
	flux?: {
		checkpointFilename?: string;
	};
	wan?: {
		accelLoraHighFilename?: string;
		accelLoraLowFilename?: string;
		highNoiseModelFilename?: string;
		lowNoiseModelFilename?: string;
		textEncoderFilename?: string;
		vaeFilename?: string;
	};
}

/**
 * Собирает три static-pod воркфлоу (LTX/WAN/Flux) с id, совпадающими с
 * ключами `__runpodWorkflow` из `@generator/workflows`
 * (`ltx-2-3-video`, `wan-2-2-video`, `flux-dev-image`). Все они ходят напрямую
 * в ComfyUI фиксированного пода.
 */
export function buildStaticPodWorkflows(
	comfyBaseUrl: string,
	overrides: StaticPodWorkflowOverrides = {}
): AnyWorkflowDefinition[] {
	return [
		createLtxVideoPodWorkflow({ comfyBaseUrl }),
		createWanVideoPodWorkflow({
			accelLoraHighFilename: overrides.wan?.accelLoraHighFilename,
			accelLoraLowFilename: overrides.wan?.accelLoraLowFilename,
			comfyBaseUrl,
			highNoiseModelFilename: overrides.wan?.highNoiseModelFilename,
			lowNoiseModelFilename: overrides.wan?.lowNoiseModelFilename,
			textEncoderFilename: overrides.wan?.textEncoderFilename,
			vaeFilename: overrides.wan?.vaeFilename,
		}),
		createFluxImagePodWorkflow({
			checkpointFilename: overrides.flux?.checkpointFilename,
			comfyBaseUrl,
		}),
	];
}
