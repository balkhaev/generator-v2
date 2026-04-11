import "dotenv/config";
import { z } from "zod";

const optionalUrlSchema = z.preprocess((value) => {
	if (typeof value !== "string") {
		return value;
	}

	const trimmedValue = value.trim();
	return trimmedValue.length > 0 ? trimmedValue : undefined;
}, z.url().optional());

const envSchema = z.object({
	DATABASE_URL: z.string().min(1),
	CORS_ORIGIN: z.url(),
	GENERATOR_CALLBACK_TOKEN: z
		.string()
		.min(1)
		.default("local-generator-callback-token"),
	PERSONS_ADMIN_URL: optionalUrlSchema,
	PERSONS_BASE_URL: optionalUrlSchema,
	PERSONS_OPERATOR_URL: optionalUrlSchema,
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	PORT: z.coerce.number().int().positive().default(3003),
	TRAINING_CONTROL_TOKEN: z
		.string()
		.min(1)
		.default("local-training-control-token"),
	PERSONS_DEFAULT_AVATAR_WORKFLOW: z
		.string()
		.min(1)
		.default("fal-zimage-turbo"),
	PERSONS_DEFAULT_LORA_WORKFLOW: z
		.string()
		.min(1)
		.default("fal-zimage-turbo-lora"),
});

export const env = envSchema.parse(process.env);
