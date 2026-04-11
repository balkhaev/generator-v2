import { ZodError } from "zod";

export function toErrorResponse(error: unknown) {
	if (error instanceof ZodError) {
		return {
			body: {
				error: "ValidationError",
				issues: error.issues,
			},
			status: 400,
		};
	}

	return {
		body: {
			error:
				error instanceof Error ? error.message : "Unexpected request error",
		},
		status: 400,
	};
}
