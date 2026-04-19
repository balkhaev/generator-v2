/**
 * Runtime configuration tables.
 *
 * The admin app is the single source of truth for two kinds of state that
 * historically lived in env vars and was duplicated across every service:
 *
 *  - Provider credentials (OpenRouter, xAI, Fal, RunPod, ...). These are
 *    encrypted at rest with AES-256-GCM. The decryption key never touches
 *    this table; it lives in the `CONFIG_MASTER_KEY` env var of admin-api.
 *  - Runtime settings (which provider is active for a given domain, model
 *    overrides, feature flags). Plain JSON, not secret.
 *
 * Other services read both via `@generator/runtime-config` client, which talks
 * to admin-api over an internal endpoint and caches the result in memory with
 * Redis pub/sub invalidation. Env vars stay only for bootstrap (DATABASE_URL,
 * REDIS_URL, INTERNAL_TOKEN, CONFIG_MASTER_KEY).
 */

import {
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * One row per (provider, key_name) tuple. Example:
 *   provider="openrouter", keyName="apiKey",  valueCiphertext=<bytes>, iv=<12B>
 *   provider="xai",        keyName="apiKey",  ...
 *   provider="fal",        keyName="apiKey",  ...
 *
 * `valueCiphertext` and `iv` are base64-encoded for storage portability.
 * The auth tag from AES-GCM is appended to `valueCiphertext` (last 16 bytes
 * before encoding) — see `@generator/runtime-config/crypto`.
 */
export const integrationCredential = pgTable(
	"integration_credential",
	{
		id: text("id").primaryKey(),
		provider: text("provider").notNull(),
		keyName: text("key_name").notNull(),
		valueCiphertext: text("value_ciphertext").notNull(),
		iv: text("iv").notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		updatedBy: text("updated_by"),
	},
	(table) => [
		uniqueIndex("integration_credential_provider_key_idx").on(
			table.provider,
			table.keyName
		),
	]
);

/**
 * One row per (domain, key) tuple. Examples:
 *   domain="prompt-enhance-studio",  key="provider",        value="openrouter"
 *   domain="prompt-enhance-studio",  key="openrouterModel", value="qwen/qwen-3.5-235b"
 *   domain="prompt-enhance-persons", key="provider",        value="grok"
 *   domain="training",               key="provider",        value="fal"
 *
 * Values are JSON to support both scalars and small structured payloads
 * without forcing a schema migration for every new setting.
 */
export const runtimeSetting = pgTable(
	"runtime_setting",
	{
		id: text("id").primaryKey(),
		domain: text("domain").notNull(),
		key: text("key").notNull(),
		value: jsonb("value").notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		updatedBy: text("updated_by"),
	},
	(table) => [
		uniqueIndex("runtime_setting_domain_key_idx").on(table.domain, table.key),
	]
);
