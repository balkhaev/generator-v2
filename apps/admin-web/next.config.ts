import path from "node:path";
import { fileURLToPath } from "node:url";
import "@generator/env/web";
import type { NextConfig } from "next";

const appDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
	output: "standalone",
	outputFileTracingRoot: path.join(appDir, "../../"),
	typedRoutes: true,
	reactCompiler: true,
	async redirects() {
		return [
			{
				source: "/dashboard",
				destination: "/",
				permanent: false,
			},
		];
	},
};

export default nextConfig;
