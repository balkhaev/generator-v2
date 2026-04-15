interface PublicPathMatcherOptions {
	exact?: Iterable<string>;
	prefixes?: Iterable<string>;
}

export function createPublicPathMatcher(options: PublicPathMatcherOptions) {
	const exactPaths = new Set(options.exact ?? []);
	const prefixes = [...(options.prefixes ?? [])];

	return (path: string) =>
		exactPaths.has(path) || prefixes.some((prefix) => path.startsWith(prefix));
}
