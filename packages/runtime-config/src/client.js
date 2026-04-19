/**
 * HTTP client used by every non-admin service to read runtime config.
 *
 * Why HTTP and not direct DB access:
 *   - Secrets must only be decrypted in admin-api (single trust boundary for
 *     CONFIG_MASTER_KEY).
 *   - Centralised audit and rate-limiting on the admin side.
 *   - One source of validation logic instead of N copies in each service.
 *
 * The client wraps three reliability concerns:
 *   1. In-memory TTL cache (default 60s) — typical hot path is sub-millisecond.
 *   2. Redis pub/sub on `runtime-config:invalidated:<domain>` — admin-api
 *      publishes when something changes; subscribers drop the cache instantly
 *      so UI changes propagate within ~10ms.
 *   3. Bounded request timeout + stale-on-error — if admin-api is
 *      unreachable, we keep serving the last known snapshot rather than
 *      failing every dependent request. A `warn` is logged so the situation
 *      is visible.
 *
 * This client deliberately does NOT fall back to env. Env-based bootstrap
 * is admin-api's responsibility (one-time seed migration), not every
 * downstream service. Centralising the fallback prevents the previous
 * footgun where "studio falls back to Grok silently because nobody set
 * OPENROUTER_API_KEY in studio's env".
 */
import IORedis from "ioredis";
export const RUNTIME_CONFIG_INVALIDATION_CHANNEL_PREFIX =
	"runtime-config:invalidated:";
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
const TRAILING_SLASHES_PATTERN = /\/+$/;
export function createRuntimeConfigClient(options) {
	const baseUrl = options.adminApiUrl.replace(TRAILING_SLASHES_PATTERN, "");
	const token = options.internalToken.trim();
	if (!token) {
		throw new Error("RuntimeConfigClient requires a non-empty internalToken");
	}
	const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
	const timeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	const fetchImpl = options.fetchImpl ?? fetch;
	const logger = options.logger ?? console;
	const cache = new Map();
	const inflight = new Map();
	let subscriber = null;
	if (options.redisUrl) {
		try {
			subscriber = new IORedis(options.redisUrl, {
				lazyConnect: false,
				maxRetriesPerRequest: 3,
			});
			subscriber.on("error", (error) => {
				logger.warn?.("runtime-config.redis_subscriber_error", {
					message: error instanceof Error ? error.message : String(error),
				});
			});
			subscriber.psubscribe(
				`${RUNTIME_CONFIG_INVALIDATION_CHANNEL_PREFIX}*`,
				(error) => {
					if (error) {
						logger.warn?.("runtime-config.redis_subscribe_failed", {
							message: error.message,
						});
					}
				}
			);
			subscriber.on("pmessage", (_pattern, channel) => {
				const domain = channel.slice(
					RUNTIME_CONFIG_INVALIDATION_CHANNEL_PREFIX.length
				);
				cache.delete(domain);
			});
		} catch (error) {
			logger.warn?.("runtime-config.redis_init_failed", {
				message: error instanceof Error ? error.message : String(error),
			});
			subscriber = null;
		}
	}
	async function fetchSnapshot(domain) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeout);
		try {
			const response = await fetchImpl(
				`${baseUrl}/api/internal/runtime-config/${domain}`,
				{
					headers: {
						accept: "application/json",
						authorization: `Bearer ${token}`,
					},
					method: "GET",
					signal: controller.signal,
				}
			);
			if (!response.ok) {
				const detail = await response.text().catch(() => "");
				throw new Error(
					`runtime-config fetch failed: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ""}`
				);
			}
			return await response.json();
		} finally {
			clearTimeout(timer);
		}
	}
	function getInternal(domain) {
		const now = Date.now();
		const cached = cache.get(domain);
		if (cached && cached.expiresAt > now) {
			return Promise.resolve(cached.snapshot);
		}
		const existing = inflight.get(domain);
		if (existing) {
			return existing;
		}
		const promise = fetchSnapshot(domain)
			.then((snapshot) => {
				cache.set(domain, { expiresAt: Date.now() + ttl, snapshot });
				return snapshot;
			})
			.catch((error) => {
				logger.warn?.("runtime-config.fetch_failed", {
					domain,
					message: error instanceof Error ? error.message : String(error),
				});
				if (cached) {
					// Serve stale rather than failing the dependent request.
					return cached.snapshot;
				}
				throw error;
			})
			.finally(() => {
				inflight.delete(domain);
			});
		inflight.set(domain, promise);
		return promise;
	}
	return {
		get(domain) {
			return getInternal(domain);
		},
		invalidate(domain) {
			cache.delete(domain);
		},
		async close() {
			if (subscriber) {
				try {
					await subscriber.quit();
				} catch {
					subscriber.disconnect();
				}
			}
		},
	};
}
