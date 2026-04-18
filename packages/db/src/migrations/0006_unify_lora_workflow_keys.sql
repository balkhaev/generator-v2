-- Unify "with LoRA" / "without LoRA" Fal workflows into a single key per
-- model+modality. The base workflow now always targets the provider's `/lora`
-- endpoint and sends `loras: []` when no URL is provided, which makes the
-- separate `*-lora` keys redundant. Re-point existing scenarios and runs at
-- the canonical key so they keep resolving against `workflowRegistry`.
UPDATE "studio_scenario"
SET "workflow_key" = 'fal-flux-dev'
WHERE "workflow_key" = 'fal-flux-lora';

UPDATE "studio_scenario"
SET "workflow_key" = 'fal-zimage-turbo'
WHERE "workflow_key" = 'fal-zimage-turbo-lora';

UPDATE "studio_scenario"
SET "workflow_key" = 'fal-zimage-turbo-image-to-image'
WHERE "workflow_key" = 'fal-zimage-turbo-image-to-image-lora';

UPDATE "studio_run"
SET "workflow_key" = 'fal-flux-dev'
WHERE "workflow_key" = 'fal-flux-lora';

UPDATE "studio_run"
SET "workflow_key" = 'fal-zimage-turbo'
WHERE "workflow_key" = 'fal-zimage-turbo-lora';

UPDATE "studio_run"
SET "workflow_key" = 'fal-zimage-turbo-image-to-image'
WHERE "workflow_key" = 'fal-zimage-turbo-image-to-image-lora';
