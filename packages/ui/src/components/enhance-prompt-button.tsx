"use client";

import { Button } from "@generator/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@generator/ui/components/tooltip";
import { cn } from "@generator/ui/lib/utils";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

export interface EnhancePromptButtonProps {
	className?: string;
	disabled?: boolean;
	enhance: (prompt: string) => Promise<string>;
	label?: string;
	onEnhanced: (enhanced: string) => void;
	onError?: (message: string) => void;
	prompt: string;
	tooltip?: string;
}

export function EnhancePromptButton({
	className,
	disabled,
	enhance,
	label = "Enhance",
	onEnhanced,
	onError,
	prompt,
	tooltip = "Rewrite this prompt with the configured AI provider",
}: EnhancePromptButtonProps) {
	const [isLoading, setIsLoading] = useState(false);
	const trimmed = prompt.trim();
	const isDisabled = disabled || isLoading || trimmed.length === 0;

	async function handleClick() {
		if (isDisabled) {
			return;
		}

		setIsLoading(true);
		try {
			const enhanced = (await enhance(trimmed)).trim();
			if (enhanced) {
				onEnhanced(enhanced);
			} else if (onError) {
				onError("Enhancement returned an empty prompt.");
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Failed to enhance prompt";
			onError?.(message);
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						className={cn("gap-1.5", className)}
						disabled={isDisabled}
						onClick={handleClick}
						size="xs"
						type="button"
						variant="outline"
					>
						{isLoading ? (
							<Loader2 className="animate-spin" />
						) : (
							<Sparkles className="text-amber-500" />
						)}
						<span>{isLoading ? "Enhancing…" : label}</span>
					</Button>
				}
			/>
			<TooltipContent>{tooltip}</TooltipContent>
		</Tooltip>
	);
}
