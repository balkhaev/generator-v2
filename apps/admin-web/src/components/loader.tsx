import { Loader2 } from "lucide-react";

export default function Loader() {
	return (
		<div className="flex h-full w-full items-center justify-center p-8">
			<div className="flex size-10 items-center justify-center border border-foreground/6 bg-background/80 backdrop-blur-xl dark:border-foreground/10 dark:bg-background/60">
				<Loader2 className="size-4 animate-spin" />
			</div>
		</div>
	);
}
