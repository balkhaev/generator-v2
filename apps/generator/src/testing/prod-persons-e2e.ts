/**
 * Production Persons E2E test — runs the full LoRA pipeline through the
 * production backend at balkhaev.com.
 *
 * Expects the following environment variables:
 *   PERSONS_API_URL   — e.g. https://persons-api.gen.balkhaev.com
 *   PERSONS_EMAIL     — account email
 *   PERSONS_PASSWORD  — account password
 *
 * Usage:
 *   PERSONS_API_URL=https://persons-api.gen.balkhaev.com \
 *   PERSONS_EMAIL=you@example.com \
 *   PERSONS_PASSWORD=secret \
 *   bun run apps/generator/src/testing/prod-persons-e2e.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const OUTPUT_DIR = resolve(process.cwd(), ".artifacts/prod-persons-e2e");
const POLL_INTERVAL_MS = 10_000;
const LORA_TRAINING_TIMEOUT_MS = 90 * 60_000;

function ts() {
	return new Date().toISOString().slice(11, 19);
}

function log(stage: string, message: string, data?: unknown) {
	const suffix = data ? ` ${JSON.stringify(data)}` : "";
	console.log(`[${ts()}] [${stage}] ${message}${suffix}`);
}

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required`);
	}
	return value;
}

const trailingSlashPattern = /\/+$/;

class PersonsApiClient {
	private readonly baseUrl: string;
	private sessionCookie = "";

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl.replace(trailingSlashPattern, "");
	}

	async signIn(email: string, password: string) {
		const response = await fetch(`${this.baseUrl}/api/auth/sign-in/email`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password }),
			redirect: "manual",
		});

		if (!response.ok && response.status !== 302) {
			const text = await response.text();
			throw new Error(`Sign-in failed (${response.status}): ${text}`);
		}

		const setCookieHeaders = response.headers.getSetCookie?.() ?? [];
		const allCookies: string[] = [];
		for (const header of setCookieHeaders) {
			const [cookiePart] = header.split(";");
			if (cookiePart) {
				allCookies.push(cookiePart);
			}
		}
		this.sessionCookie = allCookies.join("; ");

		if (!this.sessionCookie) {
			const body = await response.json().catch(() => ({}));
			const token =
				(body as Record<string, unknown>).token ??
				(body as Record<string, unknown>).sessionToken;
			if (typeof token === "string") {
				this.sessionCookie = `better-auth.session_token=${token}`;
			}
		}

		log("auth", "Signed in successfully", {
			hasCookie: Boolean(this.sessionCookie),
		});
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown
	): Promise<T> {
		const headers: Record<string, string> = {
			accept: "application/json",
		};
		if (this.sessionCookie) {
			headers.cookie = this.sessionCookie;
		}
		if (body !== undefined) {
			headers["content-type"] = "application/json";
		}

		const response = await fetch(`${this.baseUrl}${path}`, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(
				`API ${method} ${path} failed (${response.status}): ${text}`
			);
		}

		return (await response.json()) as T;
	}

	listPersons() {
		return this.request<{
			persons: Array<{
				id: string;
				name: string;
				slug: string;
				description: string;
				loraUrl?: string | null;
				referencePhotoUrl?: string;
				metadata: Record<string, unknown>;
				generations?: Array<{
					id: string;
					status: string;
					sourceUrl?: string;
					previewUrl?: string;
					prompt?: string;
				}>;
			}>;
		}>("GET", "/api/persons");
	}

	getPerson(personId: string) {
		return this.request<{
			person: {
				id: string;
				name: string;
				slug: string;
				description: string;
				loraUrl?: string | null;
				referencePhotoUrl?: string;
				metadata: Record<string, unknown>;
				generations?: Array<{
					id: string;
					status: string;
					sourceUrl?: string;
					previewUrl?: string;
					prompt?: string;
				}>;
			};
		}>("GET", `/api/persons/${personId}`);
	}

	createPersonFromPrompt(input: {
		name: string;
		prompt: string;
		slug?: string;
	}) {
		return this.request<{
			person: {
				id: string;
				name: string;
				slug: string;
				description: string;
				referencePhotoUrl?: string;
				metadata: Record<string, unknown>;
			};
		}>("POST", "/api/persons/from-prompt", input);
	}

	startLoraTraining(personId: string, input?: { referencePrompt?: string }) {
		return this.request<{
			person: {
				id: string;
				name: string;
				metadata: Record<string, unknown>;
			};
		}>("POST", `/api/persons/${personId}/train-lora`, input ?? {});
	}

	generateWithLora(
		personId: string,
		prompt: string,
		options?: { extraLoraUrl?: string; extraLoraWeight?: number }
	) {
		return this.request<{
			person: {
				id: string;
				generations?: Array<{
					id: string;
					status: string;
					sourceUrl?: string;
					previewUrl?: string;
					prompt?: string;
				}>;
			};
		}>("POST", `/api/persons/${personId}/generate-with-lora`, {
			prompt,
			...options,
		});
	}
}

async function downloadAndSave(url: string, path: string) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download ${url}: ${response.status}`);
	}
	const buffer = new Uint8Array(await response.arrayBuffer());
	await writeFile(path, buffer);
	return buffer.length;
}

async function waitForLoraTraining(
	client: PersonsApiClient,
	personId: string
): Promise<string> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < LORA_TRAINING_TIMEOUT_MS) {
		await sleep(POLL_INTERVAL_MS);
		const { person } = await client.getPerson(personId);
		const training = person.metadata.training as Record<string, unknown>;
		const phase = training?.phase as string | undefined;
		const progressPct = training?.progressPct as number | undefined;
		log("training", `phase=${phase} progress=${progressPct}%`);

		if (phase === "ready" && person.loraUrl) {
			return person.loraUrl;
		}
		if (phase === "failed") {
			throw new Error(
				`Training failed: ${training?.errorSummary ?? "unknown"}`
			);
		}
	}
	throw new Error("Training timed out");
}

async function waitForGeneration(
	client: PersonsApiClient,
	personId: string,
	generationId: string,
	timeoutMs = 5 * 60_000
): Promise<{ sourceUrl: string; previewUrl?: string }> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		await sleep(POLL_INTERVAL_MS);
		const { person } = await client.getPerson(personId);
		const gen = person.generations?.find((g) => g.id === generationId);
		if (!gen) {
			continue;
		}
		log("generation", `status=${gen.status}`);
		if (gen.status === "completed" && gen.sourceUrl) {
			return {
				sourceUrl: gen.sourceUrl,
				previewUrl: gen.previewUrl ?? undefined,
			};
		}
		if (gen.status === "failed") {
			throw new Error("Generation failed");
		}
	}
	throw new Error("Generation timed out");
}

async function main() {
	const apiUrl = requiredEnv("PERSONS_API_URL");
	const email = requiredEnv("PERSONS_EMAIL");
	const password = requiredEnv("PERSONS_PASSWORD");

	const client = new PersonsApiClient(apiUrl);

	log("init", "Signing in...");
	await client.signIn(email, password);

	await mkdir(OUTPUT_DIR, { recursive: true });

	// ────────────────────────────────────────────────────
	// Step 1: Create person from prompt (uses zimage turbo)
	// ────────────────────────────────────────────────────
	log("step-1", "Creating person from prompt...");
	const personName = `e2e-test-${Date.now()}`;
	const { person: createdPerson } = await client.createPersonFromPrompt({
		name: personName,
		prompt:
			"professional portrait photo of a young woman with long dark brown hair, brown eyes, warm smile, neutral background",
	});
	log("step-1", "Person created", {
		id: createdPerson.id,
		slug: createdPerson.slug,
	});

	const step1Dir = resolve(OUTPUT_DIR, "01-person-created");
	await mkdir(step1Dir, { recursive: true });
	await writeFile(
		resolve(step1Dir, "person.json"),
		JSON.stringify(createdPerson, null, 2)
	);

	if (createdPerson.referencePhotoUrl) {
		await downloadAndSave(
			createdPerson.referencePhotoUrl,
			resolve(step1Dir, "reference.png")
		);
		log("step-1", "Reference photo saved");
	}

	const personId = createdPerson.id;

	// ────────────────────────────────────────────────────
	// Step 2: Start LoRA training (dataset + training)
	// ────────────────────────────────────────────────────
	log("step-2", "Starting LoRA training...");
	await client.startLoraTraining(personId);
	log("step-2", "Training queued, polling...");

	const loraUrl = await waitForLoraTraining(client, personId);
	log("step-2", "LoRA training complete", { loraUrl });

	const step2Dir = resolve(OUTPUT_DIR, "02-lora-trained");
	await mkdir(step2Dir, { recursive: true });
	const { person: trainedPerson } = await client.getPerson(personId);
	await writeFile(
		resolve(step2Dir, "person.json"),
		JSON.stringify(trainedPerson, null, 2)
	);

	// ────────────────────────────────────────────────────
	// Step 3: Generate SFW images with face LoRA (T2I)
	// ────────────────────────────────────────────────────
	log("step-3", "Generating SFW images with face LoRA...");
	const sfwPrompts = [
		"professional office headshot, clean lighting",
		"outdoor portrait in autumn park, natural light",
		"close-up portrait, studio lighting, soft bokeh",
	];

	const step3Dir = resolve(OUTPUT_DIR, "03-sfw-lora");
	await mkdir(step3Dir, { recursive: true });

	for (let i = 0; i < sfwPrompts.length; i++) {
		const prompt = sfwPrompts[i] as string;
		log(
			"step-3",
			`Generating image ${i + 1}/${sfwPrompts.length}: "${prompt}"`
		);
		const { person: genPerson } = await client.generateWithLora(
			personId,
			prompt
		);
		const latestGen = genPerson.generations?.[0];
		if (!latestGen) {
			log("step-3", "No generation returned, skipping");
			continue;
		}

		log("step-3", `Generation ${latestGen.id} queued, waiting...`);
		const result = await waitForGeneration(client, personId, latestGen.id);
		await downloadAndSave(result.sourceUrl, resolve(step3Dir, `${i + 1}.png`));
		log("step-3", `Image ${i + 1} saved`);
	}

	// ────────────────────────────────────────────────────
	// Step 4: Generate with face LoRA + NSFW LoRA (T2I)
	// ────────────────────────────────────────────────────
	log("step-4", "Generating with face LoRA + extra NSFW LoRA...");
	const nsfwPrompts = [
		"glamour photoshoot, dramatic lighting, lingerie",
		"artistic boudoir photography, soft light",
	];

	const nsfwLoraUrl =
		"https://huggingface.co/samiyoya/loras/resolve/main/Mystic-XXX-ZIT-V4.safetensors";

	const step4Dir = resolve(OUTPUT_DIR, "04-nsfw-dual-lora");
	await mkdir(step4Dir, { recursive: true });

	for (let i = 0; i < nsfwPrompts.length; i++) {
		const prompt = nsfwPrompts[i] as string;
		log(
			"step-4",
			`Generating image ${i + 1}/${nsfwPrompts.length}: "${prompt}"`
		);
		const { person: genPerson } = await client.generateWithLora(
			personId,
			prompt,
			{
				extraLoraUrl: nsfwLoraUrl,
				extraLoraWeight: 0.8,
			}
		);
		const latestGen = genPerson.generations?.[0];
		if (!latestGen) {
			log("step-4", "No generation returned, skipping");
			continue;
		}

		log("step-4", `Generation ${latestGen.id} queued, waiting...`);
		const result = await waitForGeneration(client, personId, latestGen.id);
		await downloadAndSave(result.sourceUrl, resolve(step4Dir, `${i + 1}.png`));
		log("step-4", `Image ${i + 1} saved`);
	}

	// ────────────────────────────────────────────────────
	// Summary
	// ────────────────────────────────────────────────────
	const { person: finalPerson } = await client.getPerson(personId);
	const summary = {
		personId: finalPerson.id,
		name: finalPerson.name,
		slug: finalPerson.slug,
		description: finalPerson.description,
		loraUrl: finalPerson.loraUrl,
		generationsCount: finalPerson.generations?.length ?? 0,
		training: finalPerson.metadata.training,
	};
	await writeFile(
		resolve(OUTPUT_DIR, "summary.json"),
		JSON.stringify(summary, null, 2)
	);
	log("done", "E2E test complete!", summary);
}

main().catch((error) => {
	console.error("E2E test failed:", error);
	process.exit(1);
});
