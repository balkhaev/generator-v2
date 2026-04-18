-- Backfill: drop legacy Civitai-only base_model values that are not part of the
-- ostris/ai-toolkit supported set. We mirror ai-toolkit's coverage in the registry
-- (packages/contracts/src/base-models.ts), so any LoRA stored with one of the
-- removed ids would no longer be valid in filters or training. Park them under
-- the catch-all 'other' so the rows are still inspectable in the admin panel
-- and can be archived/edited manually.
UPDATE "lora"
SET "base_model" = 'other'
WHERE "base_model" IN (
	'pony',
	'illustrious',
	'noob-ai',
	'sd-2',
	'sd-3',
	'sd-3-5',
	'kolors',
	'aura-flow',
	'stable-cascade',
	'pixart',
	'hunyuan-video',
	'cogvideox',
	'mochi',
	'ltx'
);
