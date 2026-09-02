-- =====================================================================
--  dTprm  Migration 012   A published baseline instrument for every sector
--
--  Until now only GENERIC carried a published instrument, so only a supplier
--  classified as Cross-Sector Baseline could be tiered or assessed at all.
--  Everything else stopped with "No published questionnaire for <SECTOR>" -
--  the classifier was doing its job and the sectors it chose had nowhere to go.
--
--  This gives every sector its own published v1 carrying the same 42 questions
--  the cross-sector baseline carries. That is what the original toolkit does:
--  its seed script loops the sector list and copies one shared set into each,
--  under the comment "one published instrument per sector, from the shared
--  baseline". There are no sector-specific questions anywhere in that source,
--  and there are none here either - the divergence is authoring work, done in
--  the Question Bank when somebody has real sector questions to write.
--
--  So these are not throwaway rows. Each sector starts from the real baseline
--  and can be taken forward independently: create a draft, change what is
--  genuinely different for that sector, publish. Nothing here is overwritten
--  once that has happened.
--
--  Every statement is idempotent. db/migrate.js re-runs every file in the
--  folder on each pass, so running this twice must not double the questions.
--  Each insert is guarded on "does this already exist", never on a row count.
-- =====================================================================

USE dtprm;

/* ---- 1. the sector the catalogue was missing --------------------------
   The reference lists 36 sectors; 005 seeded 35. Nuclear sits between Water
   and Renewables in the Energy group, so the ones after it shift by one. */
INSERT IGNORE INTO sector (sector_code, sector_name, sector_group, sort_order)
VALUES ('NUCLEAR', 'Nuclear', 'Energy and Resources', 4);

UPDATE sector SET sort_order = 5 WHERE sector_code = 'RENEW'  AND sort_order = 4;
UPDATE sector SET sort_order = 6 WHERE sector_code = 'MINING' AND sort_order = 5;
UPDATE sector SET sort_order = 7 WHERE sector_code = 'CHEM'   AND sort_order = 6;

/* ---- 2. the version to copy from --------------------------------------
   GENERIC v1 is seeded by 005. If it is somehow absent every statement below
   simply matches nothing, which is the right outcome: better to seed nothing
   than to seed empty instruments that look authored and are not. */
SET @src := (SELECT instrument_version_id FROM instrument_version
              WHERE sector_code = 'GENERIC' AND version_no = 1 LIMIT 1);

/* ---- 3. one published v1 per sector -----------------------------------
   Only for sectors that hold no version at all. A sector someone has already
   started authoring - even as an unpublished draft - is left alone entirely. */
INSERT INTO instrument_version
    (sector_code, version_no, status, frozen, change_note, published_time)
SELECT s.sector_code, 1, 'published', 1,
       'Baseline instrument, seeded from the cross-sector set', NOW(3)
  FROM sector s
 WHERE s.active = 1
   AND @src IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM instrument_version iv
                    WHERE iv.sector_code = s.sector_code);

/* ---- 4. the questions -------------------------------------------------
   Copied only into a version that holds none, so a version somebody has since
   edited is never touched. q_ref is unique per version, not globally, so every
   instrument carrying its own T01 and GOV-01 is correct. */
INSERT INTO question
    (instrument_version_id, q_type, q_ref, is_core, dimension_code, domain_code,
     q_text, score_1_label, score_2_label, score_3_label, rationale,
     evidence_required, standards_mapping, tier_applies, sort_order)
SELECT iv.instrument_version_id, q.q_type, q.q_ref, q.is_core,
       q.dimension_code, q.domain_code, q.q_text,
       q.score_1_label, q.score_2_label, q.score_3_label, q.rationale,
       q.evidence_required, q.standards_mapping, q.tier_applies, q.sort_order
  FROM instrument_version iv
  JOIN question q ON q.instrument_version_id = @src
 WHERE @src IS NOT NULL
   AND iv.instrument_version_id <> @src
   AND iv.status = 'published'
   AND NOT EXISTS (SELECT 1 FROM question x
                    WHERE x.instrument_version_id = iv.instrument_version_id);

/* ---- 5. the standards each instrument declares ------------------------
   Declared for the whole instrument, alongside the per-question mapping that
   travelled with the questions above. The Standards screen counts both. */
INSERT IGNORE INTO instrument_standard (instrument_version_id, standard_code)
SELECT iv.instrument_version_id, ist.standard_code
  FROM instrument_version iv
  JOIN instrument_standard ist ON ist.instrument_version_id = @src
 WHERE @src IS NOT NULL
   AND iv.instrument_version_id <> @src
   AND iv.status = 'published';
