import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "./src/index.ts",
	},
	format: "esm",
	outDir: "./dist",
	clean: true,
	noExternal: [/@generator\/.*/],
});
