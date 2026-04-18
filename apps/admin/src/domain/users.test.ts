import { beforeEach, describe, expect, it } from "bun:test";
import type { AdminUser } from "@generator/contracts/admin";

import { UsersService, UsersServiceError } from "@/domain/users";
import type {
	CreateUserRecordInput,
	UpdateUserRecordInput,
	UpsertCredentialAccountInput,
	UserRepository,
} from "@/repositories/users";

interface InMemoryRepo extends UserRepository {
	credentials: Map<string, string>;
	users: Map<string, AdminUser>;
}

function createInMemoryRepo(): InMemoryRepo {
	const users = new Map<string, AdminUser>();
	const credentials = new Map<string, string>();

	function nowIso() {
		return new Date().toISOString();
	}

	function build(input: CreateUserRecordInput): AdminUser {
		return {
			accountsCount: 0,
			createdAt: nowIso(),
			email: input.email,
			emailVerified: input.emailVerified ?? false,
			hasPassword: false,
			id: input.id,
			image: input.image ?? null,
			name: input.name,
			sessionsCount: 0,
			updatedAt: nowIso(),
		};
	}

	const repo: InMemoryRepo = {
		credentials,
		users,
		create(input) {
			const entry = build(input);
			users.set(entry.id, entry);
			return Promise.resolve(entry);
		},
		delete(id) {
			const existing = users.get(id) ?? null;
			if (existing) {
				users.delete(id);
				credentials.delete(id);
			}
			return Promise.resolve(existing);
		},
		getByEmail(email) {
			const found = [...users.values()].find((entry) => entry.email === email);
			return Promise.resolve(found ?? null);
		},
		getById(id) {
			return Promise.resolve(users.get(id) ?? null);
		},
		list() {
			return Promise.resolve([...users.values()]);
		},
		update(id, patch: UpdateUserRecordInput) {
			const existing = users.get(id);
			if (!existing) {
				return Promise.resolve(null);
			}
			const updated: AdminUser = {
				...existing,
				email: patch.email ?? existing.email,
				emailVerified: patch.emailVerified ?? existing.emailVerified,
				image: patch.image === undefined ? existing.image : patch.image,
				name: patch.name ?? existing.name,
				updatedAt: nowIso(),
			};
			users.set(id, updated);
			return Promise.resolve(updated);
		},
		upsertCredentialAccount(input: UpsertCredentialAccountInput) {
			credentials.set(input.userId, input.password);
			const existing = users.get(input.userId);
			if (existing) {
				users.set(input.userId, {
					...existing,
					accountsCount: 1,
					hasPassword: true,
				});
			}
			return Promise.resolve();
		},
	};

	return repo;
}

function createService(repo: UserRepository) {
	let counter = 0;
	return new UsersService({
		generateId: () => `id-${++counter}`,
		hashPasswordImpl: (password) => Promise.resolve(`hashed:${password}`),
		repository: repo,
	});
}

describe("UsersService", () => {
	let repo: InMemoryRepo;
	let service: UsersService;

	beforeEach(() => {
		repo = createInMemoryRepo();
		service = createService(repo);
	});

	it("creates a user with a hashed credential account", async () => {
		const user = await service.create({
			email: "Alice@Example.com",
			name: "Alice",
			password: "supersecret",
		});

		expect(user.email).toBe("alice@example.com");
		expect(user.name).toBe("Alice");
		expect(user.hasPassword).toBe(true);
		expect(repo.credentials.get(user.id)).toBe("hashed:supersecret");
	});

	it("rejects duplicate emails", async () => {
		await service.create({
			email: "alice@example.com",
			name: "Alice",
			password: "supersecret",
		});

		await expect(
			service.create({
				email: "ALICE@example.com",
				name: "Other Alice",
				password: "anothersecret",
			})
		).rejects.toBeInstanceOf(UsersServiceError);
	});

	it("validates password length", async () => {
		await expect(
			service.create({
				email: "bob@example.com",
				name: "Bob",
				password: "short",
			})
		).rejects.toBeInstanceOf(UsersServiceError);
	});

	it("updates name and email but rejects email collisions", async () => {
		const alice = await service.create({
			email: "alice@example.com",
			name: "Alice",
			password: "supersecret",
		});
		await service.create({
			email: "bob@example.com",
			name: "Bob",
			password: "supersecret",
		});

		const updated = await service.update(alice.id, {
			name: "  Alice Updated  ",
			emailVerified: true,
		});
		expect(updated?.name).toBe("Alice Updated");
		expect(updated?.emailVerified).toBe(true);

		await expect(
			service.update(alice.id, { email: "bob@example.com" })
		).rejects.toBeInstanceOf(UsersServiceError);
	});

	it("resets the password and refreshes the credential account", async () => {
		const alice = await service.create({
			email: "alice@example.com",
			name: "Alice",
			password: "supersecret",
		});

		const result = await service.resetPassword(alice.id, "newpassword");
		expect(result?.hasPassword).toBe(true);
		expect(repo.credentials.get(alice.id)).toBe("hashed:newpassword");
	});

	it("returns null when resetting password for unknown user", async () => {
		const result = await service.resetPassword("missing", "newpassword");
		expect(result).toBeNull();
	});

	it("deletes the user", async () => {
		const alice = await service.create({
			email: "alice@example.com",
			name: "Alice",
			password: "supersecret",
		});

		const deleted = await service.delete(alice.id);
		expect(deleted?.id).toBe(alice.id);
		expect(repo.users.has(alice.id)).toBe(false);
	});
});
