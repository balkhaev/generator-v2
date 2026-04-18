import { EventEmitter } from "node:events";

export type RunEmitterListener<TRecord> = (record: TRecord) => void;

/**
 * In-memory pub/sub для live-обновлений runs.
 *
 * Используется SSE-роутом `GET /api/runs/stream` (см. routes/runs.ts):
 * каждый web-instance держит локальный emitter и публикует туда run-record
 * после applyExecutionCallback / launchRun / syncRun / markRunFailed.
 *
 * Поскольку каждый клиент держит собственный SSE к одному web-instance,
 * a Kafka consumer поднимается ВНУТРИ apps/studio — обновление, пришедшее
 * на любую реплику, попадёт во все её SSE-сабскрайбы. Между репликами
 * sticky-сессия не нужна: те же события приходят в каждую реплику Kafka'й.
 */
export class RunUpdatesEmitter<TRecord> {
	private readonly emitter = new EventEmitter();

	constructor() {
		// EventEmitter по умолчанию ругается на >10 listeners; поднимаем потолок,
		// одновременных SSE-сабскрайбов на инстанс может быть больше.
		this.emitter.setMaxListeners(0);
	}

	subscribe(listener: RunEmitterListener<TRecord>): () => void {
		this.emitter.on("run", listener);
		return () => {
			this.emitter.off("run", listener);
		};
	}

	emit(record: TRecord): void {
		this.emitter.emit("run", record);
	}
}
