"use client";

import type { ExecutionPhase } from "@generator/contracts/generator";
import { cn } from "@generator/ui/lib/utils";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export type RunProgressStatus = "queued" | "running" | "succeeded" | "failed";

export type RunProgressVariant = "bar" | "circle" | "inline";

export interface RunProgressIndicatorProps {
	className?: string;
	/** Текст ошибки — показывается под индикатором, если status === "failed". */
	errorSummary?: string | null;
	/** Грубая оценка остатка в миллисекундах — рендерится как ETA. */
	etaMs?: number | null;
	/** Скрыть процент. Полезно, когда вокруг и так много текста. */
	hidePercent?: boolean;
	/** Скрыть подпись фазы под прогрессом (для inline-варианта). */
	hidePhaseLabel?: boolean;
	/** Последняя строка лога — рендерится под подписью фазы (truncate). */
	lastLogLine?: string | null;
	/** Дискретная фаза для подписи. */
	phase?: ExecutionPhase | null;
	/** 0–100. Если undefined/null — рендерится shimmer-fallback. */
	progressPct?: number | null;
	/** Позиция в очереди провайдера (только если phase = in_queue). */
	queuePosition?: number | null;
	/** Размер circle-варианта в px. По умолчанию 40. Игнорируется для bar/inline. */
	size?: number;
	/** Текущий статус run'а — определяет цвет и иконку. */
	status: RunProgressStatus;
	/** Геометрия: горизонтальный bar (default), круг или inline-чип. */
	variant?: RunProgressVariant;
}

const PHASE_LABEL_RU: Record<ExecutionPhase, string> = {
	done: "Готово",
	failed: "Ошибка",
	finalizing: "Финализация",
	in_queue: "В очереди",
	queued: "Поставлен в очередь",
	running: "Генерация",
	submitting: "Отправка",
};

function formatEta(etaMs: number | null | undefined): string | null {
	if (etaMs === null || etaMs === undefined) {
		return null;
	}
	if (etaMs <= 0) {
		return "вот-вот";
	}
	const totalSeconds = Math.round(etaMs / 1000);
	if (totalSeconds < 60) {
		return `~${totalSeconds}с`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes < 10 && seconds > 0) {
		return `~${minutes}м ${seconds}с`;
	}
	return `~${minutes}м`;
}

function getStatusTone(status: RunProgressStatus) {
	if (status === "failed") {
		return {
			ring: "stroke-rose-500",
			text: "text-rose-600 dark:text-rose-400",
			track: "bg-rose-500/15",
			fill: "bg-rose-500",
		} as const;
	}
	if (status === "succeeded") {
		return {
			ring: "stroke-emerald-500",
			text: "text-emerald-600 dark:text-emerald-400",
			track: "bg-emerald-500/15",
			fill: "bg-emerald-500",
		} as const;
	}
	return {
		ring: "stroke-violet-500",
		text: "text-violet-600 dark:text-violet-400",
		track: "bg-violet-500/15",
		fill: "bg-violet-500",
	} as const;
}

function buildPhaseLabel(
	phase: ExecutionPhase | null | undefined,
	queuePosition: number | null | undefined,
	etaMs: number | null | undefined,
	status: RunProgressStatus
): string {
	if (status === "succeeded") {
		return PHASE_LABEL_RU.done;
	}
	if (status === "failed") {
		return PHASE_LABEL_RU.failed;
	}
	let base: string;
	if (phase) {
		base = PHASE_LABEL_RU[phase];
	} else if (status === "queued") {
		base = PHASE_LABEL_RU.queued;
	} else {
		base = PHASE_LABEL_RU.running;
	}
	const eta = formatEta(etaMs);
	if (phase === "in_queue" && typeof queuePosition === "number") {
		const tail = eta ? `, ${eta}` : "";
		return `${base} #${queuePosition + 1}${tail}`;
	}
	return eta ? `${base} • ${eta}` : base;
}

function PercentLabel({
	progressPct,
	className,
}: {
	className?: string;
	progressPct: number | null | undefined;
}) {
	if (typeof progressPct !== "number") {
		return null;
	}
	return (
		<span className={cn("font-medium tabular-nums leading-none", className)}>
			{Math.round(progressPct)}%
		</span>
	);
}

function ShimmerFallback({ className }: { className?: string }) {
	return (
		<div
			className={cn(
				"relative h-1.5 w-full overflow-hidden rounded-full bg-muted/60",
				className
			)}
		>
			<div className="absolute inset-y-0 -left-1/3 w-1/3 animate-[run-progress-shimmer_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />
		</div>
	);
}

function StatusIcon({
	className,
	status,
}: {
	className?: string;
	status: RunProgressStatus;
}) {
	if (status === "succeeded") {
		return <CheckCircle2 className={cn("size-3.5", className)} />;
	}
	if (status === "failed") {
		return <XCircle className={cn("size-3.5", className)} />;
	}
	return <Loader2 className={cn("size-3.5 animate-spin", className)} />;
}

function RunProgressCircleVariant({
	className,
	clamped,
	hasProgress,
	hidePercent,
	phaseLabel,
	size,
	status,
	tone,
}: {
	className?: string;
	clamped: number;
	hasProgress: boolean;
	hidePercent?: boolean;
	phaseLabel: string;
	size: number;
	status: RunProgressStatus;
	tone: ReturnType<typeof getStatusTone>;
}) {
	const stroke = 4;
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	const dashOffset = hasProgress
		? circumference - (clamped / 100) * circumference
		: circumference * 0.7;
	return (
		<div
			aria-label={phaseLabel}
			aria-valuemax={100}
			aria-valuemin={0}
			aria-valuenow={hasProgress ? Math.round(clamped) : undefined}
			className={cn(
				"inline-flex items-center justify-center",
				hasProgress ? "" : "animate-[run-progress-spin_2s_linear_infinite]",
				className
			)}
			role="progressbar"
			style={{ width: size, height: size }}
		>
			<svg height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
				<title>{phaseLabel}</title>
				<circle
					className="stroke-muted/40"
					cx={size / 2}
					cy={size / 2}
					fill="none"
					r={radius}
					strokeWidth={stroke}
				/>
				<circle
					className={cn(
						tone.ring,
						"transition-[stroke-dashoffset] duration-500 ease-out"
					)}
					cx={size / 2}
					cy={size / 2}
					fill="none"
					r={radius}
					strokeDasharray={circumference}
					strokeDashoffset={dashOffset}
					strokeLinecap="round"
					strokeWidth={stroke}
					transform={`rotate(-90 ${size / 2} ${size / 2})`}
				/>
			</svg>
			<span
				className={cn(
					"absolute font-semibold text-[10px] tabular-nums",
					tone.text
				)}
			>
				{hasProgress && !hidePercent ? `${Math.round(clamped)}%` : null}
				{!hasProgress && status === "queued" ? "•••" : null}
			</span>
		</div>
	);
}

function RunProgressInlineVariant({
	className,
	clamped,
	hasProgress,
	hidePercent,
	phaseLabel,
	status,
	tone,
}: {
	className?: string;
	clamped: number;
	hasProgress: boolean;
	hidePercent?: boolean;
	phaseLabel: string;
	status: RunProgressStatus;
	tone: ReturnType<typeof getStatusTone>;
}) {
	return (
		<span
			aria-label={phaseLabel}
			className={cn(
				"inline-flex items-center gap-1.5 text-[11px] leading-none",
				tone.text,
				className
			)}
			role="status"
		>
			<StatusIcon status={status} />
			<span className="font-medium">{phaseLabel}</span>
			{hasProgress && !hidePercent ? (
				<PercentLabel progressPct={clamped} />
			) : null}
		</span>
	);
}

function RunProgressBarVariant({
	className,
	clamped,
	errorSummary,
	hasProgress,
	hidePercent,
	hidePhaseLabel,
	lastLogLine,
	phaseLabel,
	status,
	tone,
}: {
	className?: string;
	clamped: number;
	errorSummary?: string | null;
	hasProgress: boolean;
	hidePercent?: boolean;
	hidePhaseLabel?: boolean;
	lastLogLine?: string | null;
	phaseLabel: string;
	status: RunProgressStatus;
	tone: ReturnType<typeof getStatusTone>;
}) {
	return (
		<div className={cn("grid gap-1.5", className)}>
			{hasProgress ? (
				<div
					aria-label={phaseLabel}
					aria-valuemax={100}
					aria-valuemin={0}
					aria-valuenow={Math.round(clamped)}
					className={cn(
						"relative h-1.5 w-full overflow-hidden rounded-full",
						tone.track
					)}
					role="progressbar"
				>
					<div
						className={cn(
							"absolute inset-y-0 left-0 transition-[width] duration-500 ease-out",
							tone.fill
						)}
						style={{ width: `${clamped}%` }}
					/>
				</div>
			) : (
				<ShimmerFallback />
			)}
			{hidePhaseLabel ? null : (
				<div
					className={cn(
						"flex items-center justify-between gap-2 text-[11px] leading-none",
						tone.text
					)}
				>
					<span className="flex items-center gap-1.5 font-medium">
						<StatusIcon status={status} />
						{phaseLabel}
					</span>
					{hidePercent ? null : <PercentLabel progressPct={clamped} />}
				</div>
			)}
			{lastLogLine && status !== "succeeded" ? (
				<span className="truncate text-[10px] text-muted-foreground/80">
					{lastLogLine}
				</span>
			) : null}
			{errorSummary && status === "failed" ? (
				<span className="text-[11px] text-rose-600 dark:text-rose-400">
					{errorSummary}
				</span>
			) : null}
		</div>
	);
}

/**
 * Универсальный индикатор прогресса генерации, привязанный к кросс-рантайм
 * полям run'а (`progressPct`, `phase`, `etaMs`, `queuePosition`, `lastLogLine`).
 *
 * Дизайн-логика:
 *   - Если `progressPct` есть (real или soft-progress) — рисуем заполнение.
 *   - Если нет (только что добавлен в очередь / старая запись из БД без поля) —
 *     рисуем shimmer-плейсхолдер вместо нулевой полосы, чтобы UI не выглядел
 *     застывшим.
 *   - Цвет и иконка определяются `status`, а не `phase`: это самые жёсткие
 *     инварианты, которые приходят из сервера всегда.
 *   - Подпись фазы (`PHASE_LABEL_RU[phase]`) и ETA — необязательные, спрятать
 *     можно через `hidePhaseLabel` / отсутствие `etaMs`.
 *
 * Использовать там, где раньше показывался обычный спиннер или просто статус.
 */
export function RunProgressIndicator({
	className,
	errorSummary,
	etaMs,
	hidePercent,
	hidePhaseLabel,
	lastLogLine,
	phase,
	progressPct,
	queuePosition,
	size = 40,
	status,
	variant = "bar",
}: RunProgressIndicatorProps) {
	const tone = getStatusTone(status);
	const phaseLabel = buildPhaseLabel(phase, queuePosition, etaMs, status);
	const hasProgress = typeof progressPct === "number";
	const clamped = hasProgress
		? Math.max(0, Math.min(100, progressPct as number))
		: 0;

	if (variant === "circle") {
		return (
			<RunProgressCircleVariant
				clamped={clamped}
				className={className}
				hasProgress={hasProgress}
				hidePercent={hidePercent}
				phaseLabel={phaseLabel}
				size={size}
				status={status}
				tone={tone}
			/>
		);
	}

	if (variant === "inline") {
		return (
			<RunProgressInlineVariant
				clamped={clamped}
				className={className}
				hasProgress={hasProgress}
				hidePercent={hidePercent}
				phaseLabel={phaseLabel}
				status={status}
				tone={tone}
			/>
		);
	}

	return (
		<RunProgressBarVariant
			clamped={clamped}
			className={className}
			errorSummary={errorSummary}
			hasProgress={hasProgress}
			hidePercent={hidePercent}
			hidePhaseLabel={hidePhaseLabel}
			lastLogLine={lastLogLine}
			phaseLabel={phaseLabel}
			status={status}
			tone={tone}
		/>
	);
}
