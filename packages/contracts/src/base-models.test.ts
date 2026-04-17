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
		expect(getBaseModelLabel("z-image")).toBe("Z-Image");
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
		["sdxl", "sdxl"],
		["pony", "sdxl"],
		["illustrious", "sdxl"],
		["sd-1-5", "sd"],
		["wan", "video"],
		["ltx", "video"],
		["z-image", "z-image"],
		["hidream", "image-other"],
		["other", "other"],
	] as const)("maps %s -> %s", (id, family) => {
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
		["Pony", "pony"],
		["Illustrious", "illustrious"],
		["NoobAI", "noob-ai"],
		["SD 1.5", "sd-1-5"],
		["SD 1.5 LCM", "sd-1-5"],
		["SD 2.1 768", "sd-2"],
		["SD 3.5 Large", "sd-3-5"],
		["Z-Image", "z-image"],
		["Z Image", "z-image"],
		["HiDream", "hidream"],
		["Lumina", "lumina"],
		["Stable Cascade", "stable-cascade"],
		["PixArt A", "pixart"],
		["Wan Video 1.3B", "wan"],
		["Wan Video 2.1 T2V", "wan"],
		["Wan Video 2.2 TI2V-5B", "wan-2-2"],
		["LTXV", "ltx"],
		["LTXV 13B", "ltx"],
		["LTX-Video", "ltx"],
		["Hunyuan Video", "hunyuan-video"],
		["CogVideoX", "cogvideox"],
		["Mochi", "mochi"],
	] as const)("maps Civitai value '%s' -> %s", (value, expected) => {
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
