import { randomUUID } from "node:crypto";
import type {
	CreateLoraFromUrlInput,
	ListLorasQuery,
	LoraBaseModel,
	LoraInferenceAvailability,
	LoraRegistryEntry,
	LoraSourcePreview,
	LoraVariant,
	PreviewLoraSourceInput,
	UpdateLoraInput,
} from "@generator/contracts/loras";
import { isDualExpertBaseModel } from "@generator/contracts/loras";
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
// Matches trailing "(High Noise)" / "(Low Noise)" / "- High" / "[high]" etc.
// We strip these when deriving the base name for paired imports so we don't
// end up with "Foo High Noise (High Noise)".
const variantSuffixPattern =
	/[\s\-_]*[([]?(?:high|low)(?:[\s_-]*noise)?[)\]]?\s*$/iu;

export function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(slugAllowedCharsPattern, "-")
		.replace(slugEdgeDashesPattern, "");
}

/**
 * Trim, drop empties and de-duplicate (case-insensitive) trigger words while
 * preserving the order in which they were declared. Civitai often returns
 * `trainedWords` with stray whitespace or duplicate casing variants — keeping
 * them clean avoids polluting the prompt at run time.
 */
export function normalizeTriggerWords(
	value: readonly string[] | undefined
): string[] {
	if (!value) {
		return [];
	}
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of value) {
		const trimmed = typeof raw === "string" ? raw.trim() : "";
		if (!trimmed) {
			continue;
		}
		const key = trimmed.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(trimmed);
	}
	return result;
}

interface LoraServiceDeps {
	cacheLora?: (
		sourceUrl: string,
		s3Config: S3StorageConfig,
		options?: { headers?: Record<string, string> }
	) => Promise<{ key: string; sizeBytes: number; url: string }>;
	checkCivitaiLtx23Inference?: (
		source: ResolvedLoraSource
	) => Promise<LoraInferenceAvailability>;
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
	private readonly checkCivitaiLtx23Inference?: NonNullable<
		LoraServiceDeps["checkCivitaiLtx23Inference"]
	>;
	private readonly eventPublisher?: EventPublisher;
	private readonly logger?: Pick<Console, "error" | "warn">;

	constructor(deps: LoraServiceDeps) {
		this.repository = deps.repository;
		this.s3Config = deps.s3Config;
		this.cacheLora = deps.cacheLora ?? cacheExternalLoraToS3;
		this.generateId = deps.generateId ?? (() => randomUUID());
		this.resolveSource =
			deps.resolveSource ?? createLoraSourceResolver().resolve;
		this.checkCivitaiLtx23Inference = deps.checkCivitaiLtx23Inference;
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
	): Promise<LoraRegistryEntry | LoraRegistryEntry[]> {
		if (!this.s3Config) {
			throw new Error("S3 is not configured; cannot import LoRA from URL.");
		}

		// Pair import: cache and persist both high+low atomically with a shared
		// pairGroupId so studio can auto-fill the matching slot.
		if (input.pair) {
			return await this.createPair(input);
		}

		const source = await this.resolveSource(input);
		const baseModel: LoraBaseModel =
			input.baseModel ?? source.baseModel ?? "other";
		const variant = this.resolveVariantForSingle(baseModel, input.variant);
		const name = this.resolveName(input, source, variant);
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
			baseModel,
			sourceUrl: source.sourceUrl,
			s3Key: cached.key,
			s3Url: cached.url,
			sizeBytes: cached.sizeBytes,
			defaultWeight: input.defaultWeight ?? 1,
			triggerWords: normalizeTriggerWords(
				input.triggerWords ?? source.trainedWords
			),
			variant,
			pairGroupId: null,
		});
		await this.emitChange("created", created);
		return created;
	}

	private async createPair(
		input: CreateLoraFromUrlInput
	): Promise<LoraRegistryEntry[]> {
		if (!(this.s3Config && input.pair)) {
			throw new Error("S3 is not configured; cannot import LoRA pair.");
		}
		const baseModel: LoraBaseModel = input.baseModel ?? "other";
		if (!isDualExpertBaseModel(baseModel)) {
			throw new Error(
				`Pair import is only supported for dual-expert base models (got "${baseModel}").`
			);
		}
		if (input.variant && input.variant === input.pair.variant) {
			throw new Error("Pair entries must have different variants (high/low).");
		}
		const primaryVariant = (input.variant ?? "high") as Exclude<
			LoraVariant,
			"both"
		>;
		const secondaryVariant = input.pair.variant;
		if (primaryVariant === secondaryVariant) {
			throw new Error("Pair entries must have different variants (high/low).");
		}

		const primarySource = await this.resolveSource(input);
		const secondarySource = await this.resolveSource({
			baseModel,
			defaultWeight: input.pair.defaultWeight,
			description: input.pair.description,
			name: input.pair.name,
			sourceFilePath: input.pair.sourceFilePath,
			sourceProvider: input.sourceProvider,
			sourceUrl: input.pair.sourceUrl,
			sourceVersionId: input.pair.sourceVersionId,
		});

		const baseName = (input.name?.trim() || primarySource.name?.trim() || "")
			.trim()
			.replace(variantSuffixPattern, "")
			.trim();
		if (!baseName) {
			throw new Error("LoRA name is required.");
		}

		const pairGroupId = this.generateId();

		const primaryEntry = await this.persistPairEntry({
			baseModel,
			defaultWeight: input.defaultWeight,
			descriptionOverride: input.description,
			name: this.suffixVariantName(
				input.name?.trim() || baseName,
				primaryVariant
			),
			pairGroupId,
			source: primarySource,
			triggerWordsOverride: input.triggerWords,
			variant: primaryVariant,
		});
		const secondaryEntry = await this.persistPairEntry({
			baseModel,
			defaultWeight: input.pair.defaultWeight ?? input.defaultWeight,
			descriptionOverride: input.pair.description,
			name: this.suffixVariantName(
				input.pair.name?.trim() || baseName,
				secondaryVariant
			),
			pairGroupId,
			source: secondarySource,
			triggerWordsOverride: input.pair.triggerWords ?? input.triggerWords,
			variant: secondaryVariant,
		});

		await this.emitChange("created", primaryEntry);
		await this.emitChange("created", secondaryEntry);
		return [primaryEntry, secondaryEntry];
	}

	private async persistPairEntry(input: {
		baseModel: LoraBaseModel;
		defaultWeight: number | undefined;
		descriptionOverride: string | undefined;
		name: string;
		pairGroupId: string;
		source: ResolvedLoraSource;
		triggerWordsOverride: string[] | undefined;
		variant: Exclude<LoraVariant, "both">;
	}): Promise<LoraRegistryEntry> {
		const s3Config = this.s3Config;
		if (!s3Config) {
			throw new Error("S3 is not configured; cannot import LoRA pair.");
		}
		const baseSlug = slugify(input.name);
		if (!baseSlug) {
			throw new Error("Unable to derive slug from name.");
		}
		const slug = await this.uniqueSlug(baseSlug);
		const cached = await this.cacheLora(input.source.downloadUrl, s3Config, {
			headers: input.source.downloadHeaders,
		});
		return await this.repository.create({
			id: this.generateId(),
			slug,
			name: input.name,
			description:
				input.descriptionOverride?.trim() ||
				input.source.description?.trim() ||
				"",
			baseModel: input.baseModel,
			sourceUrl: input.source.sourceUrl,
			s3Key: cached.key,
			s3Url: cached.url,
			sizeBytes: cached.sizeBytes,
			defaultWeight: input.defaultWeight ?? 1,
			triggerWords: normalizeTriggerWords(
				input.triggerWordsOverride ?? input.source.trainedWords
			),
			variant: input.variant,
			pairGroupId: input.pairGroupId,
		});
	}

	private resolveVariantForSingle(
		baseModel: LoraBaseModel,
		requested: LoraVariant | undefined
	): LoraVariant | null {
		if (!isDualExpertBaseModel(baseModel)) {
			return null;
		}
		// For Wan we default to `both` when the caller doesn't say which expert
		// the file targets — fal will load it into both transformers, which is
		// the safest single-file behavior.
		return requested ?? "both";
	}

	private suffixVariantName(
		baseName: string,
		variant: Exclude<LoraVariant, "both">
	): string {
		const cleaned = baseName.replace(variantSuffixPattern, "").trim();
		const suffix = variant === "high" ? "High Noise" : "Low Noise";
		return `${cleaned} (${suffix})`;
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
		const preview = toLoraSourcePreview(source);
		if (input.checkCivitaiLtx23Inference) {
			preview.inference = {
				...preview.inference,
				civitaiLtx23: this.checkCivitaiLtx23Inference
					? await this.checkCivitaiLtx23Inference(source)
					: {
							reason: "Civitai LTX 2.3 inference preflight is not configured.",
							status: "unchecked",
							target: "civitai-ltx-2-3",
						},
			};
		}
		return preview;
	}

	private resolveName(
		input: CreateLoraFromUrlInput,
		source: ResolvedLoraSource,
		variant: LoraVariant | null
	): string {
		const base = (input.name?.trim() || source.name?.trim() || "").trim();
		if (!base) {
			return "";
		}
		if (variant === "high" || variant === "low") {
			return this.suffixVariantName(base, variant);
		}
		return base;
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

	getPairedLora(entry: LoraRegistryEntry): Promise<LoraRegistryEntry | null> {
		if (!(entry.pairGroupId && entry.variant) || entry.variant === "both") {
			return Promise.resolve(null);
		}
		return this.repository
			.getByPairGroupId(entry.pairGroupId)
			.then(
				(rows) =>
					rows.find(
						(item) => item.id !== entry.id && item.variant !== entry.variant
					) ?? null
			);
	}

	async update(
		id: string,
		patch: UpdateLoraInput
	): Promise<LoraRegistryEntry | null> {
		const normalizedPatch: UpdateLoraInput = {
			...patch,
			...(patch.triggerWords === undefined
				? {}
				: { triggerWords: normalizeTriggerWords(patch.triggerWords) }),
		};
		const updated = await this.repository.update(id, normalizedPatch);
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
