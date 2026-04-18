/**
 * Admin-facing CRUD for the runtime-config store + the internal endpoint that
 * other services hit to read snapshots.
 *
 * The admin endpoints live under `/api/admin/integrations/*` and require a
 * normal session (no public path). The internal endpoint lives under
 * `/api/internal/runtime-config/*` and requires a shared bearer token (the
 * same `RUNTIME_CONFIG_INTERNAL_TOKEN` env var on both sides).
 */

import { timingSafeEqualString } from "@generator/runtime-config/crypto";
import {
	type DomainName,
	domains,
	isDomainName,
} from "@generator/runtime-config/domains";
import type { RuntimeConfigStore } from "@generator/runtime-config/store";
import { Hono } from "hono";
import { z } from "zod";

const setCredentialBody = z.object({
	value: z.string().min(1).max(10_000),
});

const setSettingBody = z.object({
	value: z.unknown(),
});

const PROVIDER_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const KEY_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const SETTING_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const BEARER_PREFIX_PATTERN = /^Bearer\s+/iu;

function validateProvider(value: string): boolean {
	return PROVIDER_PATTERN.test(value);
}

function validateKeyName(value: string): boolean {
	return KEY_NAME_PATTERN.test(value);
}

function validateSettingKey(value: string): boolean {
	return SETTING_KEY_PATTERN.test(value);
}

function asDomain(value: string): DomainName | null {
	return isDomainName(value) ? value : null;
}

export interface RuntimeConfigRoutesDeps {
	publishInvalidation(domain: DomainName): Promise<void>;
	store: RuntimeConfigStore;
}

export function createRuntimeConfigAdminRoutes(deps: RuntimeConfigRoutesDeps) {
	const app = new Hono();

	app.get("/credentials", async (c) => {
		const list = await deps.store.listCredentials();
		return c.json({ credentials: list });
	});

	app.put("/credentials/:provider/:keyName", async (c) => {
		const provider = c.req.param("provider");
		const keyName = c.req.param("keyName");
		if (!(validateProvider(provider) && validateKeyName(keyName))) {
			return c.json({ error: "Invalid provider or key name" }, 400);
		}
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}
		const parsed = setCredentialBody.safeParse(body);
		if (!parsed.success) {
			return c.json(
				{ error: parsed.error.issues[0]?.message ?? "Invalid request" },
				400
			);
		}
		await deps.store.setCredential(provider, keyName, parsed.data.value);
		await invalidateAffectedDomains(deps, provider, keyName);
		return c.json({ ok: true });
	});

	app.delete("/credentials/:provider/:keyName", async (c) => {
		const provider = c.req.param("provider");
		const keyName = c.req.param("keyName");
		if (!(validateProvider(provider) && validateKeyName(keyName))) {
			return c.json({ error: "Invalid provider or key name" }, 400);
		}
		await deps.store.deleteCredential(provider, keyName);
		await invalidateAffectedDomains(deps, provider, keyName);
		return c.json({ ok: true });
	});

	app.get("/runtime-settings/:domain", async (c) => {
		const domainName = asDomain(c.req.param("domain"));
		if (!domainName) {
			return c.json({ error: "Unknown domain" }, 404);
		}
		const snapshot = await deps.store.getSnapshot(domainName);
		// Strip credentials from the admin read — the UI never needs raw
		// secrets here, the credentials list lives at /credentials.
		return c.json({ domain: domainName, settings: snapshot.settings });
	});

	app.put("/runtime-settings/:domain/:key", async (c) => {
		const domainName = asDomain(c.req.param("domain"));
		const key = c.req.param("key");
		if (!domainName) {
			return c.json({ error: "Unknown domain" }, 404);
		}
		if (!validateSettingKey(key)) {
			return c.json({ error: "Invalid setting key" }, 400);
		}
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}
		const parsed = setSettingBody.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: "Invalid body" }, 400);
		}
		try {
			await deps.store.setSetting(domainName, key, parsed.data.value);
		} catch (error) {
			return c.json(
				{
					error:
						error instanceof Error ? error.message : "Failed to update setting",
				},
				400
			);
		}
		await deps.publishInvalidation(domainName);
		const snapshot = await deps.store.getSnapshot(domainName);
		return c.json({ domain: domainName, settings: snapshot.settings });
	});

	return app;
}

export function createRuntimeConfigInternalRoutes(deps: {
	store: RuntimeConfigStore;
	token: string;
}) {
	const app = new Hono();

	app.get("/:domain", async (c) => {
		const header = c.req.header("authorization") ?? "";
		const stripped = header.replace(BEARER_PREFIX_PATTERN, "");
		if (!timingSafeEqualString(stripped, deps.token)) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		const domainName = asDomain(c.req.param("domain"));
		if (!domainName) {
			return c.json({ error: "Unknown domain" }, 404);
		}
		const snapshot = await deps.store.getSnapshot(domainName);
		return c.json(snapshot);
	});

	return app;
}

/**
 * Publishes invalidation for every domain whose provider list mentions the
 * touched (provider, keyName) credential. A credential change can affect
 * multiple domains (e.g. an `xai` key may eventually be reused outside
 * prompt-enhance), so we fan out instead of guessing one domain.
 */
async function invalidateAffectedDomains(
	deps: RuntimeConfigRoutesDeps,
	provider: string,
	keyName: string
): Promise<void> {
	const affected = new Set<DomainName>();
	for (const [name, spec] of Object.entries(domains)) {
		for (const refs of Object.values(spec.providerCredentials)) {
			if (refs.some((r) => r.provider === provider && r.keyName === keyName)) {
				affected.add(name as DomainName);
				break;
			}
		}
	}
	await Promise.all(
		Array.from(affected).map((domain) => deps.publishInvalidation(domain))
	);
}
