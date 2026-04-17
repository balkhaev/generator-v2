"use client";

import type { WorkflowParameter } from "@generator/studio-client/shared";
import { Input } from "@generator/ui/components/input";
import { Label } from "@generator/ui/components/label";
import { cn } from "@generator/ui/lib/utils";
import { Dice5 } from "lucide-react";
import { useId } from "react";

import AspectPicker from "./aspect-picker";
import RangeSlider from "./range-slider";

const enumUnderscorePattern = /_/g;
const enumCamelPattern = /([a-z])([A-Z])/g;
const enumWordStartPattern = /(^|\s)\S/g;

const selectClassName =
	"h-8 w-full rounded-lg border border-input bg-background/45 px-2.5 text-xs outline-none transition focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50";

function resolveNumericValue(value: string, fallbackText: string, min: number) {
	const parsed = Number(value);
	if (Number.isFinite(parsed)) {
		return parsed;
	}
	const fallback = Number(fallbackText);
	if (Number.isFinite(fallback)) {
		return fallback;
	}
	return min;
}

function formatEnumLabel(value: string) {
	return value
		.replace(enumUnderscorePattern, " ")
		.replace(enumCamelPattern, "$1 $2")
		.replace(enumWordStartPattern, (s) => s.toUpperCase());
}

function EnumSelect({
	id,
	onChange,
	options,
	value,
}: {
	id: string;
	onChange: (next: string) => void;
	options: readonly string[];
	value: string;
}) {
	return (
		<select
			className={selectClassName}
			id={id}
			onChange={(event) => onChange(event.target.value)}
			value={value}
		>
			{options.map((option) => (
				<option key={option} value={option}>
					{formatEnumLabel(option)}
				</option>
			))}
		</select>
	);
}

function SeedInput({
	id,
	onChange,
	value,
}: {
	id: string;
	onChange: (next: string) => void;
	value: string;
}) {
	return (
		<div className="flex items-center gap-1.5">
			<Input
				className="flex-1 text-[12px] tabular-nums"
				id={id}
				inputMode="numeric"
				onChange={(event) => onChange(event.target.value)}
				placeholder="Random"
				type="text"
				value={value}
			/>
			<button
				aria-label="Generate random seed"
				className="inline-flex h-8 items-center gap-1 rounded-lg border border-input bg-background/45 px-2 text-[10px] text-muted-foreground transition hover:bg-foreground/[0.05] hover:text-foreground"
				onClick={() => {
					const seed = Math.floor(Math.random() * 2 ** 31);
					onChange(String(seed));
				}}
				type="button"
			>
				<Dice5 className="size-3" />
				Random
			</button>
		</div>
	);
}

function ParameterControl({
	fieldId,
	onChange,
	parameter,
	value,
}: {
	fieldId: string;
	onChange: (next: string) => void;
	parameter: WorkflowParameter;
	value: string;
}) {
	if (parameter.key === "imageSize" && parameter.enumValues) {
		return (
			<AspectPicker
				id={fieldId}
				onChange={onChange}
				options={parameter.enumValues}
				value={value || (parameter.defaultValue ?? parameter.enumValues[0])}
			/>
		);
	}

	if (parameter.enumValues && parameter.enumValues.length > 0) {
		return (
			<EnumSelect
				id={fieldId}
				onChange={onChange}
				options={parameter.enumValues}
				value={value || parameter.defaultValue}
			/>
		);
	}

	if (
		parameter.type === "number" &&
		parameter.min !== undefined &&
		parameter.max !== undefined
	) {
		return (
			<RangeSlider
				id={fieldId}
				max={parameter.max}
				min={parameter.min}
				onValueChange={(next) => onChange(String(next))}
				step={parameter.step ?? 1}
				suffix={parameter.unit}
				value={resolveNumericValue(
					value,
					parameter.defaultValue,
					parameter.min
				)}
			/>
		);
	}

	if (parameter.key === "seed") {
		return <SeedInput id={fieldId} onChange={onChange} value={value} />;
	}

	const placeholder = parameter.optional
		? "Optional"
		: parameter.defaultValue || parameter.label;

	return (
		<Input
			id={fieldId}
			inputMode={parameter.type === "number" ? "decimal" : undefined}
			onChange={(event) => onChange(event.target.value)}
			placeholder={placeholder}
			type={parameter.type === "number" ? "number" : "text"}
			value={value}
		/>
	);
}

interface ParameterFieldProps {
	className?: string;
	onChange: (value: string) => void;
	parameter: WorkflowParameter;
	value: string;
}

export default function ParameterField({
	className,
	onChange,
	parameter,
	value,
}: ParameterFieldProps) {
	const fieldId = useId();

	return (
		<div className={cn("grid gap-1.5", className)}>
			<div className="flex items-baseline justify-between gap-2">
				<Label className="font-medium text-[11px]" htmlFor={fieldId}>
					{parameter.label}
				</Label>
				{parameter.optional ? (
					<span className="text-[10px] text-muted-foreground/70">optional</span>
				) : null}
			</div>
			<ParameterControl
				fieldId={fieldId}
				onChange={onChange}
				parameter={parameter}
				value={value}
			/>
			{parameter.helperText ? (
				<p className="text-[10px] text-muted-foreground leading-snug">
					{parameter.helperText}
				</p>
			) : null}
		</div>
	);
}
