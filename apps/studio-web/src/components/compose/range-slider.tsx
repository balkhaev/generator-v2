"use client";

import { Input } from "@generator/ui/components/input";
import { cn } from "@generator/ui/lib/utils";
import type { ChangeEvent } from "react";

interface RangeSliderProps {
	className?: string;
	disabled?: boolean;
	id?: string;
	max: number;
	min: number;
	onValueChange: (value: number) => void;
	step?: number;
	suffix?: string;
	value: number;
}

export default function RangeSlider({
	className,
	disabled,
	id,
	max,
	min,
	onValueChange,
	step = 1,
	suffix,
	value,
}: RangeSliderProps) {
	const safeValue = Number.isFinite(value) ? value : min;
	const ratio = ((safeValue - min) / (max - min)) * 100;
	const trackBackground = `linear-gradient(to right, var(--foreground) 0%, var(--foreground) ${ratio}%, var(--border) ${ratio}%, var(--border) 100%)`;

	function handleSliderChange(event: ChangeEvent<HTMLInputElement>) {
		const next = Number(event.target.value);
		if (Number.isFinite(next)) {
			onValueChange(next);
		}
	}

	function handleNumericChange(event: ChangeEvent<HTMLInputElement>) {
		const raw = event.target.value;

		if (raw === "") {
			return;
		}

		const next = Number(raw);
		if (Number.isFinite(next)) {
			onValueChange(Math.min(Math.max(next, min), max));
		}
	}

	return (
		<div className={cn("flex items-center gap-2", className)}>
			<input
				aria-label={id ? undefined : "Value"}
				className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-border outline-none transition disabled:cursor-not-allowed disabled:opacity-40 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-sm"
				disabled={disabled}
				id={id}
				max={max}
				min={min}
				onChange={handleSliderChange}
				step={step}
				style={{ background: trackBackground }}
				type="range"
				value={safeValue}
			/>
			<div className="flex w-20 shrink-0 items-center gap-1">
				<Input
					className="h-7 px-1.5 text-right text-[11px] tabular-nums"
					disabled={disabled}
					inputMode="decimal"
					max={max}
					min={min}
					onChange={handleNumericChange}
					step={step}
					type="number"
					value={safeValue}
				/>
				{suffix ? (
					<span className="text-[10px] text-muted-foreground">{suffix}</span>
				) : null}
			</div>
		</div>
	);
}
