import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
	dotenv.config({
		path: "../../apps/generator/.env",
	});
}

export default defineConfig({
	schema: "./src/schema",
	out: "./src/migrations",
	dialect: "postgresql",
	dbCredentials: {
		url: process.env.DATABASE_URL || "",
	},
});
