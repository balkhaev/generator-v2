-- Backfill: extract structured trigger words from legacy `description` text
-- created by the Civitai resolver (which used to embed `Trigger words: a, b.`
-- inside the description). We promote them into the new `trigger_words`
-- column so studio/persons can prepend them to prompts automatically. Rows
-- that already have explicit trigger words (post-import) are left alone.
UPDATE "lora" AS l
SET "trigger_words" = sub.words
FROM (
	SELECT
		id,
		ARRAY(
			SELECT btrim(w)
			FROM unnest(string_to_array(matched[1], ',')) AS w
			WHERE btrim(w) <> ''
		) AS words
	FROM (
		SELECT id, regexp_match("description", 'Trigger words:\s*([^.]+)') AS matched
		FROM "lora"
	) extracted
	WHERE matched IS NOT NULL
) sub
WHERE l.id = sub.id
	AND COALESCE(array_length(l."trigger_words", 1), 0) = 0
	AND array_length(sub.words, 1) IS NOT NULL;
