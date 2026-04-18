"use client";

import { cn } from "@generator/ui/lib/utils";
import { ImageUp, Loader2, Trash2, Upload } from "lucide-react";
import {
	type ClipboardEvent,
	type DragEvent,
	useCallback,
	useId,
	useRef,
	useState,
} from "react";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_ACCEPT = "image/*";

const httpUrlPattern = /^https?:\/\//i;

export interface ImageUploaderProps {
	accept?: string;
	className?: string;
	disabled?: boolean;
	helperText?: string;
	id?: string;
	maxSizeBytes?: number;
	onChange: (value: string) => void;
	onError?: (message: string) => void;
	upload: (file: File) => Promise<{ url: string }>;
	value: string;
}

function formatBytes(bytes: number) {
	const mb = bytes / (1024 * 1024);
	return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function isPreviewUrl(value: string) {
	return httpUrlPattern.test(value.trim()) || value.startsWith("data:image/");
}

export function ImageUploader({
	accept = DEFAULT_ACCEPT,
	className,
	disabled = false,
	helperText,
	id,
	maxSizeBytes = DEFAULT_MAX_BYTES,
	onChange,
	onError,
	upload,
	value,
}: ImageUploaderProps) {
	const generatedId = useId();
	const inputId = id ?? generatedId;
	const inputRef = useRef<HTMLInputElement>(null);
	const [isUploading, setUploading] = useState(false);
	const [isDragOver, setDragOver] = useState(false);

	const handleFile = useCallback(
		async (file: File | null | undefined) => {
			if (!file || disabled) {
				return;
			}

			if (!file.type.startsWith("image/")) {
				onError?.("Only image files are supported.");
				return;
			}

			if (file.size <= 0) {
				onError?.("Selected image is empty.");
				return;
			}

			if (file.size > maxSizeBytes) {
				onError?.(`Image must be smaller than ${formatBytes(maxSizeBytes)}.`);
				return;
			}

			setUploading(true);
			try {
				const result = await upload(file);
				onChange(result.url);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Failed to upload image.";
				onError?.(message);
			} finally {
				setUploading(false);
			}
		},
		[disabled, maxSizeBytes, onChange, onError, upload]
	);

	function handleDrop(event: DragEvent<HTMLElement>) {
		event.preventDefault();
		setDragOver(false);
		const file = event.dataTransfer.files?.[0];
		handleFile(file).catch(() => undefined);
	}

	function handlePaste(event: ClipboardEvent<HTMLElement>) {
		if (disabled) {
			return;
		}
		const items = event.clipboardData?.items;
		if (!items) {
			return;
		}
		for (const item of items) {
			if (item.kind === "file" && item.type.startsWith("image/")) {
				const file = item.getAsFile();
				if (file) {
					event.preventDefault();
					handleFile(file).catch(() => undefined);
					return;
				}
			}
		}
	}

	function openPicker() {
		if (disabled) {
			return;
		}
		inputRef.current?.click();
	}

	const showPreview = value && isPreviewUrl(value);

	return (
		<div className={cn("grid gap-1.5", className)}>
			<input
				accept={accept}
				className="sr-only"
				disabled={disabled}
				id={inputId}
				onChange={(event) => {
					const file = event.target.files?.[0];
					handleFile(file).catch(() => undefined);
					event.target.value = "";
				}}
				ref={inputRef}
				type="file"
			/>

			{showPreview ? (
				// biome-ignore lint/a11y/noStaticElementInteractions: drop zone wraps an interactive button overlay
				// biome-ignore lint/a11y/noNoninteractiveElementInteractions: drop zone wraps an interactive button overlay
				<div
					className={cn(
						"group relative overflow-hidden rounded-xl border border-foreground/8",
						isDragOver && "ring-2 ring-ring/60"
					)}
					onDragLeave={(event) => {
						event.preventDefault();
						setDragOver(false);
					}}
					onDragOver={(event) => {
						event.preventDefault();
						setDragOver(true);
					}}
					onDrop={handleDrop}
					onPaste={handlePaste}
				>
					<div
						className="aspect-video bg-center bg-cover bg-muted/10 bg-no-repeat"
						style={{ backgroundImage: `url("${value}")` }}
					/>
					<div className="absolute inset-x-0 bottom-0 flex items-end justify-end gap-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 pt-8 pb-2">
						<button
							className="rounded-lg bg-white/15 px-2.5 py-1 text-[11px] text-white backdrop-blur-sm transition hover:bg-white/25 disabled:opacity-50"
							disabled={disabled || isUploading}
							onClick={openPicker}
							type="button"
						>
							{isUploading ? (
								<Loader2 className="mr-1 inline size-3 animate-spin" />
							) : (
								<Upload className="mr-1 inline size-3" />
							)}
							Replace
						</button>
						<button
							aria-label="Remove image"
							className="inline-flex size-7 items-center justify-center rounded-lg bg-white/15 text-white backdrop-blur-sm transition hover:bg-rose-500/60 disabled:opacity-50"
							disabled={disabled || isUploading}
							onClick={() => onChange("")}
							type="button"
						>
							<Trash2 className="size-3" />
						</button>
					</div>
				</div>
			) : (
				<button
					aria-label="Drop image here, click to browse, or paste from clipboard"
					className={cn(
						"flex w-full items-center gap-2.5 rounded-xl border border-foreground/12 border-dashed px-3 py-4 text-left transition disabled:cursor-not-allowed",
						isDragOver
							? "border-foreground/40 bg-foreground/[0.04]"
							: "hover:border-foreground/20 hover:bg-muted/5",
						disabled && "opacity-60"
					)}
					disabled={disabled || isUploading}
					onClick={openPicker}
					onDragLeave={(event) => {
						event.preventDefault();
						setDragOver(false);
					}}
					onDragOver={(event) => {
						event.preventDefault();
						setDragOver(true);
					}}
					onDrop={handleDrop}
					onPaste={handlePaste}
					type="button"
				>
					<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/15 dark:bg-muted/10">
						{isUploading ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<ImageUp className="size-4 text-muted-foreground" />
						)}
					</span>
					<span className="grid min-w-0">
						<span className="text-xs">
							{isUploading
								? "Uploading…"
								: "Drop image, click to browse, or paste"}
						</span>
						<span className="text-[11px] text-muted-foreground">
							{helperText ??
								`PNG, JPG, WEBP up to ${formatBytes(maxSizeBytes)}`}
						</span>
					</span>
				</button>
			)}
		</div>
	);
}
