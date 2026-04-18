/**
 * Admin-api wiring for the runtime-config subsystem.
 *
 * Three responsibilities:
 *   1. Build a `RuntimeConfigStore` bound to the admin Postgres + master key.
 *   2. Seed the store from env on first start, so existing prod credentials
 *      (XAI_API_KEY / OPENROUTER_API_KEY / FAL_KEY / RUNPOD_API_KEY) carry
 *      over without an extra "go set the key in admin UI" step. Idempotent:
 *      seeding is skipped per-key once the key already exists in the store.
 *   3. Provide an invalidation publisher that pings Redis when a write
 *      happens, so consumer caches drop within ~10ms instead of waiting for
 *      the local TTL to expire.
 */

import { db } from "@generator/db";
import {
	type CredentialRef,
	type DomainName,
	domains,
} from "@generator/runtime-config/domains";
import {
	createRuntimeConfigStore,
	type RuntimeConfigStore,
} from "@generator/runtime-config/store";
import IORedis from "ioredis";

export interface RuntimeConfigSetup {
	publishInvalidation(domain: DomainName): Promise<void>;
	store: RuntimeConfigStore;
}

export interface RuntimeConfigEnvSeed {
	/** Map of provider -> keyName -> raw value from env. */
	credentials: Record<string, Record<string, string | undefined>>;
}

const INVALIDATION_CHANNEL_PREFIX = "runtime-config:invalidated:";

export function createRuntimeConfigSetup(options: {
	masterKey: string;
	redisUrl: string;
	actor?: () => string | null;
}): RuntimeConfigSetup {
	const store = createRuntimeConfigStore({
		actor: options.actor,
		db,
		masterKey: options.masterKey,
	});

	// Dedicated publisher connection so we don't share the BullMQ pool. A short
	// command timeout keeps invalidation off the request hot path even if
	// Redis hiccups; the consumer cache TTL bounds how long stale data lives
	// in the worst case.
	const publisher = new IORedis(options.redisUrl, {
		commandTimeout: 1500,
		enableOfflineQueue: false,
		lazyConnect: false,
		maxRetriesPerRequest: 1,
	});
	publisher.on("error", (error) => {
		console.warn("admin.runtime-config.invalidation_publisher_error", {
			message: error instanceof Error ? error.message : String(error),
		});
	});

	return {
		store,
		async publishInvalidation(domain) {
			try {
				await publisher.publish(`${INVALIDATION_CHANNEL_PREFIX}${domain}`, "1");
			} catch (error) {
				// Soft-fail: caches will refresh after their local TTL anyway.
				console.warn("admin.runtime-config.invalidation_publish_failed", {
					domain,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		},
	};
}

/**
 * One-time backfill of credentials from env into the store. Runs on every
 * boot but skips entries that already exist, so changing an env var post-seed
 * has no effect — the admin UI is the source of truth from then on.
 */
export async function seedCredentialsFromEnv(
	store: RuntimeConfigStore,
	seed: RuntimeConfigEnvSeed,
	logger: Pick<Console, "info" | "warn"> = console
): Promise<void> {
	const existing = await store.listCredentials();
	const configured = new Set(
		existing
			.filter((entry) => entry.configured)
			.map((entry) => `${entry.provider}:${entry.keyName}`)
	);
	const knownRefs = collectAllCredentialRefs();
	for (const ref of knownRefs) {
		const refKey = `${ref.provider}:${ref.keyName}`;
		if (configured.has(refKey)) {
			continue;
		}
		const value = seed.credentials[ref.provider]?.[ref.keyName];
		if (!value?.trim()) {
			continue;
		}
		try {
			await store.setCredential(ref.provider, ref.keyName, value.trim());
			logger.info?.("admin.runtime-config.seeded_from_env", {
				keyName: ref.keyName,
				provider: ref.provider,
			});
		} catch (error) {
			logger.warn?.("admin.runtime-config.seed_failed", {
				keyName: ref.keyName,
				message: error instanceof Error ? error.message : String(error),
				provider: ref.provider,
			});
		}
	}
}

function collectAllCredentialRefs(): CredentialRef[] {
	const seen = new Set<string>();
	const out: CredentialRef[] = [];
	for (const spec of Object.values(domains)) {
		for (const refs of Object.values(spec.providerCredentials)) {
			for (const ref of refs) {
				const key = `${ref.provider}:${ref.keyName}`;
				if (!seen.has(key)) {
					seen.add(key);
					out.push(ref);
				}
			}
		}
	}
	return out;
}
