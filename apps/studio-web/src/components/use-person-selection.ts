"use client";

import type { PersonRecord } from "@generator/contracts/persons";
import { useEffect, useMemo, useState } from "react";

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
	const [fetchedPerson, setFetchedPerson] = useState<PersonRecord | null>(null);
	// Список персон грузится async после mount, а requested id может уже
	// присутствовать в URL (прямой переход / reload). Без флага загрузки
	// downstream хук useStudioSelection пытается «починить» URL ещё до того,
	// как мы знаем, существует персона или нет — и сбрасывает выбор обратно
	// на сценарий.
	const [isPersonsLoaded, setIsPersonsLoaded] = useState(false);

	const selectedPersonId =
		(requestedPersonId &&
		(fetchedPerson?.id === requestedPersonId ||
			persons.some((person) => person.id === requestedPersonId))
			? requestedPersonId
			: null) ?? null;

	// Берём данные персоны синхронно: сперва свежий fetch, иначе кеш из списка.
	// Без этого при переходе scenario → person один кадр рендерится
	// в scenario-режиме (personDetail ещё null), пока не отработает effect —
	// и пользователь видит мерцание интерфейса.
	const personDetail = useMemo<PersonRecord | null>(() => {
		if (!selectedPersonId) {
			return null;
		}
		if (fetchedPerson?.id === selectedPersonId) {
			return fetchedPerson;
		}
		return persons.find((person) => person.id === selectedPersonId) ?? null;
	}, [fetchedPerson, persons, selectedPersonId]);

	useEffect(() => {
		listPersons()
			.then((result) => {
				setPersons(result.persons);
			})
			.catch(() => {
				setPersons([]);
			})
			.finally(() => {
				setIsPersonsLoaded(true);
			});
	}, []);

	useEffect(() => {
		if (!selectedPersonId) {
			return;
		}
		let cancelled = false;
		getPersonById(selectedPersonId)
			.then((person) => {
				if (cancelled) {
					return;
				}
				setFetchedPerson(person);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [selectedPersonId]);

	function handlePersonRefreshed(person: PersonRecord) {
		setFetchedPerson(person);
		setPersons((current) => {
			const exists = current.some((entry) => entry.id === person.id);
			return exists
				? current.map((entry) => (entry.id === person.id ? person : entry))
				: [person, ...current];
		});
	}

	return {
		handlePersonRefreshed,
		isPersonsLoaded,
		personDetail,
		persons,
		selectedPersonId,
	};
}
