import type { AdminUser } from "@generator/contracts/admin";
import { db } from "@generator/db";
import { and, desc, eq, ilike, or, sql } from "@generator/db/operators";
import { account, session, user } from "@generator/db/schema/auth";

type Db = typeof db;

type UserRow = typeof user.$inferSelect;

interface UserListRow extends UserRow {
	accountsCount: number;
	hasPassword: boolean;
	sessionsCount: number;
}

function mapUser(row: UserListRow): AdminUser {
	return {
		accountsCount: row.accountsCount,
		createdAt: row.createdAt.toISOString(),
		email: row.email,
		emailVerified: row.emailVerified,
		hasPassword: row.hasPassword,
		id: row.id,
		image: row.image,
		name: row.name,
		sessionsCount: row.sessionsCount,
		updatedAt: row.updatedAt.toISOString(),
	};
}

export interface ListUsersFilter {
	search?: string;
}

export interface CreateUserRecordInput {
	email: string;
	emailVerified?: boolean;
	id: string;
	image?: string | null;
	name: string;
}

export interface UpdateUserRecordInput {
	email?: string;
	emailVerified?: boolean;
	image?: string | null;
	name?: string;
}

export interface UpsertCredentialAccountInput {
	id: string;
	password: string;
	userId: string;
}

export interface UserRepository {
	create(input: CreateUserRecordInput): Promise<AdminUser>;
	delete(id: string): Promise<AdminUser | null>;
	getByEmail(email: string): Promise<AdminUser | null>;
	getById(id: string): Promise<AdminUser | null>;
	list(filter: ListUsersFilter): Promise<AdminUser[]>;
	update(id: string, patch: UpdateUserRecordInput): Promise<AdminUser | null>;
	upsertCredentialAccount(input: UpsertCredentialAccountInput): Promise<void>;
}

const CREDENTIAL_PROVIDER_ID = "credential";

function buildAggregatedSelect(database: Db) {
	return database
		.select({
			accountsCount: sql<number>`coalesce(count(distinct ${account.id}), 0)::int`,
			createdAt: user.createdAt,
			email: user.email,
			emailVerified: user.emailVerified,
			hasPassword: sql<boolean>`bool_or(${account.providerId} = ${CREDENTIAL_PROVIDER_ID} and ${account.password} is not null)`,
			id: user.id,
			image: user.image,
			name: user.name,
			sessionsCount: sql<number>`coalesce(count(distinct ${session.id}), 0)::int`,
			updatedAt: user.updatedAt,
		})
		.from(user)
		.leftJoin(account, eq(account.userId, user.id))
		.leftJoin(session, eq(session.userId, user.id))
		.groupBy(user.id);
}

function normalizeAggregatedRow(row: {
	accountsCount: number | string;
	createdAt: Date;
	email: string;
	emailVerified: boolean;
	hasPassword: boolean | null;
	id: string;
	image: string | null;
	name: string;
	sessionsCount: number | string;
	updatedAt: Date;
}): UserListRow {
	return {
		accountsCount: Number(row.accountsCount ?? 0),
		createdAt: row.createdAt,
		email: row.email,
		emailVerified: row.emailVerified,
		hasPassword: Boolean(row.hasPassword),
		id: row.id,
		image: row.image,
		name: row.name,
		sessionsCount: Number(row.sessionsCount ?? 0),
		updatedAt: row.updatedAt,
	};
}

export function createDrizzleUserRepository(database: Db = db): UserRepository {
	return {
		async create(input) {
			const [row] = await database
				.insert(user)
				.values({
					email: input.email,
					emailVerified: input.emailVerified ?? false,
					id: input.id,
					image: input.image ?? null,
					name: input.name,
				})
				.returning();
			if (!row) {
				throw new Error("Failed to create user record");
			}
			return mapUser({
				...row,
				accountsCount: 0,
				hasPassword: false,
				sessionsCount: 0,
			});
		},
		async delete(id) {
			const before = await this.getById(id);
			if (!before) {
				return null;
			}
			await database.delete(user).where(eq(user.id, id));
			return before;
		},
		async getByEmail(email) {
			const rows = await buildAggregatedSelect(database).where(
				eq(user.email, email)
			);
			const row = rows[0];
			return row ? mapUser(normalizeAggregatedRow(row)) : null;
		},
		async getById(id) {
			const rows = await buildAggregatedSelect(database).where(eq(user.id, id));
			const row = rows[0];
			return row ? mapUser(normalizeAggregatedRow(row)) : null;
		},
		async list(filter) {
			const trimmed = filter.search?.trim();
			const baseQuery = buildAggregatedSelect(database);
			const filtered = trimmed
				? baseQuery.where(
						and(
							or(
								ilike(user.email, `%${trimmed}%`),
								ilike(user.name, `%${trimmed}%`)
							)
						)
					)
				: baseQuery;
			const rows = await filtered.orderBy(desc(user.createdAt));
			return rows.map((row) => mapUser(normalizeAggregatedRow(row)));
		},
		async update(id, patch) {
			const updates: Partial<UserRow> = {};
			if (patch.name !== undefined) {
				updates.name = patch.name;
			}
			if (patch.email !== undefined) {
				updates.email = patch.email;
			}
			if (patch.emailVerified !== undefined) {
				updates.emailVerified = patch.emailVerified;
			}
			if (patch.image !== undefined) {
				updates.image = patch.image;
			}
			if (Object.keys(updates).length > 0) {
				const [updated] = await database
					.update(user)
					.set(updates)
					.where(eq(user.id, id))
					.returning({ id: user.id });
				if (!updated) {
					return null;
				}
			}
			return this.getById(id);
		},
		async upsertCredentialAccount(input) {
			const existing = await database
				.select({ id: account.id })
				.from(account)
				.where(
					and(
						eq(account.userId, input.userId),
						eq(account.providerId, CREDENTIAL_PROVIDER_ID)
					)
				)
				.limit(1);
			const existingRow = existing[0];
			if (existingRow) {
				await database
					.update(account)
					.set({ password: input.password })
					.where(eq(account.id, existingRow.id));
				return;
			}
			await database.insert(account).values({
				accountId: input.userId,
				id: input.id,
				password: input.password,
				providerId: CREDENTIAL_PROVIDER_ID,
				updatedAt: new Date(),
				userId: input.userId,
			});
		},
	};
}
