import { describe, expect, it } from "bun:test";

import {
	getTestUser,
	isAllowedTestUserEmail,
	upsertTestUser,
} from "@/test-users";

function createMemoryStore() {
	const users = new Map<
		string,
		{
			createdAt: Date;
			email: string;
			emailVerified: boolean;
			hasCredentialAccount: boolean;
			id: string;
			image: string | null;
			name: string;
			passwordHash: string;
			sessionCount: number;
			updatedAt: Date;
		}
	>();

	type MemoryUser = typeof users extends Map<any, infer T> ? T : never;

	const findBy = (predicate: (value: MemoryUser) => boolean) => {
		for (const value of users.values()) {
			if (predicate(value)) {
				return value;
			}
		}

		return null;
	};

	return {
		create: (input: {
			email: string;
			emailVerified: boolean;
			name: string;
			passwordHash: string;
		}) => {
			const now = new Date();
			const createdUser = {
				createdAt: now,
				email: input.email,
				emailVerified: input.emailVerified,
				hasCredentialAccount: true,
				id: crypto.randomUUID(),
				image: null,
				name: input.name,
				passwordHash: input.passwordHash,
				sessionCount: 0,
				updatedAt: now,
			};
			users.set(createdUser.id, createdUser);

			return Promise.resolve({
				hasCredentialAccount: createdUser.hasCredentialAccount,
				sessionCount: createdUser.sessionCount,
				user: createdUser,
			});
		},
		getByEmail: (email: string) => {
			const user = findBy((entry) => entry.email === email);

			return Promise.resolve(
				user
					? {
							hasCredentialAccount: user.hasCredentialAccount,
							sessionCount: user.sessionCount,
							user,
						}
					: null
			);
		},
		getById: (userId: string) => {
			const user = users.get(userId);

			return Promise.resolve(
				user
					? {
							hasCredentialAccount: user.hasCredentialAccount,
							sessionCount: user.sessionCount,
							user,
						}
					: null
			);
		},
		update: (input: {
			emailVerified: boolean;
			name: string;
			passwordHash: string;
			userId: string;
		}) => {
			const currentUser = users.get(input.userId);
			if (!currentUser) {
				throw new Error("Test user not found");
			}

			const updatedUser = {
				...currentUser,
				emailVerified: input.emailVerified,
				name: input.name,
				passwordHash: input.passwordHash,
				updatedAt: new Date(),
			};
			users.set(input.userId, updatedUser);

			return Promise.resolve({
				hasCredentialAccount: updatedUser.hasCredentialAccount,
				sessionCount: updatedUser.sessionCount,
				user: updatedUser,
			});
		},
	};
}

describe("mcp test user helpers", () => {
	it("accepts only explicit test user emails", () => {
		expect(isAllowedTestUserEmail("codex-e2e@example.com")).toBe(true);
		expect(isAllowedTestUserEmail("qa.user@example.test")).toBe(true);
		expect(isAllowedTestUserEmail("real.user@gmail.com")).toBe(false);
	});

	it("creates and fetches a test user", async () => {
		const store = createMemoryStore();

		const createdUser = await upsertTestUser(
			{
				email: "codex-create@example.com",
				name: "Codex Create",
				password: "TestPassword123!",
			},
			{
				hashPassword: async (password) => `hashed:${password}`,
				store,
			}
		);

		expect(createdUser.operation).toBe("created");
		expect(createdUser.user.email).toBe("codex-create@example.com");
		expect(createdUser.user.hasCredentialAccount).toBe(true);

		const fetchedUser = await getTestUser(
			{
				email: "codex-create@example.com",
			},
			{ store }
		);

		expect(fetchedUser?.id).toBe(createdUser.user.id);
		expect(fetchedUser?.name).toBe("Codex Create");
	});

	it("updates an existing test user", async () => {
		const store = createMemoryStore();
		const firstUser = await upsertTestUser(
			{
				email: "test-upsert@example.com",
				name: "First Name",
				password: "TestPassword123!",
			},
			{
				hashPassword: async (password) => `hashed:${password}`,
				store,
			}
		);

		const updatedUser = await upsertTestUser(
			{
				email: "test-upsert@example.com",
				name: "Updated Name",
				password: "ChangedPassword123!",
			},
			{
				hashPassword: async (password) => `hashed:${password}`,
				store,
			}
		);

		expect(updatedUser.operation).toBe("updated");
		expect(updatedUser.user.id).toBe(firstUser.user.id);
		expect(updatedUser.user.name).toBe("Updated Name");
	});

	it("rejects non-test emails", async () => {
		const store = createMemoryStore();

		await expect(
			upsertTestUser(
				{
					email: "person@gmail.com",
					password: "TestPassword123!",
				},
				{
					hashPassword: async (password) => `hashed:${password}`,
					store,
				}
			)
		).rejects.toThrow("Only explicit test emails are allowed");
	});
});
