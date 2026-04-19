import { describe, expect, it } from "bun:test";
import {
	BASE_MODEL_FAMILIES,
	BASE_MODEL_IDS,
	getBaseModel,
	getBaseModelFamily,
	getBaseModelLabel,
	groupBaseModelsByFamily,
	mapCivitaiBaseModel,
} from "./base-models";

describe("BASE_MODELS registry", () => {
	it("has unique ids", () => {
		const set = new Set(BASE_MODEL_IDS);
		expect(set.size).toBe(BASE_MODEL_IDS.length);
	});
	it("includes the catch-all 'other' entry", () => {
		expect(BASE_MODEL_IDS).toContain("other");
		expect(getBaseModel("other").family).toBe("other");
	});
	it("returns canonical labels", () => {
		expect(getBaseModelLabel("flux")).toBe("Flux.1");
		expect(getBaseModelLabel("z-image")).toBe("Z-Image (base)");
		expect(getBaseModelLabel("z-image-turbo")).toBe("Z-Image Turbo");
		expect(getBaseModelLabel("non-existent")).toBe("non-existent");
	});
	it("groups by family preserving canonical order", () => {
		const groups = groupBaseModelsByFamily();
		const families = groups.map((group) => group.family);
		const expectedOrder = BASE_MODEL_FAMILIES.map((family) => family.id).filter(
			(family) => families.includes(family)
		);
		expect(families).toEqual(expectedOrder);
		for (const group of groups) {
			expect(group.models.length).toBeGreaterThan(0);
			for (const model of group.models) {
				expect(model.family).toBe(group.family);
			}
		}
	});
});
describe("getBaseModelFamily", () => {
	it.each([
		["flux", "flux"],
		["flux-kontext", "flux"],
		["flux-2", "flux"],
		["flux-2-klein-4b", "flux"],
		["flux-2-klein-9b", "flux"],
		["qwen-image", "qwen"],
		["qwen-image-2512", "qwen"],
		["qwen-image-edit", "qwen"],
		["qwen-image-edit-2509", "qwen"],
		["qwen-image-edit-2511", "qwen"],
		["sdxl", "sdxl"],
		["sd-1-5", "sd"],
		["z-image", "z-image"],
		["z-image-turbo", "z-image"],
		["z-image-de-turbo", "z-image"],
		["hidream", "image-other"],
		["hidream-e1", "image-other"],
		["lumina", "image-other"],
		["chroma", "image-other"],
		["zeta-chroma", "image-other"],
		["flex-1", "image-other"],
		["flex-2", "image-other"],
		["omnigen-2", "image-other"],
		["ernie-image", "image-other"],
		["nucleus-image", "image-other"],
		["wan", "video"],
		["wan-2-2", "video"],
		["wan-2-7", "video"],
		["seedance-1-5-pro", "video"],
		["ltx-2", "video"],
		["ltx-2-3", "video"],
		["ace-step", "audio"],
		["ace-step-xl", "audio"],
		["other", "other"],
	])("maps %s -> %s", (id, family) => {
		expect(getBaseModelFamily(id)).toBe(family);
	});
});
describe("mapCivitaiBaseModel", () => {
	it.each([
		["Flux.1 D", "flux"],
		["Flux.1 S", "flux"],
		["Flux.1 Kontext", "flux-kontext"],
		["Flux 2", "flux-2"],
		["SDXL 1.0", "sdxl"],
		["SDXL Lightning", "sdxl"],
		["SDXL Turbo", "sdxl"],
		["SD 1.5", "sd-1-5"],
		["SD 1.5 LCM", "sd-1-5"],
		["Z-Image", "z-image"],
		["Z Image", "z-image"],
		["Z-Image Turbo", "z-image-turbo"],
		["Z Image Turbo", "z-image-turbo"],
		["zimage turbo", "z-image-turbo"],
		["Z-Image De-Turbo", "z-image-de-turbo"],
		["HiDream", "hidream"],
		["HiDream I1", "hidream"],
		["HiDream E1", "hidream-e1"],
		["Lumina", "lumina"],
		["Lumina Image 2", "lumina"],
		["Chroma", "chroma"],
		["Chroma 1", "chroma"],
		["Zeta Chroma", "zeta-chroma"],
		["Flex.1", "flex-1"],
		["Flex.1 alpha", "flex-1"],
		["Flex.2", "flex-2"],
		["Flex.2 preview", "flex-2"],
		["OmniGen2", "omnigen-2"],
		["ERNIE-Image", "ernie-image"],
		["Nucleus-Image", "nucleus-image"],
		["Qwen-Image", "qwen-image"],
		["Qwen Image 2512", "qwen-image-2512"],
		["Qwen-Image-Edit", "qwen-image-edit"],
		["Qwen-Image-Edit-2509", "qwen-image-edit-2509"],
		["Qwen-Image-Edit-2511", "qwen-image-edit-2511"],
		["Flux.2", "flux-2"],
		["Flux.2 Klein 4B", "flux-2-klein-4b"],
		["Flux.2 Klein 9B", "flux-2-klein-9b"],
		["Wan Video 1.3B", "wan"],
		["Wan Video 2.1 T2V", "wan"],
		["Wan Video 2.2 TI2V-5B", "wan-2-2"],
		["Wan Video 2.7", "wan-2-7"],
		["Seedance 1.5 Pro", "seedance-1-5-pro"],
		["LTXV 13B", "ltx-2-3"],
		["LTX 2", "ltx-2"],
		["LTX 2.3", "ltx-2-3"],
		["Ace Step 1.5", "ace-step"],
		["Ace Step 1.5 XL", "ace-step-xl"],
	])("maps Civitai value '%s' -> %s", (value, expected) => {
		expect(mapCivitaiBaseModel(value)).toBe(expected);
	});
	it("returns undefined for unknown or empty values", () => {
		expect(mapCivitaiBaseModel(undefined)).toBeUndefined();
		expect(mapCivitaiBaseModel(null)).toBeUndefined();
		expect(mapCivitaiBaseModel("")).toBeUndefined();
		expect(mapCivitaiBaseModel("Some Future Model")).toBeUndefined();
	});
	it("prefers more specific aliases", () => {
		expect(mapCivitaiBaseModel("Wan Video 2.2 I2V-A14B")).toBe("wan-2-2");
		expect(mapCivitaiBaseModel("Flux.1 Kontext (dev)")).toBe("flux-kontext");
	});
});
