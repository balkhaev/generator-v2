-- Migrate «Wan Pussy» Studio scenario from Replicate to RunPod serverless and
-- set canonical display name (0017 only renamed when workflow_key was already
-- runpod-wan-2-2-image-to-video; prod scenario f1bf5795 was still on Replicate).

UPDATE "studio_scenario"
SET
  "workflow_key" = 'runpod-wan-2-2-image-to-video',
  "name" = 'Wan Pussy (Serverless)',
  "params" = jsonb_build_object(
    'width', 480,
    'height', 832,
    'durationSeconds', 5,
    'fps', COALESCE((("params"->>'framesPerSecond')::int), 16),
    'steps', 20,
    'cfgScale', 3.5,
    'loraScale', COALESCE(
      (("params"->>'loraScaleHigh')::numeric),
      (("params"->>'loraScale')::numeric),
      1
    ),
    'loraHighFilename', 'wan22-pussy-high_noise.safetensors',
    'loraLowFilename', 'wan22-pussy-low_noise.safetensors',
    'negativePrompt', COALESCE("params"->>'negativePrompt', '')
  ),
  "runpod_pod_template_id" = COALESCE(
    "runpod_pod_template_id",
    (
      SELECT t."id"
      FROM "runpod_pod_template" AS t
      WHERE t."mode" = 'serverless'
        AND t."workflow_key" = 'wan-2-2-video'
        AND t."enabled" = 'true'
      ORDER BY t."created_at" DESC
      LIMIT 1
    )
  )
WHERE "id" = 'f1bf5795-cc0b-47f9-a1d3-deb96d174982'
  AND "workflow_key" = 'replicate-wan-2-2-fast-image-to-video';

UPDATE "studio_scenario"
SET
  "workflow_key" = 'runpod-wan-2-2-image-to-video',
  "name" = 'Wan Pussy (Serverless)',
  "params" = jsonb_build_object(
    'width', 480,
    'height', 832,
    'durationSeconds', 5,
    'fps', COALESCE((("params"->>'framesPerSecond')::int), 16),
    'steps', 20,
    'cfgScale', 3.5,
    'loraScale', COALESCE(
      (("params"->>'loraScaleHigh')::numeric),
      (("params"->>'loraScale')::numeric),
      1
    ),
    'loraHighFilename', 'wan22-pussy-high_noise.safetensors',
    'loraLowFilename', 'wan22-pussy-low_noise.safetensors',
    'negativePrompt', COALESCE("params"->>'negativePrompt', '')
  ),
  "runpod_pod_template_id" = COALESCE(
    "runpod_pod_template_id",
    (
      SELECT t."id"
      FROM "runpod_pod_template" AS t
      WHERE t."mode" = 'serverless'
        AND t."workflow_key" = 'wan-2-2-video'
        AND t."enabled" = 'true'
      ORDER BY t."created_at" DESC
      LIMIT 1
    )
  )
WHERE "workflow_key" = 'replicate-wan-2-2-fast-image-to-video'
  AND lower(trim("name")) = 'wan pussy'
  AND "id" <> 'f1bf5795-cc0b-47f9-a1d3-deb96d174982';

UPDATE "studio_scenario"
SET "name" = 'Wan Pussy (Serverless)'
WHERE (
    "id" = 'f1bf5795-cc0b-47f9-a1d3-deb96d174982'
    OR (
      "workflow_key" = 'runpod-wan-2-2-image-to-video'
      AND lower(trim("name")) IN (
        'wan pussy',
        'wan2.2 pussy',
        'wan 2.2 pussy',
        'wan2.2 — pussy',
        'wan2.2 - pussy'
      )
    )
  )
  AND "name" NOT ILIKE '%serverless%';

UPDATE "studio_scenario"
SET "name" = 'Noisify (Serverless)'
WHERE "id" = '9a626dc4-1f65-49cb-ae76-f3679db2f698'
  AND "name" NOT ILIKE '%serverless%';
