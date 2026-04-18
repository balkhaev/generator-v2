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
import { runtimeSetting } from "@generator/db/schema/runtime-config";
import {
	type CredentialRef,
	type DomainName,
	domains,
} from "@generator/runtime-config/domains";
import {
	createRuntimeConfigStore,
	type RuntimeConfigStore,
} from "@generator/runtime-config/store";
import { and, eq } from "drizzle-orm";
import IORedis from "ioredis";

export interface RuntimeConfigSetup {
	publishInvalidation(domain: DomainName): Promise<void>;
	store: RuntimeConfigStore;
}

export interface RuntimeConfigEnvSeed {
	/** Map of provider -> keyName -> raw value from env. */
	credentials: Record<string, Record<string, string | undefined>>;
}

/**
 * Per-domain non-secret defaults sourced from env.
 *
 * Like `RuntimeConfigEnvSeed`, this is one-shot: a value is only written into
 * the store if there is no existing setting for that `domain` + `key` pair.
 * Once the admin UI writes a value, env is ignored on subsequent boots.
 */
export interface RuntimeConfigSettingsSeed {
	settings: Partial<
		Record<DomainName, Record<string, string | number | boolean | undefined>>
	>;
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

/**
 * One-time backfill of non-secret per-domain settings from env. Skips any
 * domain/key that already has a row, so the admin UI takes over after the
 * first explicit write.
 */
export async function seedSettingsFromEnv(
	store: RuntimeConfigStore,
	seed: RuntimeConfigSettingsSeed,
	logger: Pick<Console, "info" | "warn"> = console
): Promise<void> {
	for (const [domainName, kv] of Object.entries(seed.settings)) {
		if (!(kv && isDomainNameLocal(domainName))) {
			continue;
		}
		for (const [key, rawValue] of Object.entries(kv)) {
			if (rawValue === undefined || rawValue === null || rawValue === "") {
				continue;
			}
			const existingRows = await db
				.select()
				.from(runtimeSetting)
				.where(
					and(
						eq(runtimeSetting.domain, domainName),
						eq(runtimeSetting.key, key)
					)
				);
			if (existingRows.length > 0) {
				continue;
			}
			try {
				await store.setSetting(domainName, key, rawValue);
				logger.info?.("admin.runtime-config.seeded_setting_from_env", {
					domain: domainName,
					key,
				});
			} catch (error) {
				logger.warn?.("admin.runtime-config.seed_setting_failed", {
					domain: domainName,
					key,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}
}

function isDomainNameLocal(value: string): value is DomainName {
	return value in domains;
}

/**
 * Migrates legacy admin Redis keys (the per-domain settings the admin UI used
 * to write directly to Redis) into runtime_setting rows. Runs before the env
 * seed so an explicitly chosen "openrouter" provider in Redis takes priority
 * over the env-derived default. Idempotent: skips domain/key pairs that
 * already exist in the runtime-config store.
 *
 * Once every consumer reads from runtime-config and the admin mirror is in
 * place, this function can be deleted along with the Redis legacy keys.
 */
export async function seedSettingsFromLegacyRedis(
	store: RuntimeConfigStore,
	options: { redisUrl: string },
	logger: Pick<Console, "info" | "warn"> = console
): Promise<void> {
	const redis = new IORedis(options.redisUrl, {
		commandTimeout: 1500,
		enableOfflineQueue: false,
		lazyConnect: false,
		maxRetriesPerRequest: 1,
	});
	redis.on("error", () => {
		// Errors are surfaced via the read attempts below; suppress the global
		// listener so a transient Redis hiccup doesn't crash boot.
	});

	const migrations: LegacyRedisMigration[] = [
		{
			domain: "prompt-enhance",
			key: "provider",
			redisKey: "admin:prompt-enhance-provider",
		},
		{
			domain: "prompt-enhance",
			key: "openrouterModel",
			redisKey: "admin:prompt-enhance-openrouter-model",
		},
		{
			domain: "training",
			key: "provider",
			redisKey: "admin:training-provider",
		},
	];

	try {
		for (const migration of migrations) {
			await applyLegacyRedisMigration({
				logger,
				migration,
				redis,
				store,
			});
		}
	} finally {
		await redis.quit().catch(() => {
			// Already closing.
		});
	}
}

interface LegacyRedisMigration {
	coerce?: (value: string) => unknown;
	domain: DomainName;
	key: string;
	redisKey: string;
}

async function applyLegacyRedisMigration(opts: {
	logger: Pick<Console, "info" | "warn">;
	migration: LegacyRedisMigration;
	redis: IORedis;
	store: RuntimeConfigStore;
}): Promise<void> {
	const { logger, migration, redis, store } = opts;
	let raw: string | null;
	try {
		raw = await redis.get(migration.redisKey);
	} catch (error) {
		logger.warn?.("admin.runtime-config.legacy_redis_read_failed", {
			message: error instanceof Error ? error.message : String(error),
			redisKey: migration.redisKey,
		});
		return;
	}
	const trimmed = raw?.trim();
	if (!trimmed) {
		return;
	}
	const value = migration.coerce ? migration.coerce(trimmed) : trimmed;
	const existing = await db
		.select()
		.from(runtimeSetting)
		.where(
			and(
				eq(runtimeSetting.domain, migration.domain),
				eq(runtimeSetting.key, migration.key)
			)
		);
	if (existing.length > 0 && existing[0]?.value === value) {
		return;
	}
	try {
		await store.setSetting(migration.domain, migration.key, value);
		logger.info?.("admin.runtime-config.seeded_setting_from_redis", {
			domain: migration.domain,
			key: migration.key,
			previousValue: existing[0]?.value ?? null,
			redisKey: migration.redisKey,
		});
	} catch (error) {
		logger.warn?.("admin.runtime-config.seed_setting_from_redis_failed", {
			domain: migration.domain,
			key: migration.key,
			message: error instanceof Error ? error.message : String(error),
		});
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
