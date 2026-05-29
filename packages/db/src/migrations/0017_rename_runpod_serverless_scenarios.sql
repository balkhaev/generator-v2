-- Clarify RunPod serverless runtime in Studio scenario and admin template
-- display names after pod → serverless migration (LTX / Wan / Flux / Fooocus).

-- Canonical names for well-known prod scenarios (idempotent).
UPDATE "studio_scenario"
SET "name" = 'LTX Synth Pussy (Serverless)'
WHERE "id" = '151d1452-bb0b-40a8-b491-14f8a085e003'
  AND "name" NOT ILIKE '%serverless%';

-- Scenarios explicitly bound to a serverless RunPod template.
UPDATE "studio_scenario" AS s
SET "name" = CASE
  WHEN s."workflow_key" = 'runpod-ltx-2-3-image-to-video'
    AND lower(trim(s."name")) IN ('ltx synth pussy', 'ltx synth pussy (runpod)')
    THEN 'LTX Synth Pussy (Serverless)'
  WHEN s."workflow_key" = 'runpod-wan-2-2-image-to-video'
    AND lower(trim(s."name")) IN ('wan pussy', 'wan2.2 pussy', 'wan 2.2 pussy')
    THEN 'Wan Pussy (Serverless)'
  WHEN s."workflow_key" = 'runpod-flux-dev-image'
    AND lower(trim(s."name")) IN ('noisify', 'flux noisify', 'flux.1-dev noisify')
    THEN 'Noisify (Serverless)'
  WHEN s."name" ILIKE '% (RunPod Pod)' THEN
    replace(s."name", ' (RunPod Pod)', ' (RunPod Serverless)')
  WHEN s."name" ILIKE '% (RunPod)' AND s."name" NOT ILIKE '%serverless%' THEN
    replace(s."name", ' (RunPod)', ' (RunPod Serverless)')
  ELSE trim(s."name") || ' (Serverless)'
END
FROM "runpod_pod_template" AS t
WHERE s."runpod_pod_template_id" = t."id"
  AND t."mode" = 'serverless'
  AND s."name" NOT ILIKE '%serverless%';

-- Serverless-only workflow keys without an explicit template binding (env-default).
UPDATE "studio_scenario"
SET "name" = CASE
  WHEN "workflow_key" = 'runpod-wan-2-2-image-to-video'
    AND lower(trim("name")) IN ('wan pussy', 'wan2.2 pussy', 'wan 2.2 pussy')
    THEN 'Wan Pussy (Serverless)'
  WHEN "workflow_key" = 'runpod-flux-dev-image'
    AND lower(trim("name")) IN ('noisify', 'flux noisify', 'flux.1-dev noisify')
    THEN 'Noisify (Serverless)'
  WHEN "name" ILIKE '% (RunPod Pod)' THEN
    replace("name", ' (RunPod Pod)', ' (RunPod Serverless)')
  WHEN "name" ILIKE '% (RunPod)' AND "name" NOT ILIKE '%serverless%' THEN
    replace("name", ' (RunPod)', ' (RunPod Serverless)')
  ELSE trim("name") || ' (Serverless)'
END
WHERE "runpod_pod_template_id" IS NULL
  AND "workflow_key" IN (
    'runpod-fooocus-sdxl',
    'runpod-wan-2-2-image-to-video',
    'runpod-flux-dev-image'
  )
  AND "name" NOT ILIKE '%serverless%';

-- Admin-managed RunPod templates: disambiguate serverless runtime in UI.
UPDATE "runpod_pod_template"
SET "name" = replace("name", ' (RunPod Pod)', ' (RunPod Serverless)')
WHERE "mode" = 'serverless'
  AND "name" ILIKE '% (RunPod Pod)%';

UPDATE "runpod_pod_template"
SET "name" = replace("name", ' (RunPod)', ' (RunPod Serverless)')
WHERE "mode" = 'serverless'
  AND "name" ILIKE '% (RunPod)%'
  AND "name" NOT ILIKE '%serverless%';

UPDATE "runpod_pod_template"
SET "name" = regexp_replace("name", '\s*\(env-seeded\)\s*$', ' serverless (env-seeded)')
WHERE "mode" = 'serverless'
  AND "name" ~ '\(env-seeded\)$'
  AND "name" NOT ILIKE '%serverless%';
