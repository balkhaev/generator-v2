"use client";

import { Button } from "@generator/ui/components/button";
import { formatDateTime, formatRelativeTime } from "@generator/ui/lib/format";
import { cn } from "@generator/ui/lib/utils";
import {
	Check,
	ChevronLeft,
	ChevronRight,
	Copy,
	Download,
	ExternalLink,
	ImageIcon,
	Loader2,
	Trash2,
	Video as VideoIcon,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export interface LightboxItem {
	artifactKind: "image" | "video";
	badge: string;
	createdAt: string;
	description: string | null;
	fullUrl: string;
	id: string;
	openHref: string;
	personName: string | null;
	scenarioName: string | null;
	subtitle: string;
	title: string;
}

interface ShotsLightboxProps {
	canDelete: (item: LightboxItem) => boolean;
	deletingId: string | null;
	index: number;
	items: LightboxItem[];
	onClose: () => void;
	onDelete: (item: LightboxItem) => void;
	onNavigate: (index: number) => void;
}

const VIDEO_EXTS_PATTERN = /\.(jpe?g|png|webp|gif|mp4|webm|mov|m4v)$/i;

function inferDownloadName(item: LightboxItem) {
	const ext = (() => {
		try {
			const path = new URL(item.fullUrl).pathname;
			const match = path.match(VIDEO_EXTS_PATTERN);
			if (match) {
				return match[0].toLowerCase();
			}
			return item.artifactKind === "video" ? ".mp4" : ".jpg";
		} catch {
			return item.artifactKind === "video" ? ".mp4" : ".jpg";
		}
	})();
	const base = (item.title ?? "shot").replace(/[^\w\d]+/g, "-").slice(0, 60);
	return `${base || "shot"}-${item.id}${ext}`;
}

export default function ShotsLightbox({
	canDelete,
	deletingId,
	index,
	items,
	onClose,
	onDelete,
	onNavigate,
}: ShotsLightboxProps) {
	const item = items[index];
	const [copied, setCopied] = useState(false);
	const videoRef = useRef<HTMLVideoElement | null>(null);

	const goPrev = useCallback(() => {
		if (index > 0) {
			onNavigate(index - 1);
		}
	}, [index, onNavigate]);

	const goNext = useCallback(() => {
		if (index < items.length - 1) {
			onNavigate(index + 1);
		}
	}, [index, items.length, onNavigate]);

	useEffect(() => {
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
				return;
			}
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				goPrev();
				return;
			}
			if (event.key === "ArrowRight") {
				event.preventDefault();
				goNext();
				return;
			}
			if (event.key === " " && videoRef.current) {
				event.preventDefault();
				if (videoRef.current.paused) {
					videoRef.current.play().catch(() => undefined);
				} else {
					videoRef.current.pause();
				}
			}
		};
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [goNext, goPrev, onClose]);

	useEffect(() => {
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = previous;
		};
	}, []);

	useEffect(() => {
		setCopied(false);
	}, []);

	if (!item) {
		return null;
	}

	const hasMultiple = items.length > 1;
	const isVideo = item.artifactKind === "video";
	const allowDelete = canDelete(item);
	const isDeleting = deletingId === item.id;

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(item.fullUrl);
			setCopied(true);
			toast.success("Ссылка скопирована");
			setTimeout(() => setCopied(false), 1600);
		} catch {
			toast.error("Не удалось скопировать ссылку");
		}
	};

	const downloadName = inferDownloadName(item);

	return (
		<div
			aria-label="Просмотр медиа"
			aria-modal="true"
			className="fade-in fixed inset-0 z-50 flex animate-in flex-col bg-black/85 backdrop-blur-md duration-150"
			role="dialog"
		>
			<button
				aria-label="Закрыть"
				className="absolute inset-0 cursor-default"
				onClick={onClose}
				tabIndex={-1}
				type="button"
			/>

			<header className="pointer-events-none relative z-10 flex items-start justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
				<div className="pointer-events-auto flex min-w-0 flex-col gap-1 text-white">
					<div className="flex flex-wrap items-center gap-2">
						<span className="inline-flex items-center gap-1 rounded-full bg-white/12 px-2 py-0.5 font-medium text-[11px] text-white/85 uppercase tracking-wide backdrop-blur">
							{isVideo ? (
								<VideoIcon className="size-3" />
							) : (
								<ImageIcon className="size-3" />
							)}
							{item.badge}
						</span>
						{hasMultiple ? (
							<span className="rounded-full bg-white/12 px-2 py-0.5 text-[11px] text-white/70 tabular-nums backdrop-blur">
								{index + 1} / {items.length}
							</span>
						) : null}
						<span
							className="text-[11px] text-white/55"
							title={formatDateTime(item.createdAt)}
						>
							{formatRelativeTime(item.createdAt)}
						</span>
					</div>
					<h2 className="truncate font-semibold text-base leading-tight">
						{item.title}
					</h2>
					{item.subtitle ? (
						<p className="truncate text-white/65 text-xs">{item.subtitle}</p>
					) : null}
				</div>

				<div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
					<Button
						aria-label="Скопировать ссылку"
						className="text-white/85 hover:bg-white/10 hover:text-white"
						onClick={() => {
							handleCopy().catch(() => undefined);
						}}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						{copied ? (
							<Check className="size-3.5" />
						) : (
							<Copy className="size-3.5" />
						)}
					</Button>

					<Button
						aria-label="Скачать"
						className="text-white/85 hover:bg-white/10 hover:text-white"
						render={
							<a
								download={downloadName}
								href={item.fullUrl}
								rel="noreferrer"
								target="_blank"
							>
								<Download className="size-3.5" />
							</a>
						}
						size="icon-sm"
						variant="ghost"
					/>

					<Button
						aria-label="Открыть оригинал"
						className="text-white/85 hover:bg-white/10 hover:text-white"
						render={
							<a href={item.openHref} rel="noreferrer" target="_blank">
								<ExternalLink className="size-3.5" />
							</a>
						}
						size="icon-sm"
						variant="ghost"
					/>

					{allowDelete ? (
						<Button
							aria-label="Удалить"
							className="text-white/85 hover:bg-rose-500/30 hover:text-white"
							disabled={isDeleting}
							onClick={() => onDelete(item)}
							size="icon-sm"
							type="button"
							variant="ghost"
						>
							{isDeleting ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<Trash2 className="size-3.5" />
							)}
						</Button>
					) : null}

					<Button
						aria-label="Закрыть"
						className="text-white/85 hover:bg-white/10 hover:text-white"
						onClick={onClose}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<X className="size-4" />
					</Button>
				</div>
			</header>

			{hasMultiple ? (
				<>
					<button
						aria-label="Предыдущее"
						className={cn(
							"absolute top-1/2 left-2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/8 text-white backdrop-blur-md transition hover:bg-white/16 disabled:opacity-25 disabled:hover:bg-white/8 sm:left-4"
						)}
						disabled={index === 0}
						onClick={goPrev}
						type="button"
					>
						<ChevronLeft className="size-5" />
					</button>
					<button
						aria-label="Следующее"
						className={cn(
							"absolute top-1/2 right-2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/8 text-white backdrop-blur-md transition hover:bg-white/16 disabled:opacity-25 disabled:hover:bg-white/8 sm:right-4"
						)}
						disabled={index === items.length - 1}
						onClick={goNext}
						type="button"
					>
						<ChevronRight className="size-5" />
					</button>
				</>
			) : null}

			<div className="pointer-events-none relative z-0 flex flex-1 items-center justify-center px-4 py-6 sm:px-16 sm:py-10">
				<div className="pointer-events-auto flex max-h-full max-w-full items-center justify-center">
					{isVideo ? (
						<video
							autoPlay
							className="max-h-[78vh] max-w-[92vw] rounded-md bg-black object-contain shadow-2xl"
							controls
							key={item.id}
							loop
							playsInline
							preload="auto"
							ref={videoRef}
							src={item.fullUrl}
						>
							<track kind="captions" />
						</video>
					) : (
						// biome-ignore lint/performance/noImgElement: external CDN images, next/image not configured for these hosts
						// biome-ignore lint/correctness/useImageSize: dimensions unknown for remote artifacts; object-contain prevents CLS within fixed parent
						<img
							alt={item.title}
							className="max-h-[82vh] max-w-[92vw] rounded-md object-contain shadow-2xl"
							decoding="async"
							draggable={false}
							key={item.id}
							src={item.fullUrl}
						/>
					)}
				</div>
			</div>

			{item.description ? (
				<footer className="pointer-events-none relative z-10 flex justify-center px-4 pb-5 sm:px-6 sm:pb-6">
					<div className="pointer-events-auto w-full max-w-3xl rounded-xl border border-white/10 bg-black/55 px-4 py-3 text-white shadow-lg backdrop-blur-md">
						<div className="mb-1 text-[10px] text-white/55 uppercase tracking-wider">
							{isVideo ? "Описание" : "Промпт"}
						</div>
						<p className="max-h-32 overflow-y-auto text-sm text-white/85 leading-relaxed">
							{item.description}
						</p>
					</div>
				</footer>
			) : null}
		</div>
	);
}
