import { describe, expect, it } from "bun:test";

import {
	createIdempotencyLock,
	type IdempotencyLockStore,
	withIdempotency,
} from "./index";

interface InMemoryEntry {
	expiresAt: number;
	value: string;
}

function createInMemoryStore(
	now: () => number = Date.now
): IdempotencyLockStore {
	const map = new Map<string, InMemoryEntry>();

	const purgeExpired = (key: string) => {
		const entry = map.get(key);
		if (entry && entry.expiresAt <= now()) {
			map.delete(key);
		}
	};

	return {
		setNx(key, value, ttlSeconds) {
			purgeExpired(key);
			if (map.has(key)) {
				return Promise.resolve(false);
			}
			map.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
			return Promise.resolve(true);
		},
		deleteIfOwned(key, value) {
			purgeExpired(key);
			const entry = map.get(key);
			if (entry && entry.value === value) {
				map.delete(key);
			}
			return Promise.resolve();
		},
		close() {
			map.clear();
			return Promise.resolve();
		},
	};
}

describe("createIdempotencyLock", () => {
	it("acquires once and rejects subsequent owners until release", async () => {
		const store = createInMemoryStore();
		const lockA = createIdempotencyLock({
			store,
			ttlSeconds: 60,
			ownerToken: "owner-a",
		});
		const lockB = createIdempotencyLock({
			store,
			ttlSeconds: 60,
			ownerToken: "owner-b",
		});

		expect(await lockA.acquire("training-1")).toBe(true);
		expect(await lockB.acquire("training-1")).toBe(false);

		await lockA.release("training-1");

		expect(await lockB.acquire("training-1")).toBe(true);
	});

	it("ignores release calls from a non-owner", async () => {
		const store = createInMemoryStore();
		const lockA = createIdempotencyLock({
			store,
			ttlSeconds: 60,
			ownerToken: "owner-a",
		});
		const lockB = createIdempotencyLock({
			store,
			ttlSeconds: 60,
			ownerToken: "owner-b",
		});

		await lockA.acquire("training-1");
		await lockB.release("training-1");

		expect(await lockB.acquire("training-1")).toBe(false);
	});

	it("auto-releases after TTL elapses", async () => {
		let nowMs = 1_000_000;
		const store = createInMemoryStore(() => nowMs);
		const lock = createIdempotencyLock({
			store,
			ttlSeconds: 5,
			ownerToken: "owner",
		});

		expect(await lock.acquire("k")).toBe(true);
		nowMs += 4500;
		expect(await lock.acquire("k")).toBe(false);
		nowMs += 1000;
		expect(await lock.acquire("k")).toBe(true);
	});

	it("namespaces keys via prefix", async () => {
		const store = createInMemoryStore();
		const lock = createIdempotencyLock({
			store,
			ttlSeconds: 60,
			keyPrefix: "person-lora-training",
		});

		await lock.acquire("run-1");
		expect(await store.setNx("person-lora-training:run-1", "x", 60)).toBe(
			false
		);
		expect(await store.setNx("other-prefix:run-1", "x", 60)).toBe(true);
	});
});

describe("withIdempotency", () => {
	it("runs the task once for the first acquirer", async () => {
		const store = createInMemoryStore();
		const lockA = createIdempotencyLock({
			store,
			ttlSeconds: 60,
			ownerToken: "owner-a",
		});
		const lockB = createIdempotencyLock({
			store,
			ttlSeconds: 60,
			ownerToken: "owner-b",
		});

		let runs = 0;
		const task = () => {
			runs += 1;
			return Promise.resolve("ok");
		};

		const first = await withIdempotency(lockA, "key", task);
		const second = await withIdempotency(lockB, "key", task);

		expect(first).toEqual({ acquired: true, result: "ok" });
		expect(second).toEqual({ acquired: false });
		expect(runs).toBe(1);
	});

	it("releases the lock on task failure so retries can proceed", async () => {
		const store = createInMemoryStore();
		const lockA = createIdempotencyLock({
			store,
			ttlSeconds: 60,
			ownerToken: "owner-a",
		});
		const lockB = createIdempotencyLock({
			store,
			ttlSeconds: 60,
			ownerToken: "owner-b",
		});

		const failingTask = () => {
			throw new Error("boom");
		};

		await expect(withIdempotency(lockA, "key", failingTask)).rejects.toThrow(
			"boom"
		);

		const retry = await withIdempotency(lockB, "key", () =>
			Promise.resolve("second-ok")
		);
		expect(retry).toEqual({ acquired: true, result: "second-ok" });
	});

	it("keeps the lock after a successful task", async () => {
		const store = createInMemoryStore();
		const lockA = createIdempotencyLock({
			store,
			ttlSeconds: 60,
			ownerToken: "owner-a",
		});
		const lockB = createIdempotencyLock({
			store,
			ttlSeconds: 60,
			ownerToken: "owner-b",
		});

		await withIdempotency(lockA, "key", () => Promise.resolve("first"));
		const retry = await withIdempotency(lockB, "key", () =>
			Promise.resolve("second")
		);
		expect(retry).toEqual({ acquired: false });
	});
});
