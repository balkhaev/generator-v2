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
	images: {
		remotePatterns: [
			{
				hostname: "image.civitai.com",
				protocol: "https",
			},
			{
				hostname: "imagecache.civitai.com",
				protocol: "https",
			},
		],
	},
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
