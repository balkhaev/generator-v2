/**
 * Admin-side контракт для конфигурируемых RunPod inference target'ов:
 *
 * - `RunpodNetworkVolume` — каталог наших RunPod NFS volume'ов, привязанных
 *   к pod-template'у. Реальный volume создаётся вручную в RunPod console;
 *   здесь храним metadata (datacenter, размер, поддерживаемые GPU типы).
 * - `RunpodPodTemplate` — описание одного workflow runtime'а с конкретной
 *   конфигурацией (RunPod template id для pod, или endpoint id для
 *   serverless; image, GPU priority, list прикреплённых volume'ов).
 *
 * Studio scenario может опционально ссылаться на pod-template через
 * `runpodPodTemplateId`. Без ссылки generator падает на env-defaults для
 * backward compatibility.
 */

export type RunpodTemplateMode = "pod" | "serverless";

export const RUNPOD_TEMPLATE_MODES: readonly RunpodTemplateMode[] = [
	"pod",
	"serverless",
];

export interface RunpodNetworkVolume {
	createdAt: string;
	datacenter: string;
	description: string;
	gpuTypeIds: string[];
	id: string;
	name: string;
	runpodVolumeId: string;
	sizeGb: number;
	updatedAt: string;
}

export interface RunpodPodTemplateVolumeRef {
	priority: number;
	volume: RunpodNetworkVolume;
}

export interface RunpodPodTemplate {
	cloudType: string | null;
	containerDiskInGb: number | null;
	createdAt: string;
	defaultEnv: Record<string, string>;
	description: string;
	enabled: boolean;
	gpuTypeIds: string[];
	id: string;
	imageName: string | null;
	keepAliveMs: number | null;
	mode: RunpodTemplateMode;
	name: string;
	runpodEndpointId: string | null;
	runpodTemplateId: string | null;
	timeoutMs: number | null;
	updatedAt: string;
	volumeInGb: number | null;
	/** Привязанные network volume'ы в порядке priority asc (для multi-volume failover). */
	volumes: RunpodPodTemplateVolumeRef[];
	/**
	 * Какой runtime workflow в @generator/runpod это инстансит — например
	 * `ltx-2-3-video` для LTX или `fooocus-sdxl` для serverless Fooocus.
	 * Список доступных значений ограничен registry'ем в `@generator/runpod`.
	 */
	workflowKey: string;
}

export interface CreateRunpodNetworkVolumeInput {
	datacenter: string;
	description?: string;
	gpuTypeIds?: string[];
	name: string;
	runpodVolumeId: string;
	sizeGb?: number;
}

export interface UpdateRunpodNetworkVolumeInput {
	datacenter?: string;
	description?: string;
	gpuTypeIds?: string[];
	name?: string;
	runpodVolumeId?: string;
	sizeGb?: number;
}

export interface PodTemplateVolumeAssignment {
	priority: number;
	volumeId: string;
}

export interface CreateRunpodPodTemplateInput {
	cloudType?: string;
	containerDiskInGb?: number;
	defaultEnv?: Record<string, string>;
	description?: string;
	enabled?: boolean;
	gpuTypeIds?: string[];
	imageName?: string;
	keepAliveMs?: number;
	mode: RunpodTemplateMode;
	name: string;
	runpodEndpointId?: string;
	runpodTemplateId?: string;
	timeoutMs?: number;
	volumeInGb?: number;
	volumes?: PodTemplateVolumeAssignment[];
	workflowKey: string;
}

export interface UpdateRunpodPodTemplateInput {
	cloudType?: string | null;
	containerDiskInGb?: number | null;
	defaultEnv?: Record<string, string>;
	description?: string;
	enabled?: boolean;
	gpuTypeIds?: string[];
	imageName?: string | null;
	keepAliveMs?: number | null;
	name?: string;
	runpodEndpointId?: string | null;
	runpodTemplateId?: string | null;
	timeoutMs?: number | null;
	volumeInGb?: number | null;
	volumes?: PodTemplateVolumeAssignment[];
	workflowKey?: string;
}

export interface ListRunpodPodTemplatesQuery {
	enabled?: boolean;
	mode?: RunpodTemplateMode;
	workflowKey?: string;
}
