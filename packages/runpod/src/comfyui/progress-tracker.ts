const TRAILING_SLASH = /\/$/u;
const HTTPS_PREFIX = /^https:\/\//u;
const HTTP_PREFIX = /^http:\/\//u;
const SAMPLING_FLOOR_PCT = 8;
const SAMPLING_CEIL_PCT = 90;
const MAX_LOG_LINE_LENGTH = 500;
const SESSION_TTL_MS = 30 * 60 * 1000;
const RECONNECT_DELAY_MS = 2000;

export interface ComfyProgressSnapshot {
	lastLogLine: string | null;
	progressPct: number | null;
	updatedAt: number;
}

export interface EnsureComfyProgressTrackingInput {
	baseUrl: string;
	clientId: string;
	cookieHeader?: string | null;
	totalNodes?: number;
	workflow?: Record<string, unknown>;
}

export interface ComfyProgressTracker {
	ensureTracking(input: EnsureComfyProgressTrackingInput): void;
	getSnapshot(clientId: string): ComfyProgressSnapshot | null;
	stopTracking(clientId: string): void;
}

interface TrackSession {
	baseUrl: string;
	clientId: string;
	cookieHeader: string | null;
	currentNode: string | null;
	executedNodes: Set<string>;
	reconnectTimer: ReturnType<typeof setTimeout> | null;
	snapshot: ComfyProgressSnapshot;
	totalNodes: number;
	ttlTimer: ReturnType<typeof setTimeout> | null;
	workflow?: Record<string, unknown>;
	ws: WebSocket | null;
}

export function buildComfyWebSocketUrl(
	baseUrl: string,
	clientId: string
): string {
	const normalized = baseUrl.replace(TRAILING_SLASH, "");
	const wsBase = normalized.startsWith("https://")
		? normalized.replace(HTTPS_PREFIX, "wss://")
		: normalized.replace(HTTP_PREFIX, "ws://");
	return `${wsBase}/ws?clientId=${encodeURIComponent(clientId)}`;
}

function truncateLogLine(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}
	return trimmed.length > MAX_LOG_LINE_LENGTH
		? trimmed.slice(0, MAX_LOG_LINE_LENGTH)
		: trimmed;
}

function nodeLabel(
	workflow: Record<string, unknown> | undefined,
	nodeId: string | null
): string {
	if (!nodeId) {
		return "Processing";
	}
	const node = workflow?.[nodeId];
	if (!node || typeof node !== "object") {
		return `node ${nodeId}`;
	}
	const record = node as Record<string, unknown>;
	const meta = record._meta;
	if (meta && typeof meta === "object") {
		const title = (meta as Record<string, unknown>).title;
		if (typeof title === "string" && title.trim().length > 0) {
			return title.trim();
		}
	}
	if (typeof record.class_type === "string" && record.class_type.length > 0) {
		return record.class_type;
	}
	return `node ${nodeId}`;
}

function updateSnapshot(
	session: TrackSession,
	progressPct: number,
	lastLogLine: string | null
): void {
	const nextPct = Math.max(
		0,
		Math.min(SAMPLING_CEIL_PCT, Math.round(progressPct))
	);
	const prevPct = session.snapshot.progressPct ?? 0;
	const mergedPct = Math.max(prevPct, nextPct);
	const mergedLine = lastLogLine ?? session.snapshot.lastLogLine;
	if (
		mergedPct === session.snapshot.progressPct &&
		mergedLine === session.snapshot.lastLogLine
	) {
		return;
	}
	session.snapshot = {
		lastLogLine: mergedLine,
		progressPct: mergedPct,
		updatedAt: Date.now(),
	};
}

function handleProgressMessage(
	session: TrackSession,
	data: Record<string, unknown>
): void {
	const value = data.value;
	const maximum = data.max;
	const nodeId =
		(typeof data.node === "string" ? data.node : null) ?? session.currentNode;
	if (
		typeof value === "number" &&
		typeof maximum === "number" &&
		maximum > 0 &&
		Number.isFinite(value)
	) {
		const frac = Math.max(0, Math.min(1, value / maximum));
		const pct =
			SAMPLING_FLOOR_PCT + frac * (SAMPLING_CEIL_PCT - SAMPLING_FLOOR_PCT);
		const label = nodeLabel(session.workflow, nodeId);
		updateSnapshot(
			session,
			pct,
			truncateLogLine(`${label} ${Math.trunc(value)}/${Math.trunc(maximum)}`)
		);
	}
}

function handleExecutingMessage(
	session: TrackSession,
	data: Record<string, unknown>
): void {
	const nodeId = data.node;
	if (typeof nodeId !== "string" || nodeId.length === 0) {
		return;
	}
	session.executedNodes.add(nodeId);
	session.currentNode = nodeId;
	const done = Math.max(0, session.executedNodes.size - 1);
	const coarse = Math.min(
		SAMPLING_CEIL_PCT,
		(done / session.totalNodes) * SAMPLING_CEIL_PCT
	);
	updateSnapshot(
		session,
		coarse,
		truncateLogLine(nodeLabel(session.workflow, nodeId))
	);
}

function parseWsPayload(raw: unknown): Record<string, unknown> | null {
	if (typeof raw !== "string") {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		return null;
	}
	return null;
}

function closeSession(session: TrackSession): void {
	if (session.reconnectTimer) {
		clearTimeout(session.reconnectTimer);
		session.reconnectTimer = null;
	}
	if (session.ttlTimer) {
		clearTimeout(session.ttlTimer);
		session.ttlTimer = null;
	}
	if (session.ws) {
		session.ws.close();
		session.ws = null;
	}
}

export function createComfyProgressTracker(): ComfyProgressTracker {
	const sessions = new Map<string, TrackSession>();

	const connectSession = (session: TrackSession): void => {
		if (session.ws) {
			return;
		}
		const wsUrl = buildComfyWebSocketUrl(session.baseUrl, session.clientId);
		const ws = new WebSocket(wsUrl, {
			headers: session.cookieHeader
				? { cookie: session.cookieHeader }
				: undefined,
		});
		session.ws = ws;

		ws.addEventListener("message", (event) => {
			const envelope = parseWsPayload(event.data);
			if (!envelope) {
				return;
			}
			const type = envelope.type;
			const data = envelope.data;
			if (typeof type !== "string" || !data || typeof data !== "object") {
				return;
			}
			const record = data as Record<string, unknown>;
			if (type === "progress") {
				handleProgressMessage(session, record);
				return;
			}
			if (type === "executing") {
				handleExecutingMessage(session, record);
			}
		});

		const scheduleReconnect = () => {
			if (session.reconnectTimer || !sessions.has(session.clientId)) {
				return;
			}
			session.reconnectTimer = setTimeout(() => {
				session.reconnectTimer = null;
				if (sessions.has(session.clientId)) {
					connectSession(session);
				}
			}, RECONNECT_DELAY_MS);
		};

		ws.addEventListener("close", () => {
			session.ws = null;
			scheduleReconnect();
		});
		ws.addEventListener("error", () => {
			ws.close();
		});
	};

	return {
		ensureTracking(input) {
			const existing = sessions.get(input.clientId);
			if (existing) {
				existing.baseUrl = input.baseUrl;
				existing.cookieHeader = input.cookieHeader ?? null;
				if (input.workflow) {
					existing.workflow = input.workflow;
					existing.totalNodes = Math.max(
						1,
						input.totalNodes ?? Object.keys(input.workflow).length
					);
				}
				if (existing.ttlTimer) {
					clearTimeout(existing.ttlTimer);
				}
				existing.ttlTimer = setTimeout(() => {
					closeSession(existing);
					sessions.delete(input.clientId);
				}, SESSION_TTL_MS);
				connectSession(existing);
				return;
			}

			const totalNodes = Math.max(
				1,
				input.totalNodes ??
					(input.workflow ? Object.keys(input.workflow).length : 1)
			);
			const session: TrackSession = {
				baseUrl: input.baseUrl,
				clientId: input.clientId,
				cookieHeader: input.cookieHeader ?? null,
				currentNode: null,
				executedNodes: new Set(),
				reconnectTimer: null,
				snapshot: {
					lastLogLine: null,
					progressPct: null,
					updatedAt: Date.now(),
				},
				totalNodes,
				ttlTimer: setTimeout(() => {
					closeSession(session);
					sessions.delete(input.clientId);
				}, SESSION_TTL_MS),
				workflow: input.workflow,
				ws: null,
			};
			sessions.set(input.clientId, session);
			connectSession(session);
		},

		getSnapshot(clientId) {
			const session = sessions.get(clientId);
			if (!session) {
				return null;
			}
			if (
				session.snapshot.progressPct === null &&
				session.snapshot.lastLogLine === null
			) {
				return null;
			}
			return { ...session.snapshot };
		},

		stopTracking(clientId) {
			const session = sessions.get(clientId);
			if (!session) {
				return;
			}
			closeSession(session);
			sessions.delete(clientId);
		},
	};
}

/** Shared tracker for pod/static engines within one generator worker process. */
export const sharedComfyProgressTracker = createComfyProgressTracker();

export function mergeRunningProgress(input: {
	clientId: string;
	fallbackPct: number;
	tracker?: ComfyProgressTracker;
	tracking?: EnsureComfyProgressTrackingInput | null;
}): { lastLogLine: string | null; progressPct: number } {
	const tracker = input.tracker ?? sharedComfyProgressTracker;
	if (input.tracking) {
		tracker.ensureTracking(input.tracking);
	}
	const snapshot = tracker.getSnapshot(input.clientId);
	return {
		lastLogLine: snapshot?.lastLogLine ?? null,
		progressPct: Math.max(input.fallbackPct, snapshot?.progressPct ?? 0),
	};
}
