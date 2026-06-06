import type {
	WorkflowBaseModel,
	WorkflowField,
	WorkflowPreset,
} from "@generator/contracts/generator";
import type { z } from "zod";

export interface WorkflowDefinition<
	TParams extends z.ZodTypeAny = z.ZodTypeAny,
> {
	baseModel?: WorkflowBaseModel;
	buildProviderInput: (args: {
		inputImageUrl?: string;
		prompt: string;
		params: z.infer<TParams>;
	}) => Record<string, unknown>;
	description: string;
	/**
	 * Грубая оценка типичной длительности успешного исполнения. Используется
	 * для soft-progress (1 - exp(-elapsed/expected)) и ETA в UI, когда провайдер
	 * не отдаёт реальный progress. Значения подобраны по реально наблюдаемым
	 * runtime'ам (image: ~10–30s, video: ~3–10min); цифры нарочно консервативны
	 * — soft-progress кепится 90%, так что недолёт лучше перелёта.
	 */
	expectedDurationMs?: number;
	extractArtifactUrls: (output: unknown) => string[];
	/** Keep old workflow keys executable without showing them in new scenario UI. */
	hiddenFromList?: boolean;
	key: string;
	name: string;
	parameterFields: readonly WorkflowField[];
	parameterSchema: TParams;
	/** Быстрые наборы значений (качество/длительность) для редактора сценария. */
	presets?: readonly WorkflowPreset[];
	requiresInputImage: boolean;
}
