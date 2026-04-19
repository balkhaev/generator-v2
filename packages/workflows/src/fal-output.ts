/**
 * Разбор ответов fal.ai: единая логика для workflow registry и image-edit моделей.
 */

const artifactDataUrlPattern = /^data:(image|video)\/[a-z0-9.+-]+;base64,/i;

export function collectArtifactUrls(output: unknown): string[] {
	const looksLikeArtifactUrl = (value: string) => {
		return (
			artifactDataUrlPattern.test(value) ||
			value.startsWith("http://") ||
			value.startsWith("https://")
		);
	};

	const collect = (value: unknown): string[] => {
		if (!value) {
			return [];
		}
		if (typeof value === "string") {
			return looksLikeArtifactUrl(value) ? [value] : [];
		}
		if (Array.isArray(value)) {
			return value.flatMap(collect);
		}
		if (typeof value === "object") {
			const record = value as Record<string, unknown>;
			const directKeys = ["video", "videoUrl", "image", "imageUrl", "url"];
			const urls = directKeys.flatMap((key) => collect(record[key]));
			return urls.length > 0 ? urls : Object.values(record).flatMap(collect);
		}
		return [];
	};

	return [...new Set(collect(output))];
}

export function collectFalImageUrls(output: unknown): string[] {
	if (!output || typeof output !== "object") {
		return [];
	}
	const record = output as Record<string, unknown>;
	const images = record.images;
	if (!Array.isArray(images)) {
		return collectArtifactUrls(output);
	}
	const urls: string[] = [];
	for (const image of images) {
		if (image && typeof image === "object" && "url" in image) {
			const url = (image as Record<string, unknown>).url;
			if (typeof url === "string" && url.length > 0) {
				urls.push(url);
			}
		}
	}
	return urls.length > 0 ? urls : collectArtifactUrls(output);
}
