export function formatCurrency(value: number): string {
	return new Intl.NumberFormat("en-US", {
		currency: "USD",
		maximumFractionDigits: value < 1 ? 3 : 2,
		minimumFractionDigits: value < 1 ? 2 : 2,
		style: "currency",
	}).format(value);
}

export function formatCompactCurrency(value: number): string {
	if (value >= 1000) {
		return `$${(value / 1000).toFixed(1)}k`;
	}
	return formatCurrency(value);
}

export function formatRelativeTime(value: string): string {
	const diffMs = Date.now() - new Date(value).getTime();
	const diffMinutes = Math.max(0, Math.round(diffMs / 60_000));

	if (diffMinutes < 1) {
		return "just now";
	}

	if (diffMinutes < 60) {
		return `${diffMinutes}m ago`;
	}

	const diffHours = Math.round(diffMinutes / 60);

	if (diffHours < 24) {
		return `${diffHours}h ago`;
	}

	return `${Math.round(diffHours / 24)}d ago`;
}

export function formatDateTime(value: string): string {
	return new Intl.DateTimeFormat("en", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

export function formatBytes(value: number | null | undefined): string {
	if (!(typeof value === "number" && Number.isFinite(value)) || value <= 0) {
		return "—";
	}
	if (value < 1024) {
		return `${value} B`;
	}
	if (value < 1024 * 1024) {
		return `${(value / 1024).toFixed(1)} KB`;
	}
	if (value < 1024 * 1024 * 1024) {
		return `${(value / (1024 * 1024)).toFixed(1)} MB`;
	}
	return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
