import "@generator/env/web";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
