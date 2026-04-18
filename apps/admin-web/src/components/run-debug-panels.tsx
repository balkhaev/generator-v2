import type { StudioRunDebugBundle } from "@generator/contracts/studio";
import { SectionLabel } from "@generator/ui/components/section-label";

function JsonBlock({ title, value }: { title: string; value: unknown }) {
	return (
		<section className="grid gap-2">
			<SectionLabel>{title}</SectionLabel>
			<pre className="max-h-[min(60vh,520px)] overflow-auto whitespace-pre-wrap rounded-lg border border-foreground/10 bg-muted/20 p-3 font-mono text-[11px] leading-relaxed dark:border-foreground/15 dark:bg-muted/10">
				{JSON.stringify(value, null, 2)}
			</pre>
		</section>
	);
}

export default function RunDebugPanels({
	bundle,
}: {
	bundle: StudioRunDebugBundle;
}) {
	return (
		<div className="grid gap-6">
			{bundle.executionError ? (
				<p className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-amber-800 text-xs dark:text-amber-200">
					Generator fetch: {bundle.executionError}
				</p>
			) : null}
			<JsonBlock title="Studio run (DB + artifacts)" value={bundle.run} />
			<JsonBlock
				title={
					bundle.execution
						? "Generator execution (prompt, params, provider ids)"
						: "Generator execution"
				}
				value={bundle.execution ?? "(no generatorRunId or not loaded)"}
			/>
		</div>
	);
}
