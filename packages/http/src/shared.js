export const TRAILING_SLASH_PATTERN = /\/$/;
export const DEBUG_CORRELATION_HEADER = "x-debug-correlation-id";
export const GENERATOR_CALLBACK_TOKEN_HEADER = "x-generator-callback-token";
export function normalizeBaseUrl(baseUrl) {
	return baseUrl.replace(TRAILING_SLASH_PATTERN, "");
}
export function readDebugCorrelationId(headers) {
	const value = headers?.get(DEBUG_CORRELATION_HEADER)?.trim();
	return value ? value : null;
}
export function resolveDebugCorrelationId(input) {
	const explicitId = input?.correlationId?.trim();
	if (explicitId) {
		return explicitId;
	}
	const headerId = readDebugCorrelationId(input?.headers);
	if (headerId) {
		return headerId;
	}
	return crypto.randomUUID();
}
