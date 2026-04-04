import { describe, expect, test } from "bun:test";

import {
	assertValidRunStatusTransition,
	canTransitionRunStatus,
	getAllowedNextRunStatuses,
	transitionRunStatus,
} from "./run-state";

describe("run state transitions", () => {
	test("lists the allowed next statuses for queued and running jobs", () => {
		expect(getAllowedNextRunStatuses("queued")).toEqual(["running", "failed"]);
		expect(getAllowedNextRunStatuses("running")).toEqual(["succeeded", "failed"]);
	});

	test("accepts valid transitions", () => {
		expect(canTransitionRunStatus("queued", "running")).toBe(true);
		expect(transitionRunStatus("running", "succeeded")).toBe("succeeded");
	});

	test("rejects invalid transitions", () => {
		expect(canTransitionRunStatus("queued", "succeeded")).toBe(false);
		expect(() => assertValidRunStatusTransition("succeeded", "running")).toThrow(
			"Invalid run status transition: succeeded -> running",
		);
	});
});
