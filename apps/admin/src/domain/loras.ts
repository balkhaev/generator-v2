import { randomUUID } from "node:crypto";
import type {
	CreateLoraFromUrlInput,
	ListLorasQuery,
	LoraRegistryEntry,
	UpdateLoraInput,
} from "@generator/contracts/loras";
import {
	cacheExternalLoraToS3,
	type S3StorageConfig,
} from "@generator/storage";
import type { LoraRepository } from "@/repositories/loras";

const slugAllowedCharsPattern = /[^a-z0-9]+/g;
const slugEdgeDashesPattern = /^-+|-+$/g;

export function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(slugAllowedCharsPattern, "-")
		.replace(slugEdgeDashesPattern, "");
}

interface LoraServiceDeps {
	cacheLora?: (
		sourceUrl: string,
		s3Config: S3StorageConfig
	) => Promise<{ key: string; sizeBytes: number; url: string }>;
	generateId?: () => string;
	repository: LoraRepository;
	s3Config?: S3StorageConfig;
}

export class LoraRegistryService {
	private readonly repository: LoraRepository;
	private readonly s3Config?: S3StorageConfig;
	private readonly cacheLora: NonNullable<LoraServiceDeps["cacheLora"]>;
	private readonly generateId: () => string;

	constructor(deps: LoraServiceDeps) {
		this.repository = deps.repository;
		this.s3Config = deps.s3Config;
		this.cacheLora = deps.cacheLora ?? cacheExternalLoraToS3;
		this.generateId = deps.generateId ?? (() => randomUUID());
	}

	async createFromUrl(
		input: CreateLoraFromUrlInput
	): Promise<LoraRegistryEntry> {
		if (!this.s3Config) {
			throw new Error("S3 is not configured; cannot import LoRA from URL.");
		}
		const name = input.name.trim();
		if (!name) {
			throw new Error("LoRA name is required.");
		}
		const baseSlug = slugify(name);
		if (!baseSlug) {
			throw new Error("Unable to derive slug from name.");
		}
		const slug = await this.uniqueSlug(baseSlug);
		const cached = await this.cacheLora(input.sourceUrl, this.s3Config);
		return this.repository.create({
			id: this.generateId(),
			slug,
			name,
			description: input.description?.trim() ?? "",
			baseModel: input.baseModel,
			sourceUrl: input.sourceUrl,
			s3Key: cached.key,
			s3Url: cached.url,
			sizeBytes: cached.sizeBytes,
			defaultWeight: input.defaultWeight ?? 1,
		});
	}

	list(query: ListLorasQuery = {}): Promise<LoraRegistryEntry[]> {
		return this.repository.list({
			baseModel: query.baseModel,
			status: query.status ?? "active",
		});
	}

	listAll(query: ListLorasQuery = {}): Promise<LoraRegistryEntry[]> {
		return this.repository.list({
			baseModel: query.baseModel,
			status: query.status,
		});
	}

	getById(id: string): Promise<LoraRegistryEntry | null> {
		return this.repository.getById(id);
	}

	update(
		id: string,
		patch: UpdateLoraInput
	): Promise<LoraRegistryEntry | null> {
		return this.repository.update(id, patch);
	}

	archive(id: string): Promise<LoraRegistryEntry | null> {
		return this.repository.update(id, { status: "archived" });
	}

	private async uniqueSlug(baseSlug: string): Promise<string> {
		let slug = baseSlug;
		let suffix = 2;
		while (await this.repository.getBySlug(slug)) {
			slug = `${baseSlug}-${suffix}`;
			suffix += 1;
		}
		return slug;
	}
}
