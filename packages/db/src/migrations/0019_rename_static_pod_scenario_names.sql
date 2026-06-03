-- Static ComfyUI pod: убрать вводящий в заблуждение суффикс «(Serverless)» у
-- канонических RunPod-сценариев (idempotent; 0017 добавлял Serverless).

UPDATE "studio_scenario"
SET "name" = 'LTX Synth Pussy'
WHERE "id" = '151d1452-bb0b-40a8-b491-14f8a085e003'
  AND trim("name") IN (
    'LTX Synth Pussy (Serverless)',
    'LTX Synth Pussy (RunPod Serverless)'
  );

UPDATE "studio_scenario"
SET "name" = 'Wan Pussy'
WHERE "id" = 'f1bf5795-cc0b-47f9-a1d3-deb96d174982'
  AND trim("name") IN (
    'Wan Pussy (Serverless)',
    'Wan Pussy (RunPod Serverless)'
  );

UPDATE "studio_scenario"
SET "name" = 'Noisify'
WHERE "id" = '9a626dc4-1f65-49cb-ae76-f3679db2f698'
  AND trim("name") IN (
    'Noisify (Serverless)',
    'Noisify (RunPod Serverless)'
  );

-- Остальные RunPod i2v/flux сценарии с тем же суффиксом.
UPDATE "studio_scenario"
SET "name" = trim(replace("name", ' (Serverless)', ''))
WHERE "workflow_key" IN (
    'runpod-ltx-2-3-image-to-video',
    'runpod-wan-2-2-image-to-video',
    'runpod-flux-dev-image'
  )
  AND "name" ILIKE '% (Serverless)';
