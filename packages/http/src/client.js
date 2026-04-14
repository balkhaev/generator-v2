async function getErrorMessage(response) {
	try {
		const payload = await response.json();
		if (typeof payload.error === "string" && payload.error.length > 0) {
			return payload.error;
		}
	} catch {
		// Fall back to plain text when the body is not JSON.
	}
	try {
		const text = await response.text();
		if (text.length > 0) {
			return text;
		}
	} catch {
		// Fall back to the status line when the body cannot be read.
	}
	return `${response.status} ${response.statusText}`.trim();
}
export async function requestJson(input, init) {
	const response = await fetch(input, {
		...init,
		credentials: init?.credentials ?? "include",
	});
	if (!response.ok) {
		throw new Error(await getErrorMessage(response));
	}
	return await response.json();
}
