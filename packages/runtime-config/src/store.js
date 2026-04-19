/**
 * Drizzle-backed store for runtime settings and integration credentials.
 *
 * Lives on admin-api. Other services do NOT import this — they go through
 * the HTTP client (`./client.ts`) so we can centralise validation, audit, and
 * cache invalidation. The contract is intentionally minimal so the store can
 * later be backed by something other than Postgres (e.g. Vault) without
 * touching callers.
 */
import {
	integrationCredential,
	runtimeSetting,
} from "@generator/db/schema/runtime-config";
import { and, eq } from "drizzle-orm";
import { decrypt, encrypt, parseMasterKey } from "./crypto";
import { domains, isDomainName } from "./domains";
export function createRuntimeConfigStore(options) {
	const masterKey = parseMasterKey(options.masterKey);
	const actor = options.actor ?? (() => null);
	const idFactory = options.idFactory ?? (() => crypto.randomUUID());
	const { db } = options;
	async function readCredentialMap() {
		const rows = await db.select().from(integrationCredential);
		const out = {};
		for (const row of rows) {
			const plain = decrypt(
				{ ciphertext: row.valueCiphertext, iv: row.iv },
				masterKey
			);
			const bucket = out[row.provider] ?? {};
			bucket[row.keyName] = plain;
			out[row.provider] = bucket;
		}
		return out;
	}
	return {
		async getSnapshot(domainName) {
			if (!isDomainName(domainName)) {
				throw new Error(`Unknown runtime-config domain: ${domainName}`);
			}
			const spec = domains[domainName];
			const rows = await db
				.select()
				.from(runtimeSetting)
				.where(eq(runtimeSetting.domain, domainName));
			const raw = {};
			for (const row of rows) {
				raw[row.key] = row.value;
			}
			const settings = spec.schema.parse(raw);
			const credentials = await readCredentialMap();
			return {
				credentials,
				domain: domainName,
				settings,
			};
		},
		async setSetting(domainName, key, value) {
			if (!isDomainName(domainName)) {
				throw new Error(`Unknown runtime-config domain: ${domainName}`);
			}
			const spec = domains[domainName];
			const existing = await db
				.select()
				.from(runtimeSetting)
				.where(eq(runtimeSetting.domain, domainName));
			const merged = {};
			for (const row of existing) {
				merged[row.key] = row.value;
			}
			merged[key] = value;
			// Validates the FULL set, not just the changed key, so cross-key
			// invariants are enforced (e.g. "openrouterModel must be set when
			// provider=openrouter" if we add that constraint later).
			spec.schema.parse(merged);
			const updatedBy = actor();
			await db
				.insert(runtimeSetting)
				.values({
					domain: domainName,
					id: idFactory(),
					key,
					updatedBy,
					value,
				})
				.onConflictDoUpdate({
					set: {
						updatedAt: new Date(),
						updatedBy,
						value,
					},
					target: [runtimeSetting.domain, runtimeSetting.key],
				});
		},
		async listCredentials() {
			const rows = await db.select().from(integrationCredential);
			const seen = new Set();
			const out = [];
			for (const row of rows) {
				seen.add(`${row.provider}:${row.keyName}`);
				out.push({
					configured: true,
					keyName: row.keyName,
					provider: row.provider,
					updatedAt: row.updatedAt?.toISOString() ?? null,
				});
			}
			// Surface known-but-unconfigured slots so the UI can render an empty
			// "Set key" card instead of hiding the integration entirely.
			for (const spec of Object.values(domains)) {
				for (const refs of Object.values(spec.providerCredentials)) {
					for (const ref of refs) {
						const key = `${ref.provider}:${ref.keyName}`;
						if (!seen.has(key)) {
							seen.add(key);
							out.push({
								configured: false,
								keyName: ref.keyName,
								provider: ref.provider,
								updatedAt: null,
							});
						}
					}
				}
			}
			return out.sort((a, b) =>
				a.provider === b.provider
					? a.keyName.localeCompare(b.keyName)
					: a.provider.localeCompare(b.provider)
			);
		},
		async setCredential(provider, keyName, value) {
			const enc = encrypt(value, masterKey);
			const updatedBy = actor();
			await db
				.insert(integrationCredential)
				.values({
					id: idFactory(),
					iv: enc.iv,
					keyName,
					provider,
					updatedBy,
					valueCiphertext: enc.ciphertext,
				})
				.onConflictDoUpdate({
					set: {
						iv: enc.iv,
						updatedAt: new Date(),
						updatedBy,
						valueCiphertext: enc.ciphertext,
					},
					target: [
						integrationCredential.provider,
						integrationCredential.keyName,
					],
				});
		},
		async deleteCredential(provider, keyName) {
			await db
				.delete(integrationCredential)
				.where(
					and(
						eq(integrationCredential.provider, provider),
						eq(integrationCredential.keyName, keyName)
					)
				);
		},
	};
}
