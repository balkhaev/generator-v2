import { defineConfig } from "tsdown";

export default defineConfig({
	clean: true,
	entry: {
		index: "./src/index.ts",
		worker: "./src/worker.ts",
	},
	format: "esm",
	noExternal: [/@generator\/.*/],
	outDir: "./dist",
});
