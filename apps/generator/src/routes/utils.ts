import { ZodError } from "zod";

export class BadRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BadRequestError";
	}
}

export class NotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NotFoundError";
	}
}

export function toErrorResponse(error: unknown) {
	if (error instanceof ZodError) {
		return {
			status: 400 as const,
			body: {
				error: "ValidationError",
				issues: error.issues,
			},
		};
	}

	if (error instanceof BadRequestError) {
		return {
			status: 400 as const,
			body: { error: error.message },
		};
	}

	if (error instanceof NotFoundError) {
		return {
			status: 404 as const,
			body: { error: error.message },
		};
	}

	return {
		status: 500 as const,
		body: {
			error:
				error instanceof Error ? error.message : "Unexpected request error",
		},
	};
}
