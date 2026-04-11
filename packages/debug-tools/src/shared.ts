import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../.."
);
const trailingSlashPattern = /\/$/u;

const defaultServiceDefinitions = {
	admin: {
		baseUrl:
			process.env.ADMIN_DEBUG_BASE_URL ??
			process.env.ADMIN_API_URL ??
			"http://localhost:3000",
		healthUrl: "http://localhost:3000/api/health",
		label: "admin gateway",
	},
	generator: {
		baseUrl:
			process.env.GENERATOR_DEBUG_BASE_URL ??
			process.env.GENERATOR_API_URL ??
			"http://localhost:3005",
		healthUrl: "http://localhost:3005/api/health",
		label: "generator api",
	},
	studio: {
		baseUrl:
			process.env.STUDIO_DEBUG_BASE_URL ??
			process.env.STUDIO_API_URL ??
			"http://localhost:3006",
		healthUrl: "http://localhost:3006/api/health",
		label: "studio api",
	},
	persons: {
		baseUrl:
			process.env.PERSONS_DEBUG_BASE_URL ??
			process.env.PERSONS_API_URL ??
			"http://localhost:3003",
		healthUrl: "http://localhost:3003/api/health",
		label: "persons api",
	},
} as const;

export type ServiceName = keyof typeof defaultServiceDefinitions;

export interface HealthSnapshot {
	body: unknown;
	ok: boolean;
	status: number | null;
	url: string;
}

export interface ServiceHealthSnapshot extends HealthSnapshot {
	label: string;
	service: string;
}

export interface ServiceDebugSnapshot extends HealthSnapshot {
	service: ServiceName;
}

export function getWorkspaceRoot() {
	return workspaceRoot;
}

export function getDefaultServiceNames(): ServiceName[] {
	return Object.keys(defaultServiceDefinitions) as ServiceName[];
}

export function getServiceDefinitions() {
	return defaultServiceDefinitions;
}

export function getServiceBaseUrl(service: ServiceName) {
	return defaultServiceDefinitions[service].baseUrl;
}

export function getAdminDebugHeaders(): Record<string, string> {
	const cookie = process.env.ADMIN_DEBUG_COOKIE ?? process.env.ADMIN_COOKIE;
	if (!cookie) {
		return {};
	}

	return { cookie };
}

export function getStudioDebugHeaders(): Record<string, string> {
	const cookie = process.env.STUDIO_DEBUG_COOKIE ?? process.env.STUDIO_COOKIE;
	if (!cookie) {
		return {};
	}

	return { cookie };
}

export function getPersonsDebugHeaders(): Record<string, string> {
	const cookie = process.env.PERSONS_DEBUG_COOKIE ?? process.env.PERSONS_COOKIE;
	if (!cookie) {
		return {};
	}

	return { cookie };
}

export async function fetchJsonOrText(
	url: string,
	init?: RequestInit
): Promise<HealthSnapshot> {
	try {
		const response = await fetch(url, init);
		const text = await response.text();
		let body: unknown = text;

		try {
			body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
		} catch {
			body = text;
		}

		return {
			body,
			ok: response.ok,
			status: response.status,
			url,
		};
	} catch (error) {
		return {
			body: error instanceof Error ? error.message : "request failed",
			ok: false,
			status: null,
			url,
		};
	}
}

export async function collectServiceHealth(
	names: string[] = getDefaultServiceNames()
) {
	const snapshots: ServiceHealthSnapshot[] = [];

	for (const name of names) {
		const service = defaultServiceDefinitions[name as ServiceName];
		if (!service) {
			snapshots.push({
				body: `Unknown service: ${name}`,
				label: "unknown",
				ok: false,
				service: name,
				status: null,
				url: "",
			});
			continue;
		}

		const snapshot = await fetchJsonOrText(service.healthUrl);
		snapshots.push({
			...snapshot,
			label: service.label,
			service: name,
		});
	}

	return snapshots;
}

export async function fetchServiceSnapshot(
	service: ServiceName,
	path: string,
	init?: RequestInit
): Promise<ServiceDebugSnapshot> {
	const baseUrl = getServiceBaseUrl(service);
	const url = new URL(path, `${baseUrl.replace(trailingSlashPattern, "")}/`);
	const snapshot = await fetchJsonOrText(url.toString(), init);

	return {
		...snapshot,
		service,
	};
}

export function buildTimestampLabel(date = new Date()) {
	return date.toISOString().replace(/[:.]/gu, "-");
}

export async function writeJsonFile(path: string, payload: unknown) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function resolveWorkspacePath(...segments: string[]) {
	return resolve(workspaceRoot, ...segments);
}
