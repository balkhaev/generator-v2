const IPV4_HOST_PATTERN = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;

function isBlockedImageFetchHostname(hostname: string): boolean {
	const h = hostname.toLowerCase();
	if (h === "localhost" || h.endsWith(".localhost")) {
		return true;
	}
	if (h === "0.0.0.0" || h === "[::1]" || h === "::1") {
		return true;
	}
	const ipv4 = IPV4_HOST_PATTERN.exec(h);
	if (ipv4) {
		const a = Number(ipv4[1]);
		const b = Number(ipv4[2]);
		if (a === 0 || a === 127 || a === 10) {
			return true;
		}
		if (a === 169 && b === 254) {
			return true;
		}
		if (a === 192 && b === 168) {
			return true;
		}
		if (a === 172 && b >= 16 && b <= 31) {
			return true;
		}
	}
	return false;
}

/** Only fetch remote images over HTTPS to avoid SSRF; skip private hosts. */
function canFetchImageAsInlineData(url: string): boolean {
	try {
		const u = new URL(url);
		if (u.protocol !== "https:") {
			return false;
		}
		return !isBlockedImageFetchHostname(u.hostname);
	} catch {
		return false;
	}
}

const MAX_VISION_IMAGE_BYTES = 6 * 1024 * 1024;
const VISION_IMAGE_FETCH_MS = 15_000;

export async function tryInlineImageForVision(
	imageUrl: string,
	fetchImpl: typeof fetch
): Promise<string> {
	const trimmed = imageUrl.trim();
	if (trimmed.startsWith("data:image/")) {
		return trimmed;
	}
	if (!canFetchImageAsInlineData(trimmed)) {
		return trimmed;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), VISION_IMAGE_FETCH_MS);
	try {
		const response = await fetchImpl(trimmed, {
			headers: { accept: "image/*,*/*" },
			method: "GET",
			redirect: "follow",
			signal: controller.signal,
		});
		if (!response.ok) {
			return trimmed;
		}
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength === 0 || buffer.byteLength > MAX_VISION_IMAGE_BYTES) {
			return trimmed;
		}
		const rawType = response.headers.get("content-type")?.split(";")[0]?.trim();
		const mime = rawType?.startsWith("image/") ? rawType : "image/jpeg";
		const base64 = Buffer.from(buffer).toString("base64");
		return `data:${mime};base64,${base64}`;
	} catch {
		return trimmed;
	} finally {
		clearTimeout(timeoutId);
	}
}
