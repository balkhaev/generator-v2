"use client";

import { env } from "@generator/env/web";
import { normalizeBaseUrl } from "@generator/http/shared";
import type { ScenarioRunRecord } from "@generator/studio-client/shared";
import { useEffect, useRef } from "react";

const STREAM_PATH = "/api/runs/stream";
/** Базовая задержка реконнекта (×2 с каждым неудачным retry, capped). */
const RECONNECT_BASE_DELAY_MS = 1500;
/** Потолок экспоненциального backoff. */
const RECONNECT_MAX_DELAY_MS = 30_000;
/** Сколько ждать перед fallback-poll, если SSE так и не открылся. */
const FALLBACK_POLL_INTERVAL_MS = 8000;

interface ServerWireRun {
	artifactUrls?: string[] | null;
	createdAt?: string | null;
	errorSummary?: string | null;
	etaMs?: number | null;
	/**
	 * Иначе при каждом SSE `run` теряется soft-progress: клиент затирает run и
	 * `expectedDurationMs` становится undefined → индикатор откатывается к
	 * серверному floor (8%).
	 */
	expectedDurationMs?: number | null;
	generatorRunId?: string | null;
	id: string;
	inputImageUrl?: string | null;
	inputLabel?: string | null;
	inputPersonGenerationId?: string | null;
	inputPersonId?: string | null;
	lastLogLine?: string | null;
	loraPersonId?: string | null;
	phase?: ScenarioRunRecord["phase"];
	progressPct?: number | null;
	providerEndpointId?: string | null;
	providerJobId?: string | null;
	queuePosition?: number | null;
	scenarioId?: string | null;
	scenarioName?: string | null;
	status?: ScenarioRunRecord["status"];
	workflowKey?: string | null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: плоский маппинг wire → DTO
function toScenarioRunRecord(
	payload: ServerWireRun,
	knownScenarioName: string | undefined
): ScenarioRunRecord {
	const scenarioName =
		knownScenarioName ?? payload.scenarioName ?? "Unknown scenario";
	return {
		artifactUrls: payload.artifactUrls ?? [],
		createdAt: payload.createdAt ?? new Date().toISOString(),
		errorSummary: payload.errorSummary ?? null,
		etaMs: payload.etaMs ?? null,
		expectedDurationMs: payload.expectedDurationMs ?? null,
		generatorRunId: payload.generatorRunId ?? null,
		id: payload.id,
		inputImageUrl: payload.inputImageUrl ?? "",
		inputLabel: payload.inputLabel ?? "",
		inputPersonGenerationId: payload.inputPersonGenerationId ?? null,
		inputPersonId: payload.inputPersonId ?? null,
		lastLogLine: payload.lastLogLine ?? null,
		loraPersonId: payload.loraPersonId ?? null,
		phase: payload.phase ?? null,
		progressPct: payload.progressPct ?? null,
		providerEndpointId: payload.providerEndpointId ?? null,
		providerJobId: payload.providerJobId ?? null,
		queuePosition: payload.queuePosition ?? null,
		scenarioId: payload.scenarioId ?? "",
		scenarioName,
		status: payload.status ?? "queued",
		workflowKey: payload.workflowKey ?? "",
	};
}

interface UseStudioRunStreamOptions {
	enabled: boolean;
	/**
	 * Резервный поллер на случай, когда SSE никак не подключается (network/proxy).
	 * Вызывается с интервалом FALLBACK_POLL_INTERVAL_MS, пока хук считает SSE
	 * недоступным. Снятие fallback'а происходит автоматически после первого
	 * успешного сообщения от сервера.
	 */
	onFallbackPoll?: () => Promise<unknown> | unknown;
	/**
	 * Применить snapshot (полный список активных run'ов с сервера) — например,
	 * после реконнекта — поверх текущего state. Передавать функцию типа
	 * `(runs: ScenarioRunRecord[]) => void`, которая мержит/заменяет активные.
	 */
	onSnapshot: (runs: ScenarioRunRecord[]) => void;
	/** Обновить один run (upsert по id). */
	onUpdate: (run: ScenarioRunRecord) => void;
	/**
	 * Карта scenarioId → имя сценария, чтобы overridить серверное имя локально
	 * (например, после переименования в текущей сессии). Опционально.
	 */
	scenarioNames?: ReadonlyMap<string, string>;
}

/**
 * Подписка на live-обновления run'ов через SSE-эндпоинт `/api/runs/stream`.
 *
 * Семантика:
 *   - На открытии стрима сервер шлёт event=`snapshot` с активными run'ами —
 *     прокидывается в `onSnapshot`.
 *   - На каждое изменение приходит event=`run` — прокидывается в `onUpdate`.
 *   - `ping` каждые 25s — игнорируется (нужен только для keep-alive прокси).
 *   - При ошибке/закрытии — экспоненциальный backoff (capped 30s).
 *   - Если SSE так и не открылся (нет ни одного успешного сообщения), запускается
 *     fallback-поллер `onFallbackPoll` с интервалом 8s — он подтягивает свежий
 *     snapshot обычным GET'ом, чтобы UI хотя бы изредка обновлялся.
 */
export function useStudioRunStream({
	enabled,
	onSnapshot,
	onUpdate,
	onFallbackPoll,
	scenarioNames,
}: UseStudioRunStreamOptions) {
	const onSnapshotRef = useRef(onSnapshot);
	const onUpdateRef = useRef(onUpdate);
	const onFallbackPollRef = useRef(onFallbackPoll);
	const scenarioNamesRef = useRef(scenarioNames);

	useEffect(() => {
		onSnapshotRef.current = onSnapshot;
	}, [onSnapshot]);
	useEffect(() => {
		onUpdateRef.current = onUpdate;
	}, [onUpdate]);
	useEffect(() => {
		onFallbackPollRef.current = onFallbackPoll;
	}, [onFallbackPoll]);
	useEffect(() => {
		scenarioNamesRef.current = scenarioNames;
	}, [scenarioNames]);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		if (typeof window === "undefined" || typeof EventSource === "undefined") {
			return;
		}

		const apiBaseUrl = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);
		const url = `${apiBaseUrl}${STREAM_PATH}`;

		let cancelled = false;
		let source: EventSource | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let fallbackTimer: ReturnType<typeof setInterval> | null = null;
		let attempt = 0;
		let receivedAnyMessage = false;

		const stopFallbackPolling = () => {
			if (fallbackTimer !== null) {
				clearInterval(fallbackTimer);
				fallbackTimer = null;
			}
		};

		const startFallbackPolling = () => {
			if (fallbackTimer !== null || !onFallbackPollRef.current) {
				return;
			}
			fallbackTimer = setInterval(() => {
				const fn = onFallbackPollRef.current;
				if (!fn) {
					return;
				}
				try {
					Promise.resolve(fn()).catch(() => undefined);
				} catch {
					// silent: fallback poll best-effort
				}
			}, FALLBACK_POLL_INTERVAL_MS);
		};

		const resolveScenarioName = (run: ServerWireRun): string | undefined => {
			const map = scenarioNamesRef.current;
			if (!(map && run.scenarioId)) {
				return undefined;
			}
			return map.get(run.scenarioId);
		};

		const connect = () => {
			if (cancelled) {
				return;
			}
			try {
				source = new EventSource(url, { withCredentials: true });
			} catch {
				scheduleReconnect();
				return;
			}

			source.addEventListener("snapshot", (event) => {
				receivedAnyMessage = true;
				stopFallbackPolling();
				attempt = 0;
				try {
					const data = JSON.parse((event as MessageEvent).data) as {
						runs?: ServerWireRun[];
					};
					const runs = (data.runs ?? []).map((run) =>
						toScenarioRunRecord(run, resolveScenarioName(run))
					);
					onSnapshotRef.current(runs);
				} catch {
					// silent: malformed snapshot
				}
			});

			source.addEventListener("run", (event) => {
				receivedAnyMessage = true;
				stopFallbackPolling();
				attempt = 0;
				try {
					const data = JSON.parse(
						(event as MessageEvent).data
					) as ServerWireRun;
					if (!data?.id) {
						return;
					}
					onUpdateRef.current(
						toScenarioRunRecord(data, resolveScenarioName(data))
					);
				} catch {
					// silent
				}
			});

			source.addEventListener("ping", () => {
				receivedAnyMessage = true;
			});

			source.onerror = () => {
				source?.close();
				source = null;
				if (!receivedAnyMessage) {
					startFallbackPolling();
				}
				scheduleReconnect();
			};
		};

		const scheduleReconnect = () => {
			if (cancelled) {
				return;
			}
			const delay = Math.min(
				RECONNECT_MAX_DELAY_MS,
				RECONNECT_BASE_DELAY_MS * 2 ** attempt
			);
			attempt += 1;
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				connect();
			}, delay);
		};

		connect();

		return () => {
			cancelled = true;
			if (reconnectTimer !== null) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			stopFallbackPolling();
			source?.close();
			source = null;
		};
	}, [enabled]);
}
