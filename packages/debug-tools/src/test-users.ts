const allowedTestEmailDomains = new Set([
	"example.com",
	"example.test",
	"local.dev",
	"test.local",
]);
const allowedTestEmailLocalPartPattern =
	/^(codex|debug|e2e|qa|test)([+._-]|$)/i;
const plusTaggedTestEmailPattern = /\+(?:codex|debug|e2e|qa|test)\b/i;

interface CredentialAccountRecord {
	id?: string;
	providerId: string;
}

interface SessionRecord {
	id?: string;
}

interface UserRow {
	createdAt: Date;
	email: string;
	emailVerified: boolean;
	id: string;
	name: string;
	updatedAt: Date;
}

interface UserRowWithAccounts extends UserRow {
	accounts?: CredentialAccountRecord[];
}

interface InternalAdapterLike {
	createAccount: (input: {
		accountId: string;
		createdAt: Date;
		id: string;
		password: string;
		providerId: "credential";
		updatedAt: Date;
		userId: string;
	}) => Promise<unknown>;
	createUser: (input: {
		email: string;
		emailVerified: boolean;
		image: string;
		name: string;
	}) => Promise<UserRow | null>;
	findAccountByUserId: (userId: string) => Promise<CredentialAccountRecord[]>;
	findUserByEmail: (
		email: string,
		options?: { includeAccounts?: boolean }
	) => Promise<UserRowWithAccounts | null>;
	findUserById: (userId: string) => Promise<UserRow | null>;
	listSessions?: (userId: string) => Promise<SessionRecord[]>;
	updatePassword: (userId: string, passwordHash: string) => Promise<unknown>;
	updateUser: (
		userId: string,
		input: {
			emailVerified: boolean;
			name: string;
		}
	) => Promise<UserRow | null>;
}

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

function listAdapterSessions(
	adapter: InternalAdapterLike,
	userId: string
): Promise<SessionRecord[]> {
	if (typeof adapter.listSessions === "function") {
		return adapter.listSessions(userId);
	}

	return Promise.resolve([]);
}

async function loadStoredUser(
	adapter: InternalAdapterLike,
	userRow: UserRowWithAccounts | UserRow
): Promise<StoredTestUser> {
	const credentialAccounts =
		"accounts" in userRow && Array.isArray(userRow.accounts)
			? userRow.accounts
			: await adapter.findAccountByUserId(userRow.id);
	const sessionRows = await listAdapterSessions(adapter, userRow.id);

	return {
		hasCredentialAccount: credentialAccounts.some(
			(entry: CredentialAccountRecord) => entry.providerId === "credential"
		),
		sessionCount: sessionRows.length,
		user: userRow,
	};
}

async function getAuthAdapter() {
	const authModule = await import("@generator/auth");
	const authContext = await authModule.auth.$context;
	return authContext.internalAdapter as unknown as InternalAdapterLike;
}

const defaultStore: TestUserStore = {
	async create(input) {
		const adapter = await getAuthAdapter();
		const createdUser = await adapter.createUser({
			email: input.email,
			emailVerified: input.emailVerified,
			image: "",
			name: input.name,
		});

		if (!createdUser) {
			throw new Error("Failed to create test user");
		}

		const now = new Date();
		await adapter.createAccount({
			accountId: createdUser.id,
			createdAt: now,
			id: crypto.randomUUID(),
			password: input.passwordHash,
			providerId: "credential",
			updatedAt: now,
			userId: createdUser.id,
		});

		return loadStoredUser(adapter, createdUser);
	},
	async getByEmail(email) {
		const adapter = await getAuthAdapter();
		const userRow = await adapter.findUserByEmail(email, {
			includeAccounts: true,
		});

		return userRow ? loadStoredUser(adapter, userRow) : null;
	},
	async getById(userId) {
		const adapter = await getAuthAdapter();
		const userRow = await adapter.findUserById(userId);
		return userRow ? loadStoredUser(adapter, userRow) : null;
	},
	async update(input) {
		const adapter = await getAuthAdapter();
		const updatedUser = await adapter.updateUser(input.userId, {
			emailVerified: input.emailVerified,
			name: input.name,
		});

		if (!updatedUser) {
			throw new Error("Test user not found");
		}

		const credentialAccounts = await adapter.findAccountByUserId(input.userId);
		if (credentialAccounts.some((entry) => entry.providerId === "credential")) {
			await adapter.updatePassword(input.userId, input.passwordHash);
		} else {
			const now = new Date();
			await adapter.createAccount({
				accountId: input.userId,
				createdAt: now,
				id: crypto.randomUUID(),
				password: input.passwordHash,
				providerId: "credential",
				updatedAt: now,
				userId: input.userId,
			});
		}

		return loadStoredUser(adapter, updatedUser);
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
