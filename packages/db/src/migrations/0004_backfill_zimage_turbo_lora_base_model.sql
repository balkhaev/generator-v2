-- Backfill: until now all `fal-zimage-turbo*` workflows used `base_model = 'z-image'`,
-- but we actually train and run inference on the Z-Image **Turbo** distillation
-- (Tongyi-MAI/Z-Image-Turbo via RunPod handler, fal-ai/z-image/turbo/lora endpoints).
-- Z-Image (base) and Z-Image Turbo are architecturally distinct — LoRAs trained
-- on Turbo are not compatible with the base checkpoint. Promote existing rows so
-- they show up in the Compose picker for the Turbo workflows.
UPDATE "lora" SET "base_model" = 'z-image-turbo' WHERE "base_model" = 'z-image';
