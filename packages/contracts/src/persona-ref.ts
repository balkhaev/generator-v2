import type { PersonRecord } from "./persons";

/**
 * Canonical persona identity across the ecosystem (ADR 0004 in hub).
 *
 * Every service that needs to attribute media/companions/publishing to a
 * character references the generator-v2 person by its `personId`
 * (`PersonRecord.id`) — the ML likeness is what all other concepts ultimately
 * render from. `slug`/`name` are optional denormalized fields for display only;
 * they are NOT identity and must never be used as a join key.
 *
 * - `girls` bridges its `companion` rows via `companion_generator_link`.
 * - `mediator` references it from `publish_account.generator_person_id`.
 */
export interface PersonaRef {
	/** Optional denormalized display name (`PersonRecord.name`). */
	name?: string;
	/** Canonical persona identity: generator-v2 `PersonRecord.id`. */
	personId: string;
	/** Optional denormalized URL-safe handle (`PersonRecord.slug`). */
	slug?: string;
}

/** Build a {@link PersonaRef} from a generator person record (or a subset). */
export function personaRefFromPerson(
	person: Pick<PersonRecord, "id" | "name" | "slug">
): PersonaRef {
	return { personId: person.id, name: person.name, slug: person.slug };
}

/** Type guard for a structurally-valid persona ref (non-empty `personId`). */
export function isPersonaRef(value: unknown): value is PersonaRef {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { personId?: unknown }).personId === "string" &&
		(value as { personId: string }).personId.length > 0
	);
}
