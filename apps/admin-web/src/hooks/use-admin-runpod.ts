"use client";

import type {
	CreateRunpodNetworkVolumeInput,
	CreateRunpodPodTemplateInput,
	ListRunpodPodTemplatesQuery,
	UpdateRunpodNetworkVolumeInput,
	UpdateRunpodPodTemplateInput,
} from "@generator/contracts/runpod-admin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
	createRunpodPodTemplate,
	createRunpodVolume,
	deleteRunpodPodTemplate,
	deleteRunpodVolume,
	fetchRunpodPodTemplates,
	fetchRunpodVolumes,
	fetchScenarioRunpodBindings,
	setScenarioRunpodBinding,
	updateRunpodPodTemplate,
	updateRunpodVolume,
} from "@/lib/runpod-admin-client";

export const adminRunpodVolumesKey = () =>
	["admin", "runpod", "volumes"] as const;

export const adminRunpodTemplatesKey = (
	query: ListRunpodPodTemplatesQuery = {}
) => ["admin", "runpod", "pod-templates", query] as const;

export const adminScenarioBindingsKey = () =>
	["admin", "runpod", "scenario-bindings"] as const;

export function useAdminRunpodVolumes() {
	return useQuery({
		queryKey: adminRunpodVolumesKey(),
		queryFn: () => fetchRunpodVolumes(),
	});
}

export function useCreateRunpodVolume() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateRunpodNetworkVolumeInput) =>
			createRunpodVolume(input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "runpod"] });
		},
	});
}

export function useUpdateRunpodVolume() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			id,
			patch,
		}: {
			id: string;
			patch: UpdateRunpodNetworkVolumeInput;
		}) => updateRunpodVolume(id, patch),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "runpod"] });
		},
	});
}

export function useDeleteRunpodVolume() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deleteRunpodVolume(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "runpod"] });
		},
	});
}

export function useAdminRunpodTemplates(
	query: ListRunpodPodTemplatesQuery = {}
) {
	return useQuery({
		queryKey: adminRunpodTemplatesKey(query),
		queryFn: () => fetchRunpodPodTemplates(query),
	});
}

export function useCreateRunpodTemplate() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: CreateRunpodPodTemplateInput) =>
			createRunpodPodTemplate(input),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "runpod"] });
		},
	});
}

export function useUpdateRunpodTemplate() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			id,
			patch,
		}: {
			id: string;
			patch: UpdateRunpodPodTemplateInput;
		}) => updateRunpodPodTemplate(id, patch),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "runpod"] });
		},
	});
}

export function useDeleteRunpodTemplate() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deleteRunpodPodTemplate(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "runpod"] });
		},
	});
}

export function useScenarioRunpodBindings() {
	return useQuery({
		queryKey: adminScenarioBindingsKey(),
		queryFn: () => fetchScenarioRunpodBindings(),
	});
}

export function useSetScenarioRunpodBinding() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			scenarioId,
			podTemplateId,
		}: {
			podTemplateId: string | null;
			scenarioId: string;
		}) => setScenarioRunpodBinding(scenarioId, podTemplateId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "runpod"] });
		},
	});
}
