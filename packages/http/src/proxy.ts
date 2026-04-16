import { DEBUG_CORRELATION_HEADER, normalizeBaseUrl } from "./shared";

export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit
) => Promise<Response>;

export interface ProxyHttpRequestOptions {
	debugCorrelationId: string;
	fetchImpl?: FetchLike;
	request: Request;
	targetBaseUrl: string;
}

const FORWARDED_REQUEST_HEADERS = [
	"content-type",
	"accept",
	"authorization",
] as const;

/**
 * Прозрачно форвардит входящий HTTP-запрос на целевой base URL.
 *
 * Сохраняет путь и query входящего запроса, пробрасывает безопасные заголовки
 * (content-type/accept/authorization) и корреляционный ID для трейсинга.
 * Тело запроса читается целиком в буфер — для апстримов со стримингом надо
 * использовать другой путь (прямой fetch со стримом body).
 */
export async function proxyHttpRequest(
	options: ProxyHttpRequestOptions
): Promise<Response> {
	const { debugCorrelationId, request, targetBaseUrl } = options;
	const fetchImpl = options.fetchImpl ?? fetch;

	const incomingUrl = new URL(request.url);
	const targetUrl = new URL(
		`${incomingUrl.pathname}${incomingUrl.search}`,
		`${normalizeBaseUrl(targetBaseUrl)}/`
	);

	const headers = new Headers();
	for (const headerName of FORWARDED_REQUEST_HEADERS) {
		const value = request.headers.get(headerName);
		if (value) {
			headers.set(headerName, value);
		}
	}
	headers.set(DEBUG_CORRELATION_HEADER, debugCorrelationId);

	const init: RequestInit = {
		headers,
		method: request.method,
	};

	if (!(request.method === "GET" || request.method === "HEAD")) {
		init.body = await request.clone().arrayBuffer();
	}

	const upstreamResponse = await fetchImpl(targetUrl, init);

	const responseHeaders = new Headers();
	const upstreamContentType = upstreamResponse.headers.get("content-type");
	if (upstreamContentType) {
		responseHeaders.set("content-type", upstreamContentType);
	}
	const upstreamCorrelationId =
		upstreamResponse.headers.get(DEBUG_CORRELATION_HEADER) ??
		debugCorrelationId;
	responseHeaders.set(DEBUG_CORRELATION_HEADER, upstreamCorrelationId);

	return new Response(upstreamResponse.body, {
		headers: responseHeaders,
		status: upstreamResponse.status,
	});
}
