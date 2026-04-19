/**
 * Реэкспорт единого реестра fal image-edit из `@generator/workflows`.
 * См. `packages/workflows/src/fal-image-edit-models.ts`.
 */

// biome-ignore lint/performance/noBarrelFile: стабильный алиас `@/providers` для админки
export {
	type BuildEditorRequestInput,
	DATASET_EDITOR_MODEL_DESCRIPTORS,
	type DatasetEditorModelAdapter,
	type DatasetEditorModelDescriptor,
	DEFAULT_DATASET_EDITOR_MODEL_ID,
	getDatasetEditorModelAdapter,
	isKnownDatasetEditorModelId,
} from "@generator/workflows/fal-image-edit-models";
