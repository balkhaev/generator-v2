import { db } from "@generator/db";
import { account, session, user } from "@generator/db/schema/auth";
import { and, eq } from "drizzle-orm";

const allowedTestEmailDomains = new Set([
	"example.com",
	"example.test",
	"local.dev",
	"test.local",
]);
const allowedTestEmailLocalPartPattern =
	/^(codex|debug|e2e|qa|test)([+._-]|$)/i;
const plusTaggedTestEmailPattern = /\+(?:codex|debug|e2e|qa|test)\b/i;

type UserRow = typeof user.$inferSelect;

interface StoredTestUser {
	hasCredentialAccount: boolean;
	sessionCount: number;
	user: UserRow;
}

interface TestUserStore {
	create(input: {
		email: string;
		emailVerified: boolean;
		name: string;
		passwordHash: string;
	}): Promise<StoredTestUser>;
	getByEmail(email: string): Promise<StoredTestUser | null>;
	getById(userId: string): Promise<StoredTestUser | null>;
	update(input: {
		emailVerified: boolean;
		name: string;
		passwordHash: string;
		userId: string;
	}): Promise<StoredTestUser>;
}

export interface TestUserInfo {
	createdAt: string;
	email: string;
	emailVerified: boolean;
	hasCredentialAccount: boolean;
	id: string;
	name: string;
	sessionCount: number;
	updatedAt: string;
}

export interface GetTestUserInput {
	email?: string;
	userId?: string;
}

export interface UpsertTestUserInput {
	email: string;
	emailVerified?: boolean;
	name?: string;
	password: string;
}

export interface UpsertTestUserResult {
	operation: "created" | "updated";
	user: TestUserInfo;
}

interface TestUserDependencies {
	hashPassword: (password: string) => Promise<string>;
	store: TestUserStore;
}

function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

function formatTestUserInfo(record: StoredTestUser): TestUserInfo {
	return {
		createdAt: record.user.createdAt.toISOString(),
		email: record.user.email,
		emailVerified: record.user.emailVerified,
		hasCredentialAccount: record.hasCredentialAccount,
		id: record.user.id,
		name: record.user.name,
		sessionCount: record.sessionCount,
		updatedAt: record.user.updatedAt.toISOString(),
	};
}

function assertNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${field} is required`);
	}

	return value.trim();
}

function deriveDefaultName(email: string) {
	const [localPart = "test-user"] = normalizeEmail(email).split("@");
	const cleanedLocalPart = localPart
		.replace(plusTaggedTestEmailPattern, "")
		.replace(/[._+-]+/g, " ")
		.trim();

	return cleanedLocalPart.length > 0
		? `Test User ${cleanedLocalPart}`
		: "Test User";
}

export function isAllowedTestUserEmail(email: string) {
	const normalizedEmail = normalizeEmail(email);
	const [localPart, domain] = normalizedEmail.split("@");

	if (!(localPart && domain)) {
		return false;
	}

	return (
		allowedTestEmailDomains.has(domain) ||
		allowedTestEmailLocalPartPattern.test(localPart) ||
		plusTaggedTestEmailPattern.test(localPart)
	);
}

function assertAllowedTestUserEmail(email: string) {
	if (!isAllowedTestUserEmail(email)) {
		throw new Error(
			"Only explicit test emails are allowed (example.com/example.test/local.dev/test.local or test-prefixed local parts)"
		);
	}
}

async function defaultHashPassword(password: string) {
	const authModule = await import("@generator/auth");
	const authContext = await authModule.auth.$context;
	return authContext.password.hash(password);
}

async function getStoredUserBy<K extends "email" | "id">(input: {
	field: K;
	value: string;
}): Promise<StoredTestUser | null> {
	const [userRow] = await db
		.select()
		.from(user)
		.where(
			input.field === "email"
				? eq(user.email, input.value)
				: eq(user.id, input.value)
		);

	if (!userRow) {
		return null;
	}

	const credentialAccounts = await db
		.select()
		.from(account)
		.where(
			and(eq(account.userId, userRow.id), eq(account.providerId, "credential"))
		);
	const sessionRows = await db
		.select()
		.from(session)
		.where(eq(session.userId, userRow.id));

	return {
		hasCredentialAccount: credentialAccounts.some(
			(entry) => entry.providerId === "credential"
		),
		sessionCount: sessionRows.length,
		user: userRow,
	};
}

const defaultStore: TestUserStore = {
	create(input) {
		return db.transaction(async (transaction) => {
			const now = new Date();
			const [createdUserRow] = await transaction
				.insert(user)
				.values({
					email: input.email,
					emailVerified: input.emailVerified,
					id: crypto.randomUUID(),
					image: "",
					name: input.name,
					updatedAt: now,
				})
				.returning();

			if (!createdUserRow) {
				throw new Error("Failed to create test user");
			}

			await transaction.insert(account).values({
				accountId: createdUserRow.id,
				createdAt: now,
				id: crypto.randomUUID(),
				password: input.passwordHash,
				providerId: "credential",
				updatedAt: now,
				userId: createdUserRow.id,
			});

			return {
				hasCredentialAccount: true,
				sessionCount: 0,
				user: createdUserRow,
			};
		});
	},
	getByEmail(email) {
		return getStoredUserBy({ field: "email", value: email });
	},
	getById(userId) {
		return getStoredUserBy({ field: "id", value: userId });
	},
	update(input) {
		return db.transaction(async (transaction) => {
			const [updatedUserRow] = await transaction
				.update(user)
				.set({
					emailVerified: input.emailVerified,
					name: input.name,
					updatedAt: new Date(),
				})
				.where(eq(user.id, input.userId))
				.returning();

			if (!updatedUserRow) {
				throw new Error("Test user not found");
			}

			const credentialAccounts = await transaction
				.select()
				.from(account)
				.where(
					and(
						eq(account.userId, input.userId),
						eq(account.providerId, "credential")
					)
				);

			if (credentialAccounts.length > 0) {
				const credentialAccountId = credentialAccounts[0]?.id;
				if (!credentialAccountId) {
					throw new Error("Credential account is missing an id");
				}

				await transaction
					.update(account)
					.set({
						password: input.passwordHash,
						updatedAt: new Date(),
					})
					.where(eq(account.id, credentialAccountId));
			} else {
				const now = new Date();
				await transaction.insert(account).values({
					accountId: input.userId,
					createdAt: now,
					id: crypto.randomUUID(),
					password: input.passwordHash,
					providerId: "credential",
					updatedAt: now,
					userId: input.userId,
				});
			}

			const sessionRows = await transaction
				.select()
				.from(session)
				.where(eq(session.userId, input.userId));

			return {
				hasCredentialAccount: true,
				sessionCount: sessionRows.length,
				user: updatedUserRow,
			};
		});
	},
};

function resolveDependencies(
	dependencies?: Partial<TestUserDependencies>
): TestUserDependencies {
	return {
		hashPassword: dependencies?.hashPassword ?? defaultHashPassword,
		store: dependencies?.store ?? defaultStore,
	};
}

export async function getTestUser(
	input: GetTestUserInput,
	dependencies?: Partial<TestUserDependencies>
): Promise<TestUserInfo | null> {
	const store = resolveDependencies(dependencies).store;

	if (typeof input.email === "string" && input.email.trim().length > 0) {
		const email = normalizeEmail(input.email);
		assertAllowedTestUserEmail(email);
		const record = await store.getByEmail(email);
		return record ? formatTestUserInfo(record) : null;
	}

	if (typeof input.userId === "string" && input.userId.trim().length > 0) {
		const record = await store.getById(input.userId.trim());
		if (!record) {
			return null;
		}

		assertAllowedTestUserEmail(record.user.email);
		return formatTestUserInfo(record);
	}

	throw new Error("email or userId is required");
}

export async function upsertTestUser(
	input: UpsertTestUserInput,
	dependencies?: Partial<TestUserDependencies>
): Promise<UpsertTestUserResult> {
	const email = normalizeEmail(assertNonEmptyString(input.email, "email"));
	const password = assertNonEmptyString(input.password, "password");
	const name =
		typeof input.name === "string" && input.name.trim().length > 0
			? input.name.trim()
			: deriveDefaultName(email);
	const emailVerified = input.emailVerified ?? true;

	assertAllowedTestUserEmail(email);

	const { hashPassword, store } = resolveDependencies(dependencies);
	const passwordHash = await hashPassword(password);
	const existingUser = await store.getByEmail(email);

	if (!existingUser) {
		const createdUser = await store.create({
			email,
			emailVerified,
			name,
			passwordHash,
		});

		return {
			operation: "created",
			user: formatTestUserInfo(createdUser),
		};
	}

	const updatedUser = await store.update({
		emailVerified,
		name,
		passwordHash,
		userId: existingUser.user.id,
	});

	return {
		operation: "updated",
		user: formatTestUserInfo(updatedUser),
	};
}
