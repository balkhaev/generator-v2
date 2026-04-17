"use client";

import { cn } from "@generator/ui/lib/utils";

interface AspectOption {
	hint: string;
	label: string;
	ratio: { height: number; width: number };
	value: string;
}

const KNOWN_ASPECT_OPTIONS: Record<string, AspectOption> = {
	auto: {
		hint: "Match input image",
		label: "Auto",
		ratio: { height: 4, width: 4 },
		value: "auto",
	},
	landscape_16_9: {
		hint: "16:9 cinematic",
		label: "16:9",
		ratio: { height: 9, width: 16 },
		value: "landscape_16_9",
	},
	landscape_4_3: {
		hint: "4:3 landscape",
		label: "4:3",
		ratio: { height: 3, width: 4 },
		value: "landscape_4_3",
	},
	portrait_16_9: {
		hint: "9:16 vertical",
		label: "9:16",
		ratio: { height: 16, width: 9 },
		value: "portrait_16_9",
	},
	portrait_4_3: {
		hint: "3:4 portrait",
		label: "3:4",
		ratio: { height: 4, width: 3 },
		value: "portrait_4_3",
	},
	square: {
		hint: "1:1 square",
		label: "1:1",
		ratio: { height: 1, width: 1 },
		value: "square",
	},
	square_hd: {
		hint: "1:1 HD square",
		label: "1:1 HD",
		ratio: { height: 1, width: 1 },
		value: "square_hd",
	},
};

function getOption(value: string): AspectOption {
	return (
		KNOWN_ASPECT_OPTIONS[value] ?? {
			hint: value,
			label: value,
			ratio: { height: 1, width: 1 },
			value,
		}
	);
}

interface AspectPickerProps {
	id?: string;
	onChange: (value: string) => void;
	options: readonly string[];
	value: string;
}

export default function AspectPicker({
	id,
	onChange,
	options,
	value,
}: AspectPickerProps) {
	return (
		<fieldset className="grid grid-cols-3 gap-1.5 sm:grid-cols-4" id={id}>
			<legend className="sr-only">Aspect ratio</legend>
			{options.map((optionValue) => {
				const option = getOption(optionValue);
				const isActive = option.value === value;
				const longestSide = Math.max(option.ratio.width, option.ratio.height);
				const widthPct = (option.ratio.width / longestSide) * 100;
				const heightPct = (option.ratio.height / longestSide) * 100;

				return (
					<label
						className={cn(
							"flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border px-2 py-2 text-[10px] transition",
							isActive
								? "border-foreground bg-foreground/[0.03] text-foreground"
								: "border-foreground/8 text-muted-foreground hover:border-foreground/20 hover:text-foreground"
						)}
						key={option.value}
						title={option.hint}
					>
						<input
							checked={isActive}
							className="sr-only"
							name={id ?? "aspect"}
							onChange={() => onChange(option.value)}
							type="radio"
							value={option.value}
						/>
						<div className="flex h-7 w-7 items-center justify-center">
							<div
								className={cn(
									"rounded-sm border",
									isActive
										? "border-foreground bg-foreground/15"
										: "border-foreground/30"
								)}
								style={{
									height: `${heightPct}%`,
									width: `${widthPct}%`,
								}}
							/>
						</div>
						<span className="font-medium">{option.label}</span>
					</label>
				);
			})}
		</fieldset>
	);
}
