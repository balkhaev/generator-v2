import { describe, expect, it } from "bun:test";
import type {
	AdminUser,
	CreateAdminUserInput,
	ListAdminUsersQuery,
	UpdateAdminUserInput,
} from "@generator/contracts/admin";

import { createApp } from "@/app";
import { UsersService } from "@/domain/users";
import type { UserRepository } from "@/repositories/users";

function createEmptyDashboardSnapshot() {
	return {
		loraTrainings: [],
		notices: [],
		recentRuns: [],
		runStatus: {
			failed: 0,
			queued: 0,
			running: 0,
			succeeded: 0,
		},
		scenarios: [],
		snapshotAt: new Date().toISOString(),
	};
}

describe("admin gateway", () => {
	it("rejects protected routes when the session is missing", async () => {
		const app = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3001"],
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve(null);
			},
			loadDashboardSnapshot() {
				return Promise.resolve(createEmptyDashboardSnapshot());
			},
			loadSetupStatus() {
				return Promise.resolve({ setupRequired: true });
			},
			studioBaseUrl: "http://studio.internal",
		});

		const response = await app.request("http://localhost/api/dashboard");

		expect(response.status).toBe(401);
	});

	it("proxies generator routes for authenticated requests", async () => {
		const app = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3001"],
			fetchImpl(input) {
				const url = input instanceof URL ? input : new URL(input.toString());
				return Promise.resolve(
					new Response(JSON.stringify({ url: url.toString() }), {
						headers: {
							"content-type": "application/json",
						},
						status: 200,
					})
				);
			},
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			loadDashboardSnapshot() {
				return Promise.resolve(createEmptyDashboardSnapshot());
			},
			loadSetupStatus() {
				return Promise.resolve({ setupRequired: false });
			},
			studioBaseUrl: "http://studio.internal",
		});

		const response = await app.request(
			"http://localhost/api/scenarios?limit=5"
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			url: "http://studio.internal/api/scenarios?limit=5",
		});
	});

	it("accepts token-protected internal training enqueue requests", async () => {
		const app = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3001"],
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve(null);
			},
			internalTrainingControlService: {
				enqueue() {
					return Promise.resolve({
						accepted: true as const,
						jobId: "training-job-1",
					});
				},
			},
			loadDashboardSnapshot() {
				return Promise.resolve(createEmptyDashboardSnapshot());
			},
			loadSetupStatus() {
				return Promise.resolve({ setupRequired: false });
			},
			studioBaseUrl: "http://studio.internal",
		});

		const response = await app.request(
			"http://localhost/api/internal/person-lora-trainings",
			{
				body: JSON.stringify({
					personId: "person-1",
					personName: "Person",
					personSlug: "person",
					referencePhotoUrl: "https://assets.example.com/reference.png",
				}),
				headers: {
					authorization: "Bearer local-training-control-token",
					"content-type": "application/json",
				},
				method: "POST",
			}
		);

		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({
			accepted: true,
			jobId: "training-job-1",
		});
	});

	it("exposes setup status without requiring a session", async () => {
		const app = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3001"],
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve(null);
			},
			loadDashboardSnapshot() {
				return Promise.resolve(createEmptyDashboardSnapshot());
			},
			loadSetupStatus() {
				return Promise.resolve({ setupRequired: true });
			},
			studioBaseUrl: "http://studio.internal",
		});

		const response = await app.request("http://localhost/api/setup/status");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			setupRequired: true,
		});
	});

	it("exposes storage configuration status for authenticated requests", async () => {
		const app = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3001"],
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			loadDashboardSnapshot() {
				return Promise.resolve(createEmptyDashboardSnapshot());
			},
			loadSetupStatus() {
				return Promise.resolve({ setupRequired: false });
			},
			studioBaseUrl: "http://studio.internal",
		});

		const response = await app.request("http://localhost/api/admin/storage");

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			categories: unknown[];
			config: { configured: boolean; missing: string[] };
		};
		expect(body.config.configured).toBe(false);
		expect(body.config.missing).toContain("S3_BUCKET");
		expect(body.categories.length).toBeGreaterThan(0);
	});

	it("exposes users CRUD for authenticated requests", async () => {
		const usersStore = new Map<string, AdminUser>();
		const credentialStore = new Map<string, string>();

		const repository: UserRepository = {
			create(input) {
				const now = new Date().toISOString();
				const user: AdminUser = {
					accountsCount: 0,
					createdAt: now,
					email: input.email,
					emailVerified: input.emailVerified ?? false,
					hasPassword: false,
					id: input.id,
					image: input.image ?? null,
					name: input.name,
					sessionsCount: 0,
					updatedAt: now,
				};
				usersStore.set(user.id, user);
				return Promise.resolve(user);
			},
			delete(id) {
				const existing = usersStore.get(id) ?? null;
				if (existing) {
					usersStore.delete(id);
					credentialStore.delete(id);
				}
				return Promise.resolve(existing);
			},
			getByEmail(email) {
				const found = [...usersStore.values()].find(
					(entry) => entry.email === email
				);
				return Promise.resolve(found ?? null);
			},
			getById(id) {
				return Promise.resolve(usersStore.get(id) ?? null);
			},
			list(_filter: { search?: string }) {
				return Promise.resolve([...usersStore.values()]);
			},
			update(id, patch) {
				const existing = usersStore.get(id);
				if (!existing) {
					return Promise.resolve(null);
				}
				const updated: AdminUser = {
					...existing,
					email: patch.email ?? existing.email,
					emailVerified: patch.emailVerified ?? existing.emailVerified,
					image: patch.image === undefined ? existing.image : patch.image,
					name: patch.name ?? existing.name,
					updatedAt: new Date().toISOString(),
				};
				usersStore.set(id, updated);
				return Promise.resolve(updated);
			},
			upsertCredentialAccount(input) {
				credentialStore.set(input.userId, input.password);
				const existing = usersStore.get(input.userId);
				if (existing) {
					usersStore.set(input.userId, {
						...existing,
						accountsCount: 1,
						hasPassword: true,
					});
				}
				return Promise.resolve();
			},
		};

		let counter = 0;
		const usersService = new UsersService({
			generateId: () => `id-${++counter}`,
			hashPasswordImpl: (password) => Promise.resolve(`hashed:${password}`),
			repository,
		});

		const app = createApp({
			authHandler() {
				return new Response("auth", { status: 200 });
			},
			corsOrigins: ["http://localhost:3001"],
			generatorBaseUrl: "http://generator.internal",
			getSession() {
				return Promise.resolve({
					session: { id: "session-1" },
					user: { id: "user-1" },
				});
			},
			loadDashboardSnapshot() {
				return Promise.resolve(createEmptyDashboardSnapshot());
			},
			loadSetupStatus() {
				return Promise.resolve({ setupRequired: false });
			},
			studioBaseUrl: "http://studio.internal",
			usersService,
		});

		const createResponse = await app.request(
			"http://localhost/api/admin/users",
			{
				body: JSON.stringify({
					email: "alice@example.com",
					name: "Alice",
					password: "supersecret",
				} satisfies CreateAdminUserInput),
				headers: { "content-type": "application/json" },
				method: "POST",
			}
		);
		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as { user: AdminUser };
		expect(created.user.email).toBe("alice@example.com");
		expect(created.user.hasPassword).toBe(true);

		const listResponse = await app.request(
			"http://localhost/api/admin/users" satisfies `http://localhost/api/admin/users${string}`
		);
		expect(listResponse.status).toBe(200);
		const list = (await listResponse.json()) as { users: AdminUser[] };
		expect(list.users).toHaveLength(1);

		const patchResponse = await app.request(
			`http://localhost/api/admin/users/${created.user.id}`,
			{
				body: JSON.stringify({
					name: "Alice Updated",
				} satisfies UpdateAdminUserInput),
				headers: { "content-type": "application/json" },
				method: "PATCH",
			}
		);
		expect(patchResponse.status).toBe(200);
		const patched = (await patchResponse.json()) as { user: AdminUser };
		expect(patched.user.name).toBe("Alice Updated");

		const passwordResponse = await app.request(
			`http://localhost/api/admin/users/${created.user.id}/password`,
			{
				body: JSON.stringify({ password: "newpassword" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}
		);
		expect(passwordResponse.status).toBe(200);
		expect(credentialStore.get(created.user.id)).toBe("hashed:newpassword");

		const selfDeleteResponse = await app.request(
			"http://localhost/api/admin/users/user-1",
			{ method: "DELETE" }
		);
		expect(selfDeleteResponse.status).toBe(400);

		const deleteResponse = await app.request(
			`http://localhost/api/admin/users/${created.user.id}`,
			{ method: "DELETE" }
		);
		expect(deleteResponse.status).toBe(200);
		expect(usersStore.size).toBe(0);

		const listQuery: ListAdminUsersQuery = {};
		expect(listQuery).toEqual({});
	});
});
