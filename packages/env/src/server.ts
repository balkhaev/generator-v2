import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    COMFY_OPERATOR_ENABLED: z.enum(["true", "false"]).optional(),
    RUNPOD_API_KEY: z.string().min(1).optional(),
    RUNPOD_ENDPOINT_ID: z.string().min(1).optional(),
    RUNPOD_API_BASE_URL: z.url().optional(),
    COMFY_INPUT_BASE_URL: z.url().optional(),
    COMFY_OUTPUT_BASE_URL: z.url().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

const operatorEnvSchema = z.object({
  COMFY_OPERATOR_ENABLED: z.enum(["true", "false"]).default("true"),
  RUNPOD_API_KEY: z.string().min(1, "RUNPOD_API_KEY is required"),
  RUNPOD_ENDPOINT_ID: z.string().min(1, "RUNPOD_ENDPOINT_ID is required"),
  RUNPOD_API_BASE_URL: z.url().default("https://api.runpod.ai/v2"),
  COMFY_INPUT_BASE_URL: z.url().default("https://assets.example.com/input"),
  COMFY_OUTPUT_BASE_URL: z.url().default("https://assets.example.com/output"),
});

export type ComfyOperatorEnv = z.infer<typeof operatorEnvSchema>;

export function getComfyOperatorEnv(runtimeEnv: Record<string, string | undefined> = process.env) {
  return operatorEnvSchema.parse(runtimeEnv);
}
