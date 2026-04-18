import { randomUUID } from "node:crypto";
import type {
	AdminUser,
	CreateAdminUserInput,
	ListAdminUsersQuery,
	UpdateAdminUserInput,
} from "@generator/contracts/admin";
import { hashPassword } from "better-auth/crypto";

import type { UserRepository } from "@/repositories/users";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

export class UsersServiceError extends Error {
	readonly status: number;

	constructor(message: string, status = 400) {
		super(message);
		this.name = "UsersServiceError";
		this.status = status;
	}
}

interface UsersServiceDeps {
	generateId?: () => string;
	hashPasswordImpl?: (password: string) => Promise<string>;
	repository: UserRepository;
}

function normalizeEmail(value: string): string {
	return value.trim().toLowerCase();
}

function assertEmail(email: string): void {
	if (!emailPattern.test(email)) {
		throw new UsersServiceError("Invalid email address");
	}
}

function assertPassword(password: string): void {
	if (
		password.length < MIN_PASSWORD_LENGTH ||
		password.length > MAX_PASSWORD_LENGTH
	) {
		throw new UsersServiceError(
			`Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`
		);
	}
}

function assertName(name: string): void {
	if (!name) {
		throw new UsersServiceError("Name is required");
	}
}

export class UsersService {
	private readonly generateId: () => string;
	private readonly hashPasswordImpl: (password: string) => Promise<string>;
	private readonly repository: UserRepository;

	constructor(deps: UsersServiceDeps) {
		this.generateId = deps.generateId ?? (() => randomUUID());
		this.hashPasswordImpl = deps.hashPasswordImpl ?? hashPassword;
		this.repository = deps.repository;
	}

	list(query: ListAdminUsersQuery = {}): Promise<AdminUser[]> {
		return this.repository.list({ search: query.search });
	}

	getById(id: string): Promise<AdminUser | null> {
		return this.repository.getById(id);
	}

	async create(input: CreateAdminUserInput): Promise<AdminUser> {
		const name = input.name.trim();
		const email = normalizeEmail(input.email);
		assertName(name);
		assertEmail(email);
		assertPassword(input.password);

		const existing = await this.repository.getByEmail(email);
		if (existing) {
			throw new UsersServiceError("User with this email already exists", 409);
		}

		const id = this.generateId();
		const created = await this.repository.create({
			email,
			emailVerified: input.emailVerified ?? false,
			id,
			image: input.image ?? null,
			name,
		});
		const passwordHash = await this.hashPasswordImpl(input.password);
		await this.repository.upsertCredentialAccount({
			id: this.generateId(),
			password: passwordHash,
			userId: id,
		});
		return {
			...created,
			hasPassword: true,
		};
	}

	async update(
		id: string,
		patch: UpdateAdminUserInput
	): Promise<AdminUser | null> {
		const updates: UpdateAdminUserInput = {};
		if (patch.name !== undefined) {
			const name = patch.name.trim();
			assertName(name);
			updates.name = name;
		}
		if (patch.email !== undefined) {
			const email = normalizeEmail(patch.email);
			assertEmail(email);
			const existing = await this.repository.getByEmail(email);
			if (existing && existing.id !== id) {
				throw new UsersServiceError(
					"Another user already uses this email",
					409
				);
			}
			updates.email = email;
		}
		if (patch.emailVerified !== undefined) {
			updates.emailVerified = patch.emailVerified;
		}
		if (patch.image !== undefined) {
			updates.image = patch.image;
		}
		if (Object.keys(updates).length === 0) {
			return this.repository.getById(id);
		}
		return this.repository.update(id, updates);
	}

	async resetPassword(id: string, password: string): Promise<AdminUser | null> {
		assertPassword(password);
		const existing = await this.repository.getById(id);
		if (!existing) {
			return null;
		}
		const passwordHash = await this.hashPasswordImpl(password);
		await this.repository.upsertCredentialAccount({
			id: this.generateId(),
			password: passwordHash,
			userId: id,
		});
		return {
			...existing,
			hasPassword: true,
		};
	}

	delete(id: string): Promise<AdminUser | null> {
		return this.repository.delete(id);
	}
}
