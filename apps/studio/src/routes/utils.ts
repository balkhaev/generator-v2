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
			body: {
				error: "ValidationError",
				issues: error.issues,
			},
			status: 400 as const,
		};
	}

	if (error instanceof BadRequestError) {
		return {
			body: { error: error.message },
			status: 400 as const,
		};
	}

	if (error instanceof NotFoundError) {
		return {
			body: { error: error.message },
			status: 404 as const,
		};
	}

	return {
		body: {
			error:
				error instanceof Error ? error.message : "Unexpected request error",
		},
		status: 500 as const,
	};
}
