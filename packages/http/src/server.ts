import "server-only";

import { requestJson } from "./client";
import { DEBUG_CORRELATION_HEADER } from "./shared";

export function createForwardHeaders(requestHeaders: Headers) {
	const headers = new Headers();
	const authorization = requestHeaders.get("authorization");
	const cookie = requestHeaders.get("cookie");
	const debugCorrelationId = requestHeaders.get(DEBUG_CORRELATION_HEADER);

	if (authorization) {
		headers.set("authorization", authorization);
	}

	if (cookie) {
		headers.set("cookie", cookie);
	}

	if (debugCorrelationId) {
		headers.set(DEBUG_CORRELATION_HEADER, debugCorrelationId);
	}

	return headers;
}

export function requestJsonWithForwardedHeaders<T>(
	input: string,
	requestHeaders: Headers,
	init?: RequestInit
): Promise<T> {
	const headers = createForwardHeaders(requestHeaders);

	if (init?.headers) {
		const extraHeaders = new Headers(init.headers);
		for (const [key, value] of extraHeaders.entries()) {
			headers.set(key, value);
		}
	}

	return requestJson<T>(input, {
		...init,
		headers,
	});
}
