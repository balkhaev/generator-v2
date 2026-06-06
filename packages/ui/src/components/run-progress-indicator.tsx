"use client";

import type { ExecutionPhase } from "@generator/contracts/generator";
import { cn } from "@generator/ui/lib/utils";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type RunProgressStatus = "queued" | "running" | "succeeded" | "failed";

export type RunProgressVariant = "bar" | "circle" | "inline";

export interface RunProgressIndicatorProps {
	className?: string;
	/** Текст ошибки — показывается под индикатором, если status === "failed". */
	errorSummary?: string | null;
	/** Грубая оценка остатка в миллисекундах — рендерится как ETA. */
	etaMs?: number | null;
	/**
	 * Ожидаемая длительность всего ран'а (мс). При наличии этого пропа и
	 * статуса `running` индикатор начинает локально тикать soft-progress
	 * по формуле `(1 − exp(−elapsed / expected)) × 90%`, не дожидаясь
	 * Kafka/SSE апдейтов. В `queued` soft-progress отключен. Нужно для моделей,
	 * которые не отдают пошаговые `step X/Y`-логи (например, fal-wan-2-2).
	 */
	expectedDurationMs?: number | null;
	/** Скрыть процент. Полезно, когда вокруг и так много текста. */
	hidePercent?: boolean;
	/** Скрыть подпись фазы под прогрессом (для inline-варианта). */
	hidePhaseLabel?: boolean;
	/** Последняя строка лога — рендерится под подписью фазы (truncate). */
	lastLogLine?: string | null;
	/** Дискретная фаза для подписи. */
	phase?: ExecutionPhase | null;
	/**
	 * Стабильный id ран'а (обычно `run.id`). Сбрасывает локальный «пик»
	 * прогресса при смене генерации — иначе новый run наследует старый max.
	 */
	progressMonotonicKey?: string | null;
	/** 0–100. Если undefined/null — рендерится shimmer-fallback. */
	progressPct?: number | null;
	/** Позиция в очереди провайдера (только если phase = in_queue). */
	queuePosition?: number | null;
	/**
	 * Время старта ран'а (ISO-строка из `record.createdAt` либо `Date`).
	 * Точка отсчёта soft-progress интерполяции.
	 */
	runStartedAt?: Date | string | null;
	/** Размер circle-варианта в px. По умолчанию 40. Игнорируется для bar/inline. */
	size?: number;
	/** Текущий статус run'а — определяет цвет и иконку. */
	status: RunProgressStatus;
	/** Геометрия: горизонтальный bar (default), круг или inline-чип. */
	variant?: RunProgressVariant;
}

const SOFT_PROGRESS_CAP_PCT = 90;
const TICK_MS = 500;
/**
 * Постоянная времени «доползания» (re-anchored creep). После каждого реального
 * апдейта прогресс асимптотически приближается к 90% от последнего реального
 * значения с этой постоянной. ~60s → за 20s после остановки бар проходит ~28%
 * оставшегося зазора: достаточно, чтобы было видно «всё ещё работает», но без
 * фейкового рывка. Гарантирует, что бар не «висит» на 75%, даже если провайдер
 * перестал слать прогресс (хвостовые ноды ComfyUI) и нет expectedDurationMs.
 */
const CREEP_TAU_MS = 60_000;

/**
 * Та же формула, что у backend'а в `derivePhaseAndProgress` — асимптотический
 * подход к 90% по экспоненте. Так клиент и сервер сходятся к одному значению,
 * без скачков, когда наконец-то прилетает Kafka-апдейт.
 */
function computeSoftProgressPct(elapsedMs: number, expectedMs: number): number {
	if (expectedMs <= 0 || elapsedMs <= 0) {
		return 0;
	}
	const fraction = 1 - Math.exp(-elapsedMs / expectedMs);
	return Math.round(fraction * SOFT_PROGRESS_CAP_PCT);
}

function parseRunStartedAt(
	value: Date | string | null | undefined
): number | null {
	if (!value) {
		return null;
	}
	const ms = value instanceof Date ? value.getTime() : Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

/**
 * Один общий таймер: тикает каждые ~500ms, пока ран в `queued`/`running`.
 * Возвращает текущее `Date.now()`, на базе которого индикатор сам считает
 * прошедшее время (elapsed) и soft-progress интерполяцию между апдейтами.
 * Для терминальных статусов таймер выключен, чтобы не крутить лишние ререндеры.
 */
function useNowTicker(active: boolean): number {
	const [now, setNow] = useState<number>(() => Date.now());

	useEffect(() => {
		if (!active) {
			return;
		}
		setNow(Date.now());
		const handle = setInterval(() => {
			setNow(Date.now());
		}, TICK_MS);
		return () => clearInterval(handle);
	}, [active]);

	return now;
}

/**
 * Re-anchored creep: запоминает последнее реальное серверное значение и момент
 * его прихода; между апдейтами прогресс сам асимптотически ползёт к 90% от этой
 * точки. Так бар «постоянно двигается» и не зависает, даже когда провайдер
 * замолчал (хвостовые ноды ComfyUI), а workflow не задаёт expectedDurationMs.
 * Возвращает `null` для не-running статусов.
 */
function useReanchoredCreepPct(input: {
	now: number;
	progressMonotonicKey: string | null | undefined;
	serverProgressPct: number | null;
	status: RunProgressStatus;
}): number | null {
	const { now, progressMonotonicKey, serverProgressPct, status } = input;
	const anchorRef = useRef<{ at: number; pct: number }>({ at: now, pct: 0 });

	// biome-ignore lint/correctness/useExhaustiveDependencies: сброс якоря при смене run
	useEffect(() => {
		anchorRef.current = { at: Date.now(), pct: 0 };
	}, [progressMonotonicKey]);

	useEffect(() => {
		if (status !== "running") {
			return;
		}
		const serverPct = serverProgressPct ?? 0;
		if (serverPct > anchorRef.current.pct) {
			anchorRef.current = { at: Date.now(), pct: serverPct };
		}
	}, [serverProgressPct, status]);

	if (status !== "running") {
		return null;
	}
	const anchor = anchorRef.current;
	const dt = Math.max(0, now - anchor.at);
	return (
		anchor.pct +
		(SOFT_PROGRESS_CAP_PCT - anchor.pct) * (1 - Math.exp(-dt / CREEP_TAU_MS))
	);
}

/**
 * Сводит реальный прогресс сервера, soft-интерполяцию и creep в одно «сырое»
 * значение. Серверное задаёт нижнюю границу, остальные — плавность; берём max,
 * чтобы прогресс не двигался назад. `null` → нечего показывать (queued / нет
 * данных) → индетерминантный shimmer.
 */
function combineRawProgressPct(input: {
	creepPct: number | null;
	serverProgressPct: number | null;
	softProgressPct: number | null;
	status: RunProgressStatus;
}): number | null {
	const { creepPct, serverProgressPct, softProgressPct, status } = input;
	if (status === "succeeded") {
		return 100;
	}
	if (status === "queued") {
		return null;
	}
	if (
		serverProgressPct === null &&
		softProgressPct === null &&
		creepPct === null
	) {
		return null;
	}
	return Math.max(serverProgressPct ?? 0, softProgressPct ?? 0, creepPct ?? 0);
}

/**
 * Делает итоговый процент монотонным: держит «пик» в state и не даёт бару
 * откатываться назад между апдейтами. Сбрасывает пик при смене run id.
 */
function useMonotonicEffectivePct(input: {
	combinedRaw: number | null;
	progressMonotonicKey: string | null | undefined;
	status: RunProgressStatus;
}): number | null {
	const { combinedRaw, progressMonotonicKey, status } = input;
	const [peakProgressPct, setPeakProgressPct] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: сброс пика при смене run id
	useEffect(() => {
		setPeakProgressPct(0);
	}, [progressMonotonicKey]);

	useEffect(() => {
		if (status === "succeeded") {
			setPeakProgressPct(100);
			return;
		}
		if (status === "queued") {
			setPeakProgressPct(0);
			return;
		}
		if (status === "failed") {
			return;
		}
		if (typeof combinedRaw === "number") {
			setPeakProgressPct((previous) => Math.max(previous, combinedRaw));
		}
	}, [combinedRaw, status]);

	if (status === "succeeded") {
		return 100;
	}
	if (status === "queued") {
		return null;
	}
	if (typeof combinedRaw === "number") {
		return Math.max(combinedRaw, peakProgressPct);
	}
	return null;
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

/** Прошедшее время в формате `m:ss` (или `h:mm:ss` для долгих ранов). */
function formatElapsed(elapsedMs: number | null): string | null {
	if (elapsedMs === null || elapsedMs < 0) {
		return null;
	}
	const totalSeconds = Math.floor(elapsedMs / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const paddedSeconds = seconds.toString().padStart(2, "0");
	if (hours > 0) {
		const paddedMinutes = minutes.toString().padStart(2, "0");
		return `${hours}:${paddedMinutes}:${paddedSeconds}`;
	}
	return `${minutes}:${paddedSeconds}`;
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

function ElapsedLabel({ elapsed }: { elapsed: string | null }) {
	if (!elapsed) {
		return null;
	}
	return (
		<span className="font-normal text-muted-foreground/70 tabular-nums leading-none">
			{elapsed}
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
	elapsed,
	hasProgress,
	hidePercent,
	phaseLabel,
	status,
	tone,
}: {
	className?: string;
	clamped: number;
	elapsed: string | null;
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
			<ElapsedLabel elapsed={elapsed} />
		</span>
	);
}

function RunProgressBarVariant({
	className,
	clamped,
	elapsed,
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
	elapsed: string | null;
	errorSummary?: string | null;
	hasProgress: boolean;
	hidePercent?: boolean;
	hidePhaseLabel?: boolean;
	lastLogLine?: string | null;
	phaseLabel: string;
	status: RunProgressStatus;
	tone: ReturnType<typeof getStatusTone>;
}) {
	const isRunning = status === "running";
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
							"absolute inset-y-0 left-0 overflow-hidden rounded-full transition-[width] duration-500 ease-out",
							tone.fill
						)}
						style={{ width: `${clamped}%` }}
					>
						{isRunning ? (
							<div className="absolute inset-y-0 left-0 w-full animate-[run-progress-sheen_1.6s_linear_infinite] bg-gradient-to-r from-transparent via-white/35 to-transparent" />
						) : null}
					</div>
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
					<span className="flex min-w-0 items-center gap-1.5 font-medium">
						<StatusIcon status={status} />
						<span className="truncate">{phaseLabel}</span>
					</span>
					<span className="flex shrink-0 items-center gap-1.5">
						<ElapsedLabel elapsed={elapsed} />
						{hidePercent ? null : <PercentLabel progressPct={clamped} />}
					</span>
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
 *   - В `queued` процента ещё нет — рисуем индетерминантный shimmer (полоса)
 *     или спиннер (circle), чтобы было видно «ждём очередь», а не застывший 0%.
 *   - Если `progressPct` есть (real или soft-progress) — рисуем заполнение
 *     с бегущим бликом (sheen) поверх, пока ран в `running`.
 *   - Пока ран активен, тикает elapsed-таймер (m:ss) — постоянная обратная
 *     связь, даже когда процент между апдейтами стоит на месте.
 *   - Если прогресса нет — рисуем shimmer-плейсхолдер вместо нулевой полосы,
 *     чтобы UI не выглядел застывшим.
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
	expectedDurationMs,
	hidePercent,
	hidePhaseLabel,
	lastLogLine,
	phase,
	progressPct,
	progressMonotonicKey,
	queuePosition,
	runStartedAt,
	size = 40,
	status,
	variant = "bar",
}: RunProgressIndicatorProps) {
	const tone = getStatusTone(status);
	const isActive = status === "running" || status === "queued";
	const now = useNowTicker(isActive);
	const startedAtMs = parseRunStartedAt(runStartedAt);
	const elapsedMs =
		isActive && startedAtMs !== null ? Math.max(0, now - startedAtMs) : null;
	const expectedMs = expectedDurationMs ?? null;
	// Soft-progress интерполяция между Kafka/SSE-апдейтами — только в `running`
	// и только если знаем ожидаемую длительность ран'а.
	const softProgressPct =
		status === "running" && elapsedMs !== null && (expectedMs ?? 0) > 0
			? computeSoftProgressPct(elapsedMs, expectedMs as number)
			: null;
	const elapsedLabel = formatElapsed(elapsedMs);
	const serverProgressPct =
		typeof progressPct === "number" ? progressPct : null;
	const creepPct = useReanchoredCreepPct({
		now,
		progressMonotonicKey,
		serverProgressPct,
		status,
	});

	const combinedRaw = combineRawProgressPct({
		creepPct,
		serverProgressPct,
		softProgressPct,
		status,
	});
	const effectiveProgressPct = useMonotonicEffectivePct({
		combinedRaw,
		progressMonotonicKey,
		status,
	});
	const phaseLabel = buildPhaseLabel(phase, queuePosition, etaMs, status);
	const hasProgress = typeof effectiveProgressPct === "number";
	const clamped = hasProgress
		? Math.max(0, Math.min(100, effectiveProgressPct as number))
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
				elapsed={elapsedLabel}
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
			elapsed={elapsedLabel}
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
