import type { Context, MiddlewareHandler } from "hono";

export interface SessionPayload {
	session: unknown;
	user: unknown;
}

export interface AuthVariables {
	session: unknown | null;
	user: unknown | null;
}

type PublicPathCheck = (path: string) => boolean;

interface SessionMiddlewareOptions {
	getSession: (request: Request) => Promise<SessionPayload | null>;
	isPublicPath?: PublicPathCheck;
}

export function createSessionMiddleware(
	options: SessionMiddlewareOptions
): MiddlewareHandler {
	return async (c: Context, next) => {
		const session = await options.getSession(c.req.raw);
		c.set("session", session?.session ?? null);
		c.set("user", session?.user ?? null);

		if (c.req.method === "OPTIONS") {
			await next();
			return;
		}

		if (options.isPublicPath?.(c.req.path)) {
			await next();
			return;
		}

		if (!session?.user) {
			return c.body(null, 401);
		}

		await next();
	};
}

export function createAuthHandler(
	authHandler: (request: Request) => Response | Promise<Response>
) {
	return (c: Context) => authHandler(c.req.raw);
}
