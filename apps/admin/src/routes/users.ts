import type { AuthVariables } from "@generator/auth/middleware";
import type {
	CreateAdminUserInput,
	ListAdminUsersQuery,
	ResetAdminUserPasswordInput,
	UpdateAdminUserInput,
} from "@generator/contracts/admin";
import { Hono } from "hono";

import { type UsersService, UsersServiceError } from "@/domain/users";
import { toErrorResponse } from "@/routes/utils";

function parseListQuery(c: {
	req: { query(key: string): string | undefined };
}): ListAdminUsersQuery {
	const search = c.req.query("search")?.trim();
	return search ? { search } : {};
}

function expectObject(body: unknown): Record<string, unknown> {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new UsersServiceError("Invalid request body");
	}
	return body as Record<string, unknown>;
}

function readString(value: unknown, field: string): string {
	if (typeof value !== "string") {
		throw new UsersServiceError(`${field} is required`);
	}
	return value;
}

function parseCreateBody(body: unknown): CreateAdminUserInput {
	const payload = expectObject(body);
	return {
		email: readString(payload.email, "email"),
		emailVerified:
			typeof payload.emailVerified === "boolean"
				? payload.emailVerified
				: undefined,
		image: typeof payload.image === "string" ? payload.image : undefined,
		name: readString(payload.name, "name"),
		password: readString(payload.password, "password"),
	};
}

function parseUpdateBody(body: unknown): UpdateAdminUserInput {
	const payload = expectObject(body);
	const patch: UpdateAdminUserInput = {};
	if (typeof payload.name === "string") {
		patch.name = payload.name;
	}
	if (typeof payload.email === "string") {
		patch.email = payload.email;
	}
	if (typeof payload.emailVerified === "boolean") {
		patch.emailVerified = payload.emailVerified;
	}
	if (typeof payload.image === "string" || payload.image === null) {
		patch.image = payload.image as string | null;
	}
	return patch;
}

function parseResetPasswordBody(body: unknown): ResetAdminUserPasswordInput {
	const payload = expectObject(body);
	return {
		password: readString(payload.password, "password"),
	};
}

function toRouteError(error: unknown) {
	if (error instanceof UsersServiceError) {
		return {
			body: { error: error.message },
			status: error.status,
		};
	}
	return toErrorResponse(error);
}

export function createAdminUserRoutes(service: UsersService) {
	const app = new Hono<{ Variables: AuthVariables }>();

	app.get("/", async (c) => {
		const users = await service.list(parseListQuery(c));
		return c.json({ users });
	});

	app.post("/", async (c) => {
		try {
			const input = parseCreateBody(await c.req.json());
			const user = await service.create(input);
			return c.json({ user }, 201);
		} catch (error) {
			const response = toRouteError(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.get("/:id", async (c) => {
		const user = await service.getById(c.req.param("id"));
		return user ? c.json({ user }) : c.json({ error: "User not found" }, 404);
	});

	app.patch("/:id", async (c) => {
		try {
			const patch = parseUpdateBody(await c.req.json());
			const user = await service.update(c.req.param("id"), patch);
			return user ? c.json({ user }) : c.json({ error: "User not found" }, 404);
		} catch (error) {
			const response = toRouteError(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.post("/:id/password", async (c) => {
		try {
			const input = parseResetPasswordBody(await c.req.json());
			const user = await service.resetPassword(
				c.req.param("id"),
				input.password
			);
			return user ? c.json({ user }) : c.json({ error: "User not found" }, 404);
		} catch (error) {
			const response = toRouteError(error);
			return c.json(response.body, response.status as 400);
		}
	});

	app.delete("/:id", async (c) => {
		const id = c.req.param("id");
		const currentUser = c.get("user") as { id?: string } | null;
		if (currentUser?.id === id) {
			return c.json({ error: "You cannot delete your own account" }, 400);
		}
		const user = await service.delete(id);
		return user ? c.json({ user }) : c.json({ error: "User not found" }, 404);
	});

	return app;
}
