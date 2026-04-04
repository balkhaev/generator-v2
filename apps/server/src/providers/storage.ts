import { getComfyOperatorEnv } from "@generator/env/server";

const supportedImageSchemes = ["http:", "https:"];

type StorageConfig = {
  inputBaseUrl: string;
  outputBaseUrl: string;
};

export type StorageAdapter = ReturnType<typeof createStorageAdapter>;

export function createStorageAdapter(config?: Partial<StorageConfig>) {
  const resolveConfig = (): StorageConfig => {
    if (config?.inputBaseUrl && config?.outputBaseUrl) {
      return {
        inputBaseUrl: config.inputBaseUrl,
        outputBaseUrl: config.outputBaseUrl,
      };
    }

    const env = getComfyOperatorEnv();
    return {
      inputBaseUrl: config?.inputBaseUrl ?? env.COMFY_INPUT_BASE_URL,
      outputBaseUrl: config?.outputBaseUrl ?? env.COMFY_OUTPUT_BASE_URL,
    };
  };

  return {
    normalizeInputImageUrl(inputImageUrl: string) {
      const parsed = new URL(inputImageUrl);
      if (!supportedImageSchemes.includes(parsed.protocol)) {
        throw new Error("Input image must use http or https");
      }
      return parsed.toString();
    },
    normalizeOutputUrl(outputUrl: string) {
      const parsed = new URL(outputUrl);
      if (!supportedImageSchemes.includes(parsed.protocol)) {
        const { outputBaseUrl } = resolveConfig();
        return new URL(outputUrl.replace(/^\/+/, ""), `${outputBaseUrl}/`).toString();
      }
      return parsed.toString();
    },
    createInputAssetKey(filename: string) {
      const { inputBaseUrl } = resolveConfig();
      return new URL(filename.replace(/^\/+/, ""), `${inputBaseUrl}/`).toString();
    },
  };
}
