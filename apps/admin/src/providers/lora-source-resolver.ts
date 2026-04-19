import { mapCivitaiBaseModel } from "@generator/contracts/base-models";
import type {
	CreateLoraFromUrlInput,
	LoraBaseModel,
	LoraPreviewMediaType,
	LoraSourcePreview,
	LoraSourcePreviewPairedFile,
	LoraSourcePreviewVariant,
	LoraSourceProvider,
	LoraVariant,
} from "@generator/contracts/loras";
import { isDualExpertBaseModel } from "@generator/contracts/loras";

const civitaiHostPattern = /(^|\.)civitai\.(com|red)$/iu;
const huggingFaceHostPattern = /(^|\.)huggingface\.co$/iu;
const htmlTagPattern = /<[^>]*>/gu;
const mediaVideoExtensionPattern = /\.(mp4|webm)(\?|$)/iu;
const safetensorsExtensionPattern = /\.safetensors$/iu;
const whitespacePattern = /\s+/gu;

type ResolvedLoraSourceProvider = Exclude<LoraSourceProvider, "auto">;
type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit
) => Promise<Response>;
type HeaderRecord = Record<string, string>;

export interface ResolvedLoraSource {
	baseModel?: LoraBaseModel;
	description?: string;
	downloadHeaders?: HeaderRecord;
	downloadUrl: string;
	fileName?: string;
	name?: string;
	/**
	 * Detected high/low pair for dual-expert base models (Wan 2.2). When set,
	 * the importer can create both registry entries and link them via a shared
	 * pair group id.
	 */
	pairedFiles?: LoraSourcePreviewPairedFile[];
	previewImageUrl?: string;
	previewMediaType?: LoraPreviewMediaType;
	previewMediaUrl?: string;
	provider: ResolvedLoraSourceProvider;
	sizeBytes?: number;
	sourceUrl: string;
	sourceVersionId?: number;
	trainedWords?: string[];
	variant?: LoraVariant;
	variants?: LoraSourcePreviewVariant[];
	versionName?: string;
}

export interface LoraSourceResolver {
	resolve(input: CreateLoraFromUrlInput): Promise<ResolvedLoraSource>;
}

interface LoraSourceResolverOptions {
	civitaiApiKey?: string;
	fetchImpl?: FetchLike;
	huggingFaceToken?: string;
}

interface CivitaiFile {
	downloadUrl?: string;
	metadata?: {
		format?: string;
	};
	name?: string;
	primary?: boolean;
	sizeKb?: number;
}

interface CivitaiModel {
	description?: null | string;
	id: number;
	modelVersions?: CivitaiModelVersion[];
	name: string;
	type?: string;
}

interface CivitaiModelVersion {
	baseModel?: string;
	description?: null | string;
	downloadUrl?: string;
	files?: CivitaiFile[];
	id: number;
	images?: CivitaiImage[];
	model?: {
		name?: string;
		type?: string;
	};
	name: string;
	trainedWords?: string[];
}

interface CivitaiImage {
	nsfw?: boolean | string;
	type?: string;
	url?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function stripHtml(value: null | string | undefined): string | undefined {
	if (!value) {
		return;
	}
	const text = value
		.replace(htmlTagPattern, " ")
		.replace(whitespacePattern, " ")
		.trim();
	return text || undefined;
}

function appendDescription(
	...parts: (string | undefined)[]
): string | undefined {
	const text = parts.filter(Boolean).join(" ").trim();
	return text || undefined;
}

function parseCivitaiFile(value: unknown): CivitaiFile | null {
	const record = asRecord(value);
	if (!record) {
		return null;
	}
	const metadata = asRecord(record.metadata);
	return {
		downloadUrl: asString(record.downloadUrl),
		metadata: metadata ? { format: asString(metadata.format) } : undefined,
		name: asString(record.name),
		primary: typeof record.primary === "boolean" ? record.primary : undefined,
		sizeKb: asNumber(record.sizeKb),
	};
}

function parseCivitaiModelVersion(value: unknown): CivitaiModelVersion | null {
	const record = asRecord(value);
	const id = record ? asNumber(record.id) : undefined;
	const name = record ? asString(record.name) : undefined;
	if (!(record && id && name)) {
		return null;
	}
	const model = asRecord(record.model);
	const filesValue = Array.isArray(record.files) ? record.files : [];
	const trainedWords = Array.isArray(record.trainedWords)
		? record.trainedWords.filter(
				(word): word is string => typeof word === "string"
			)
		: undefined;
	const images = Array.isArray(record.images)
		? record.images
				.map(parseCivitaiImage)
				.filter((image): image is CivitaiImage => Boolean(image))
		: undefined;

	return {
		baseModel: asString(record.baseModel),
		description: asString(record.description) ?? null,
		downloadUrl: asString(record.downloadUrl),
		files: filesValue
			.map(parseCivitaiFile)
			.filter((file): file is CivitaiFile => Boolean(file)),
		id,
		images,
		model: model
			? {
					name: asString(model.name),
					type: asString(model.type),
				}
			: undefined,
		name,
		trainedWords,
	};
}

function parseCivitaiImage(value: unknown): CivitaiImage | null {
	const record = asRecord(value);
	if (!record) {
		return null;
	}
	return {
		nsfw:
			typeof record.nsfw === "boolean" || typeof record.nsfw === "string"
				? record.nsfw
				: undefined,
		type: asString(record.type),
		url: asString(record.url),
	};
}

function parseCivitaiModel(value: unknown): CivitaiModel {
	const record = asRecord(value);
	const id = record ? asNumber(record.id) : undefined;
	const name = record ? asString(record.name) : undefined;
	if (!(record && id && name)) {
		throw new Error("Civitai returned an unexpected model response.");
	}
	const modelVersionsValue = Array.isArray(record.modelVersions)
		? record.modelVersions
		: [];
	return {
		description: asString(record.description) ?? null,
		id,
		modelVersions: modelVersionsValue
			.map(parseCivitaiModelVersion)
			.filter((version): version is CivitaiModelVersion => Boolean(version)),
		name,
		type: asString(record.type),
	};
}

function parseCivitaiModelVersionResponse(value: unknown): CivitaiModelVersion {
	const version = parseCivitaiModelVersion(value);
	if (!version) {
		throw new Error("Civitai returned an unexpected model version response.");
	}
	return version;
}

function isCivitaiHost(url: URL): boolean {
	return civitaiHostPattern.test(url.hostname);
}

function isHuggingFaceHost(url: URL): boolean {
	return huggingFaceHostPattern.test(url.hostname);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
	if (!value) {
		return;
	}
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function detectProvider(url: URL): ResolvedLoraSourceProvider {
	if (isCivitaiHost(url)) {
		return "civitai";
	}
	if (isHuggingFaceHost(url)) {
		return "huggingface";
	}
	return "direct";
}

function resolveProvider(
	inputProvider: LoraSourceProvider | undefined,
	url: URL
): ResolvedLoraSourceProvider {
	if (!(inputProvider && inputProvider !== "auto")) {
		return detectProvider(url);
	}
	return inputProvider;
}

function buildAuthHeaders(token: string | undefined): HeaderRecord | undefined {
	return token ? { authorization: `Bearer ${token}` } : undefined;
}

function mergeHeaders(
	...headersList: (HeaderRecord | undefined)[]
): HeaderRecord {
	const headers = new Headers();
	for (const headersInput of headersList) {
		if (!headersInput) {
			continue;
		}
		for (const [key, value] of new Headers(headersInput)) {
			headers.set(key, value);
		}
	}
	return Object.fromEntries(headers.entries());
}

function getCivitaiModelId(url: URL): number | undefined {
	const segments = url.pathname.split("/").filter(Boolean);
	if (segments[0] === "models") {
		return parsePositiveInteger(segments[1]);
	}
	if (
		segments[0] === "api" &&
		segments[1] === "v1" &&
		segments[2] === "models"
	) {
		return parsePositiveInteger(segments[3]);
	}
	return;
}

function getCivitaiModelVersionId(url: URL): number | undefined {
	const queryVersionId = parsePositiveInteger(
		url.searchParams.get("modelVersionId") ?? undefined
	);
	if (queryVersionId) {
		return queryVersionId;
	}

	const segments = url.pathname.split("/").filter(Boolean);
	if (
		segments[0] === "api" &&
		segments[1] === "download" &&
		segments[2] === "models"
	) {
		return parsePositiveInteger(segments[3]);
	}
	if (
		segments[0] === "api" &&
		segments[1] === "v1" &&
		segments[2] === "model-versions"
	) {
		return parsePositiveInteger(segments[3]);
	}
	return;
}

function resolveCivitaiModelVersionId(
	input: CreateLoraFromUrlInput,
	url: URL
): number | undefined {
	return input.sourceVersionId ?? getCivitaiModelVersionId(url);
}

function selectCivitaiVersion(
	model: CivitaiModel,
	modelVersionId: number | undefined
): CivitaiModelVersion {
	if (model.type && model.type.toUpperCase() !== "LORA") {
		throw new Error(
			`Civitai model "${model.name}" is ${model.type}, not LoRA.`
		);
	}

	const versions = model.modelVersions ?? [];
	if (versions.length === 0) {
		throw new Error(`Civitai model "${model.name}" has no versions.`);
	}

	if (modelVersionId) {
		const version = versions.find((item) => item.id === modelVersionId);
		if (!version) {
			throw new Error(
				`Civitai model "${model.name}" does not contain version ${modelVersionId}.`
			);
		}
		return version;
	}

	// When no specific version is requested, prefer the high half of a
	// dual-expert (Wan 2.2) pair if the model exposes one. Otherwise multi-base
	// models like "Bouncing Boobs - LTX / Wan" would default to their newest
	// version (e.g. LTX) and the pair-import flow would never trigger from the
	// auto-preview of a bare /models/{id} URL.
	const dualExpertHigh = pickDualExpertHighVersion(versions);
	return dualExpertHigh ?? (versions[0] as CivitaiModelVersion);
}

function pickDualExpertHighVersion(
	versions: CivitaiModelVersion[]
): CivitaiModelVersion | undefined {
	const dualExpertVersions = versions.filter((version) => {
		const baseModel = mapCivitaiBaseModel(version.baseModel);
		return baseModel ? isDualExpertBaseModel(baseModel) : false;
	});
	if (dualExpertVersions.length < 2) {
		return;
	}
	const high = dualExpertVersions.find(
		(version) =>
			detectVariantForVersion(version, selectCivitaiFile(version)) === "high"
	);
	const low = dualExpertVersions.find(
		(version) =>
			detectVariantForVersion(version, selectCivitaiFile(version)) === "low"
	);
	return high && low ? high : undefined;
}

function selectCivitaiFile(version: CivitaiModelVersion): CivitaiFile | null {
	const files = version.files ?? [];
	const isSafeTensor = (file: CivitaiFile) =>
		file.metadata?.format?.toLowerCase() === "safetensor" ||
		file.name?.toLowerCase().endsWith(".safetensors");
	return (
		files.find((file) => file.primary && isSafeTensor(file)) ??
		files.find(isSafeTensor) ??
		files.find((file) => file.primary) ??
		files[0] ??
		null
	);
}

function selectPreviewMedia(
	version: CivitaiModelVersion
): { type: LoraPreviewMediaType; url: string } | undefined {
	const images = version.images ?? [];
	const image =
		images.find((item) => item.nsfw === false && item.url) ??
		images.find((item) => item.url);
	if (!image?.url) {
		return;
	}
	return {
		type:
			image.type === "video" || mediaVideoExtensionPattern.test(image.url)
				? "video"
				: "image",
		url: image.url,
	};
}

function sizeKbToBytes(sizeKb: number | undefined): number | undefined {
	return sizeKb === undefined ? undefined : Math.round(sizeKb * 1024);
}

function buildCivitaiDescription(input: {
	modelDescription?: null | string;
	trainedWords?: string[];
	versionDescription?: null | string;
}) {
	const trainedWords =
		input.trainedWords && input.trainedWords.length > 0
			? `Trigger words: ${input.trainedWords.join(", ")}.`
			: undefined;
	return appendDescription(
		stripHtml(input.versionDescription),
		trainedWords,
		stripHtml(input.modelDescription)
	);
}

function buildCivitaiApiUrl(sourceUrl: URL, path: string): string {
	return `${sourceUrl.origin}${path}`;
}

// Heuristic detection of high/low expert affinity from version/file naming.
// Civitai authors usually call them e.g. "Wan 2.2 I2V High Noise" or have file
// names like `*_HighNoise.safetensors`. We match `high noise`, standalone
// `high`, the same for `low`, and a few common abbreviations. Note that `_`
// counts as a word character in JS regex, so we match boundaries against
// non-alphanumeric characters explicitly to handle `pair_HighNoise.safetensors`
// style file names.
const variantHighPattern =
	/(?:^|[^a-z0-9])(?:high(?:[\s_-]*noise)?|hn|h-?noise)(?=[^a-z0-9]|$)/iu;
const variantLowPattern =
	/(?:^|[^a-z0-9])(?:low(?:[\s_-]*noise)?|ln|l-?noise)(?=[^a-z0-9]|$)/iu;

function detectVariantFromText(
	value: string | undefined
): LoraVariant | undefined {
	if (!value) {
		return;
	}
	if (variantHighPattern.test(value)) {
		return "high";
	}
	if (variantLowPattern.test(value)) {
		return "low";
	}
	return;
}

function detectVariantForVersion(
	version: CivitaiModelVersion,
	file: CivitaiFile | null
): LoraVariant | undefined {
	return (
		detectVariantFromText(file?.name) ??
		detectVariantFromText(version.name) ??
		detectVariantFromText(version.description ?? undefined)
	);
}

function buildCivitaiVariant(
	version: CivitaiModelVersion
): LoraSourcePreviewVariant | null {
	const file = selectCivitaiFile(version);
	const downloadUrl = file?.downloadUrl ?? version.downloadUrl;
	if (!downloadUrl) {
		return null;
	}
	const media = selectPreviewMedia(version);
	const baseModel = mapCivitaiBaseModel(version.baseModel);
	return {
		baseModel,
		description: buildCivitaiDescription({
			trainedWords: version.trainedWords,
			versionDescription: version.description,
		}),
		downloadUrl,
		fileName: file?.name,
		mediaType: media?.type,
		mediaUrl: media?.url,
		sizeBytes: sizeKbToBytes(file?.sizeKb),
		trainedWords: version.trainedWords,
		variant: detectVariantForVersion(version, file ?? null),
		versionId: version.id,
		versionName: version.name,
	};
}

function findPairedFiles(input: {
	baseModel: LoraBaseModel | undefined;
	primary: LoraSourcePreviewVariant;
	versions: CivitaiModelVersion[];
}): LoraSourcePreviewPairedFile[] | undefined {
	if (!(input.baseModel && isDualExpertBaseModel(input.baseModel))) {
		return;
	}
	const pickHighLowFromVariants = (): LoraSourcePreviewPairedFile[] => {
		const variants = input.versions
			.map(buildCivitaiVariant)
			.filter((variant): variant is LoraSourcePreviewVariant =>
				Boolean(variant)
			)
			.filter((variant) => variant.baseModel === input.baseModel);

		const high = variants.find((variant) => variant.variant === "high");
		const low = variants.find((variant) => variant.variant === "low");
		if (!(high && low)) {
			return [];
		}
		return [
			{
				downloadUrl: high.downloadUrl,
				fileName: high.fileName,
				sizeBytes: high.sizeBytes,
				sourceUrl: high.downloadUrl,
				sourceVersionId: high.versionId,
				variant: "high",
			},
			{
				downloadUrl: low.downloadUrl,
				fileName: low.fileName,
				sizeBytes: low.sizeBytes,
				sourceUrl: low.downloadUrl,
				sourceVersionId: low.versionId,
				variant: "low",
			},
		];
	};

	const pickHighLowFromFiles = (
		version: CivitaiModelVersion
	): LoraSourcePreviewPairedFile[] => {
		const files = version.files ?? [];
		const high = files.find(
			(file) => detectVariantFromText(file.name) === "high"
		);
		const low = files.find(
			(file) => detectVariantFromText(file.name) === "low"
		);
		if (!(high?.downloadUrl && low?.downloadUrl)) {
			return [];
		}
		return [
			{
				downloadUrl: high.downloadUrl,
				fileName: high.name,
				sizeBytes: sizeKbToBytes(high.sizeKb),
				sourceUrl: high.downloadUrl,
				sourceVersionId: version.id,
				variant: "high",
			},
			{
				downloadUrl: low.downloadUrl,
				fileName: low.name,
				sizeBytes: sizeKbToBytes(low.sizeKb),
				sourceUrl: low.downloadUrl,
				sourceVersionId: version.id,
				variant: "low",
			},
		];
	};

	const fromVariants = pickHighLowFromVariants();
	if (fromVariants.length === 2) {
		return fromVariants;
	}
	const primaryVersion = input.versions.find(
		(version) => version.id === input.primary.versionId
	);
	if (primaryVersion) {
		const fromFiles = pickHighLowFromFiles(primaryVersion);
		if (fromFiles.length === 2) {
			return fromFiles;
		}
	}
	return;
}

function buildResolvedCivitaiSource(input: {
	downloadHeaders: HeaderRecord;
	input: CreateLoraFromUrlInput;
	modelDescription?: null | string;
	modelName: string;
	pairedFiles?: LoraSourcePreviewPairedFile[];
	variant: LoraSourcePreviewVariant;
	variants?: LoraSourcePreviewVariant[];
}): ResolvedLoraSource {
	return {
		baseModel: input.variant.baseModel,
		description: appendDescription(
			input.variant.description,
			stripHtml(input.modelDescription)
		),
		downloadHeaders: input.downloadHeaders,
		downloadUrl: input.variant.downloadUrl,
		fileName: input.variant.fileName,
		name: input.modelName,
		pairedFiles: input.pairedFiles,
		previewImageUrl:
			input.variant.mediaType === "image" ? input.variant.mediaUrl : undefined,
		previewMediaType: input.variant.mediaType,
		previewMediaUrl: input.variant.mediaUrl,
		provider: "civitai",
		sizeBytes: input.variant.sizeBytes,
		sourceUrl: input.input.sourceUrl.trim(),
		sourceVersionId: input.variant.versionId,
		trainedWords: input.variant.trainedWords,
		variant: input.variant.variant,
		variants: input.variants,
		versionName: input.variant.versionName,
	};
}

function buildHuggingFaceFileUrl(input: {
	filePath: string;
	repoId: string;
	revision: string;
}) {
	const repoPath = input.repoId
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	const filePath = input.filePath
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
	const revision = encodeURIComponent(input.revision);
	return `https://huggingface.co/${repoPath}/resolve/${revision}/${filePath}`;
}

function parseHuggingFaceSource(input: CreateLoraFromUrlInput, url: URL) {
	const segments = url.pathname.split("/").filter(Boolean);
	const markerIndex = segments.findIndex(
		(segment) =>
			segment === "blob" || segment === "resolve" || segment === "tree"
	);
	if (markerIndex >= 0) {
		const repoId = segments.slice(0, markerIndex).join("/");
		const revision =
			segments[markerIndex + 1] ?? input.sourceRevision ?? "main";
		const filePath =
			segments[markerIndex] === "tree"
				? (input.sourceFilePath?.trim() ?? "")
				: segments.slice(markerIndex + 2).join("/");
		if (!(repoId && revision && filePath)) {
			throw new Error(
				"Hugging Face file URLs must include repo, revision and file path."
			);
		}
		return { filePath, repoId, revision };
	}

	const repoId = segments.join("/");
	const filePath =
		input.sourceFilePath?.trim() ||
		url.searchParams.get("filename")?.trim() ||
		url.searchParams.get("file")?.trim() ||
		"";
	const revision =
		input.sourceRevision?.trim() ||
		url.searchParams.get("revision")?.trim() ||
		"main";
	if (!(repoId && filePath)) {
		throw new Error(
			"Hugging Face import requires a /blob/ or /resolve/ file URL, or a file path."
		);
	}
	return { filePath, repoId, revision };
}

export function createLoraSourceResolver(
	options: LoraSourceResolverOptions = {}
): LoraSourceResolver {
	const fetchImpl = options.fetchImpl ?? fetch;

	async function fetchJson(url: string, headers: HeaderRecord | undefined) {
		const response = await fetchImpl(url, { headers });
		if (!response.ok) {
			throw new Error(
				`Unable to resolve LoRA source (${response.status}): ${url}`
			);
		}
		return response.json() as Promise<unknown>;
	}

	async function resolveCivitai(
		input: CreateLoraFromUrlInput,
		url: URL
	): Promise<ResolvedLoraSource> {
		const requestHeaders = mergeHeaders(
			{ accept: "application/json", "user-agent": "admin-lora-import/1.0" },
			buildAuthHeaders(options.civitaiApiKey)
		);
		const downloadHeaders = mergeHeaders(
			{ "user-agent": "admin-lora-import/1.0" },
			buildAuthHeaders(options.civitaiApiKey)
		);
		const modelVersionId = resolveCivitaiModelVersionId(input, url);
		const modelId = getCivitaiModelId(url);

		if (modelId) {
			const model = parseCivitaiModel(
				await fetchJson(
					buildCivitaiApiUrl(url, `/api/v1/models/${modelId}`),
					requestHeaders
				)
			);
			const version = selectCivitaiVersion(model, modelVersionId);
			const variants = (model.modelVersions ?? [])
				.map(buildCivitaiVariant)
				.filter((variant): variant is LoraSourcePreviewVariant =>
					Boolean(variant)
				);
			const variant =
				variants.find((item) => item.versionId === version.id) ??
				buildCivitaiVariant(version);
			if (!variant) {
				throw new Error(`Civitai model "${model.name}" has no download URL.`);
			}
			const pairedFiles = findPairedFiles({
				baseModel: variant.baseModel,
				primary: variant,
				versions: model.modelVersions ?? [],
			});
			return buildResolvedCivitaiSource({
				downloadHeaders,
				input,
				modelDescription: model.description,
				modelName: model.name,
				pairedFiles,
				variant,
				variants,
			});
		}

		if (modelVersionId) {
			const version = parseCivitaiModelVersionResponse(
				await fetchJson(
					buildCivitaiApiUrl(url, `/api/v1/model-versions/${modelVersionId}`),
					requestHeaders
				)
			);
			if (version.model?.type && version.model.type.toUpperCase() !== "LORA") {
				throw new Error(
					`Civitai model "${version.model.name ?? version.name}" is ${version.model.type}, not LoRA.`
				);
			}
			const variant = buildCivitaiVariant(version) ?? {
				downloadUrl: url.href,
				versionId: version.id,
				versionName: version.name,
			};
			return buildResolvedCivitaiSource({
				downloadHeaders,
				input,
				modelName: version.model?.name ?? version.name,
				variant,
				variants: [variant],
			});
		}

		return {
			downloadHeaders,
			downloadUrl: url.href,
			provider: "civitai",
			sourceUrl: input.sourceUrl.trim(),
		};
	}

	function resolveHuggingFace(
		input: CreateLoraFromUrlInput,
		url: URL
	): ResolvedLoraSource {
		const parsed = parseHuggingFaceSource(input, url);
		const downloadHeaders = mergeHeaders(
			{ "user-agent": "admin-lora-import/1.0" },
			buildAuthHeaders(options.huggingFaceToken)
		);
		const fileName = parsed.filePath.split("/").at(-1);
		const sourceUrl = `https://huggingface.co/${parsed.repoId}/blob/${encodeURIComponent(parsed.revision)}/${parsed.filePath
			.split("/")
			.map((segment) => encodeURIComponent(segment))
			.join("/")}`;
		return {
			description: `Hugging Face: ${parsed.repoId}@${parsed.revision}`,
			downloadHeaders,
			downloadUrl: buildHuggingFaceFileUrl(parsed),
			fileName,
			name: fileName?.replace(safetensorsExtensionPattern, ""),
			provider: "huggingface",
			sourceUrl,
		};
	}

	return {
		async resolve(input) {
			let url: URL;
			try {
				url = new URL(input.sourceUrl.trim());
			} catch {
				throw new Error("Source URL must be a valid URL.");
			}

			const provider = resolveProvider(input.sourceProvider, url);
			if (provider === "civitai") {
				if (!isCivitaiHost(url)) {
					throw new Error(
						"Civitai imports require a civitai.com or civitai.red URL."
					);
				}
				return await resolveCivitai(input, url);
			}
			if (provider === "huggingface") {
				if (!isHuggingFaceHost(url)) {
					throw new Error("Hugging Face imports require a huggingface.co URL.");
				}
				return resolveHuggingFace(input, url);
			}
			return {
				downloadUrl: url.href,
				provider: "direct",
				sourceUrl: url.href,
			};
		},
	};
}

export function toLoraSourcePreview(
	source: ResolvedLoraSource
): LoraSourcePreview {
	return {
		baseModel: source.baseModel,
		description: source.description,
		downloadUrl: source.downloadUrl,
		fileName: source.fileName,
		name: source.name,
		pairedFiles: source.pairedFiles,
		previewMediaType: source.previewMediaType,
		previewMediaUrl: source.previewMediaUrl,
		previewImageUrl: source.previewImageUrl,
		provider: source.provider,
		sizeBytes: source.sizeBytes,
		sourceUrl: source.sourceUrl,
		sourceVersionId: source.sourceVersionId,
		trainedWords: source.trainedWords,
		variant: source.variant,
		variants: source.variants,
		versionName: source.versionName,
	};
}
