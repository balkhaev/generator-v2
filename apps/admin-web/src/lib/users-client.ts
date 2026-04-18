import type {
	AdminUser,
	CreateAdminUserInput,
	ListAdminUsersQuery,
	ResetAdminUserPasswordInput,
	UpdateAdminUserInput,
} from "@generator/contracts/admin";
import { env } from "@generator/env/web";
import { requestJson } from "@generator/http/client";
import { normalizeBaseUrl } from "@generator/http/shared";

const API_BASE_URL = normalizeBaseUrl(env.NEXT_PUBLIC_SERVER_URL);

function buildQueryString(query: ListAdminUsersQuery): string {
	const params = new URLSearchParams();
	if (query.search) {
		params.set("search", query.search);
	}
	const str = params.toString();
	return str ? `?${str}` : "";
}

export async function fetchAdminUsers(query: ListAdminUsersQuery = {}) {
	const payload = await requestJson<{ users: AdminUser[] }>(
		`${API_BASE_URL}/api/admin/users${buildQueryString(query)}`,
		{ credentials: "include" }
	);
	return payload.users;
}

export async function createAdminUser(input: CreateAdminUserInput) {
	const payload = await requestJson<{ user: AdminUser }>(
		`${API_BASE_URL}/api/admin/users`,
		{
			body: JSON.stringify(input),
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			method: "POST",
		}
	);
	return payload.user;
}

export async function updateAdminUser(id: string, patch: UpdateAdminUserInput) {
	const payload = await requestJson<{ user: AdminUser }>(
		`${API_BASE_URL}/api/admin/users/${id}`,
		{
			body: JSON.stringify(patch),
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			method: "PATCH",
		}
	);
	return payload.user;
}

export async function resetAdminUserPassword(
	id: string,
	input: ResetAdminUserPasswordInput
) {
	const payload = await requestJson<{ user: AdminUser }>(
		`${API_BASE_URL}/api/admin/users/${id}/password`,
		{
			body: JSON.stringify(input),
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			method: "POST",
		}
	);
	return payload.user;
}

export async function deleteAdminUser(id: string) {
	const payload = await requestJson<{ user: AdminUser }>(
		`${API_BASE_URL}/api/admin/users/${id}`,
		{ credentials: "include", method: "DELETE" }
	);
	return payload.user;
}
