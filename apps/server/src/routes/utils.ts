import { ZodError } from "zod";

export function toErrorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: "ValidationError",
        issues: error.issues,
      },
    };
  }

  return {
    status: 400,
    body: {
      error: error instanceof Error ? error.message : "Unexpected request error",
    },
  };
}
