import { randomUUID } from "node:crypto";
import type {
	CreateLoraFromUrlInput,
	ListLorasQuery,
	LoraRegistryEntry,
	LoraSourcePreview,
	PreviewLoraSourceInput,
	UpdateLoraInput,
} from "@generator/contracts/loras";
import type { EventPublisher, LoraRegistryChangeKind } from "@generator/events";
import {
	cacheExternalLoraToS3,
	type S3StorageConfig,
} from "@generator/storage";
import type {
	LoraSourceResolver,
	ResolvedLoraSource,
} from "@/providers/lora-source-resolver";
import {
	createLoraSourceResolver,
	toLoraSourcePreview,
} from "@/providers/lora-source-resolver";
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
		s3Config: S3StorageConfig,
		options?: { headers?: Record<string, string> }
	) => Promise<{ key: string; sizeBytes: number; url: string }>;
	eventPublisher?: EventPublisher;
	generateId?: () => string;
	logger?: Pick<Console, "error" | "warn">;
	repository: LoraRepository;
	resolveSource?: LoraSourceResolver["resolve"];
	s3Config?: S3StorageConfig;
}

export class LoraRegistryService {
	private readonly repository: LoraRepository;
	private readonly s3Config?: S3StorageConfig;
	private readonly cacheLora: NonNullable<LoraServiceDeps["cacheLora"]>;
	private readonly generateId: () => string;
	private readonly resolveSource: LoraSourceResolver["resolve"];
	private readonly eventPublisher?: EventPublisher;
	private readonly logger?: Pick<Console, "error" | "warn">;

	constructor(deps: LoraServiceDeps) {
		this.repository = deps.repository;
		this.s3Config = deps.s3Config;
		this.cacheLora = deps.cacheLora ?? cacheExternalLoraToS3;
		this.generateId = deps.generateId ?? (() => randomUUID());
		this.resolveSource =
			deps.resolveSource ?? createLoraSourceResolver().resolve;
		this.eventPublisher = deps.eventPublisher;
		this.logger = deps.logger;
	}

	private async emitChange(
		change: LoraRegistryChangeKind,
		lora: LoraRegistryEntry | null
	): Promise<void> {
		if (!(this.eventPublisher && lora)) {
			return;
		}
		try {
			await this.eventPublisher.publishLoraRegistryChanged({ change, lora });
		} catch (error) {
			this.logger?.error("loras.registry.publish-failed", {
				change,
				loraId: lora.id,
				message: error instanceof Error ? error.message : "unknown",
			});
		}
	}

	async createFromUrl(
		input: CreateLoraFromUrlInput
	): Promise<LoraRegistryEntry> {
		if (!this.s3Config) {
			throw new Error("S3 is not configured; cannot import LoRA from URL.");
		}
		const source = await this.resolveSource(input);
		const name = this.resolveName(input, source);
		if (!name) {
			throw new Error("LoRA name is required.");
		}
		const baseSlug = slugify(name);
		if (!baseSlug) {
			throw new Error("Unable to derive slug from name.");
		}
		const slug = await this.uniqueSlug(baseSlug);
		const cached = await this.cacheLora(source.downloadUrl, this.s3Config, {
			headers: source.downloadHeaders,
		});
		const created = await this.repository.create({
			id: this.generateId(),
			slug,
			name,
			description:
				input.description?.trim() || source.description?.trim() || "",
			baseModel: input.baseModel ?? source.baseModel ?? "other",
			sourceUrl: source.sourceUrl,
			s3Key: cached.key,
			s3Url: cached.url,
			sizeBytes: cached.sizeBytes,
			defaultWeight: input.defaultWeight ?? 1,
		});
		await this.emitChange("created", created);
		return created;
	}

	async previewSource(
		input: PreviewLoraSourceInput
	): Promise<LoraSourcePreview> {
		const source = await this.resolveSource({
			baseModel: "other",
			sourceFilePath: input.sourceFilePath,
			sourceProvider: input.sourceProvider ?? "auto",
			sourceRevision: input.sourceRevision,
			sourceUrl: input.sourceUrl,
			sourceVersionId: input.sourceVersionId,
		});
		if (source.provider !== "civitai") {
			throw new Error("Only Civitai LoRA preview is supported.");
		}
		return toLoraSourcePreview(source);
	}

	private resolveName(
		input: CreateLoraFromUrlInput,
		source: ResolvedLoraSource
	): string {
		return (input.name?.trim() || source.name?.trim() || "").trim();
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

	async update(
		id: string,
		patch: UpdateLoraInput
	): Promise<LoraRegistryEntry | null> {
		const updated = await this.repository.update(id, patch);
		await this.emitChange("updated", updated);
		return updated;
	}

	async archive(id: string): Promise<LoraRegistryEntry | null> {
		const archived = await this.repository.update(id, { status: "archived" });
		await this.emitChange("archived", archived);
		return archived;
	}

	async delete(id: string): Promise<LoraRegistryEntry | null> {
		const deleted = await this.repository.delete(id);
		await this.emitChange("deleted", deleted);
		return deleted;
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
