import { env } from "@generator/env/server";

const supportedInputSchemes = ["http:", "https:"];
const supportedOutputSchemes = ["http:", "https:", "data:"];
const leadingSlashesPattern = /^\/+/u;

const DEFAULT_INPUT_BASE_URL = "https://assets.example.com/input";
const DEFAULT_OUTPUT_BASE_URL = "https://assets.example.com/output";

interface StorageConfig {
	inputBaseUrl: string;
	outputBaseUrl: string;
}

export type StorageAdapter = ReturnType<typeof createStorageAdapter>;

export function createStorageAdapter(config?: Partial<StorageConfig>) {
	const resolveConfig = (): StorageConfig => {
		if (config?.inputBaseUrl && config?.outputBaseUrl) {
			return {
				inputBaseUrl: config.inputBaseUrl,
				outputBaseUrl: config.outputBaseUrl,
			};
		}

		return {
			inputBaseUrl:
				config?.inputBaseUrl ??
				env.COMFY_INPUT_BASE_URL ??
				DEFAULT_INPUT_BASE_URL,
			outputBaseUrl:
				config?.outputBaseUrl ??
				env.COMFY_OUTPUT_BASE_URL ??
				DEFAULT_OUTPUT_BASE_URL,
		};
	};

	return {
		normalizeInputImageUrl(inputImageUrl: string) {
			const parsed = new URL(inputImageUrl);
			if (!supportedInputSchemes.includes(parsed.protocol)) {
				throw new Error("Input image must use http or https");
			}
			return parsed.toString();
		},
		normalizeOutputUrl(outputUrl: string) {
			if (URL.canParse(outputUrl)) {
				const parsed = new URL(outputUrl);
				if (supportedOutputSchemes.includes(parsed.protocol)) {
					return parsed.toString();
				}
			}

			const { outputBaseUrl } = resolveConfig();
			return new URL(
				outputUrl.replace(leadingSlashesPattern, ""),
				`${outputBaseUrl}/`
			).toString();
		},
		createInputAssetKey(filename: string) {
			const { inputBaseUrl } = resolveConfig();
			return new URL(
				filename.replace(leadingSlashesPattern, ""),
				`${inputBaseUrl}/`
			).toString();
		},
	};
}
