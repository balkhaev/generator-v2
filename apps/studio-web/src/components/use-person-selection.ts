"use client";

import type { PersonRecord } from "@generator/contracts/persons";
import { useEffect, useState } from "react";

import { getPersonById, listPersons } from "@/lib/persons-api";

/**
 * URL-driven выбор персоны. Возвращает список + детали выбранной +
 * setter для обновления (используется после Generate-with-LoRA).
 *
 * Изоляция в hook сделана не ради переиспользования, а чтобы снять
 * cognitive complexity с `StudioShell`: там и так 6+ useEffect/useMemo.
 */
export function usePersonSelection(requestedPersonId: string | null) {
	const [persons, setPersons] = useState<PersonRecord[]>([]);
	const [personDetail, setPersonDetail] = useState<PersonRecord | null>(null);

	const selectedPersonId =
		(requestedPersonId &&
		(personDetail?.id === requestedPersonId ||
			persons.some((person) => person.id === requestedPersonId))
			? requestedPersonId
			: null) ?? null;

	useEffect(() => {
		listPersons()
			.then((result) => {
				setPersons(result.persons);
			})
			.catch(() => {
				setPersons([]);
			});
	}, []);

	useEffect(() => {
		if (!selectedPersonId) {
			setPersonDetail(null);
			return;
		}
		const cached = persons.find((person) => person.id === selectedPersonId);
		if (cached) {
			setPersonDetail(cached);
		}
		let cancelled = false;
		getPersonById(selectedPersonId)
			.then((person) => {
				if (cancelled) {
					return;
				}
				setPersonDetail(person);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [persons, selectedPersonId]);

	function handlePersonRefreshed(person: PersonRecord) {
		setPersonDetail(person);
		setPersons((current) => {
			const exists = current.some((entry) => entry.id === person.id);
			return exists
				? current.map((entry) => (entry.id === person.id ? person : entry))
				: [person, ...current];
		});
	}

	return {
		handlePersonRefreshed,
		personDetail,
		persons,
		selectedPersonId,
	};
}
