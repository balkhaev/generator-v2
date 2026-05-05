import type {
	AdminWorkflowDetailResponse,
	AdminWorkflowListResponse,
	UpdateAdminWorkflowInput,
} from "@generator/contracts/admin";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

export async function fetchAdminWorkflows(): Promise<AdminWorkflowListResponse> {
	return await requestJson<AdminWorkflowListResponse>(
		`${API_BASE_URL}/api/admin/workflows`,
		{ credentials: "include" }
	);
}

export async function updateAdminWorkflow(
	workflowKey: string,
	input: UpdateAdminWorkflowInput
): Promise<AdminWorkflowDetailResponse> {
	return await requestJson<AdminWorkflowDetailResponse>(
		`${API_BASE_URL}/api/admin/workflows/${encodeURIComponent(workflowKey)}`,
		{
			body: JSON.stringify(input),
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			method: "PATCH",
		}
	);
}
