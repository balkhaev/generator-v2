const ipv4HostnamePattern = /^\d{1,3}(?:\.\d{1,3}){3}$/u;

export function deriveCrossSubdomainCookieDomain(baseUrl: string) {
	const hostname = new URL(baseUrl).hostname;

	if (
		hostname === "localhost" ||
		hostname.includes(":") ||
		ipv4HostnamePattern.test(hostname)
	) {
		return null;
	}

	const parts = hostname.split(".");
	if (parts.length < 3) {
		return null;
	}

	return parts.slice(1).join(".");
}
