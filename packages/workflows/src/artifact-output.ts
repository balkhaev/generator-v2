/**
 * Разбор ответов провайдеров инференса: извлечение URL артефактов (видео/изображения/аудио)
 * из произвольной структуры output.
 */

const artifactDataUrlPattern =
	/^data:(image|video|audio)\/[a-z0-9.+-]+;base64,/i;

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
			const directKeys = [
				"video",
				"videoUrl",
				"image",
				"imageUrl",
				"audio",
				"audioUrl",
				"url",
			];
			const urls = directKeys.flatMap((key) => collect(record[key]));
			return urls.length > 0 ? urls : Object.values(record).flatMap(collect);
		}
		return [];
	};

	return [...new Set(collect(output))];
}
