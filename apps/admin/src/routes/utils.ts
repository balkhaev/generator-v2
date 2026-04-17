import { ZodError } from "zod";

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message || error.name || "Unexpected request error";
	}
	if (typeof error === "string") {
		return error || "Unexpected request error";
	}
	return "Unexpected request error";
}

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
			error: getErrorMessage(error),
		},
		status: 400,
	};
}
