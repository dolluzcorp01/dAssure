-- =====================================================================
--  dTprm  Migration 014   Sector tiering questions
--
--  013 diverged the control questions. Tiering was left shared, because the
--  tiering pack is ONE workbook for the whole client - one row per supplier,
--  one column per question - so a question added for Oil and Gas would appear
--  as a column against every supplier in the file, including the caterer.
--
--  That is now handled: a question carries the sector it belongs to, and the
--  pack locks the cell for any supplier the question does not apply to. So
--  sector tiering questions can exist without being asked of everybody.
--
--  is_core = 0 is what marks them. The core twelve stay is_core = 1 and are
--  asked of every supplier; these are asked only of suppliers on the matching
--  instrument. Nothing else in the product reads is_core for tiering, so the
--  distinction lives entirely in the pack builder and the parser.
--
--  Kept to four instruments on purpose. The mix - most suppliers answering
--  twelve questions and a few answering thirteen or fourteen in the same
--  workbook - is the case that actually exercises the per-row logic.
--
--  Idempotent, same guard as 013.
-- =====================================================================

USE dtprm;

DROP TEMPORARY TABLE IF EXISTS tmp_sector_t;
CREATE TEMPORARY TABLE tmp_sector_t (
  sector_code    VARCHAR(24)  NOT NULL,
  q_ref          VARCHAR(16)  NOT NULL,
  dimension_code VARCHAR(8)   NOT NULL,
  q_text         VARCHAR(600) NOT NULL,
  score_1_label  VARCHAR(200) NULL,
  score_2_label  VARCHAR(200) NULL,
  score_3_label  VARCHAR(200) NULL,
  ord            SMALLINT UNSIGNED NOT NULL
);

/* These are relationship questions, like the core twelve - what the supplier
   can reach in the client, not how the supplier runs itself. A tiering
   question the supplier could answer about itself would belong in the control
   set instead. */
INSERT INTO tmp_sector_t
  (sector_code, q_ref, dimension_code, q_text, score_1_label, score_2_label, score_3_label, ord)
VALUES
-- ---- Oil, Gas and Petroleum: reach into the process estate ---------------
 ('OILGAS','T30','ACCESS','What level of reach does the third party have into our process control estate?','None, corporate systems only','Read only or monitoring access to OT','Able to change control logic or setpoints',10),
 ('OILGAS','T31','CRIT','Could a failure of this third party stop production at a site?','No production impact','A single site slows or degrades','A site stops, or safety systems are affected',20),
-- ---- Manufacturing and OT ------------------------------------------------
 ('MFG','T34','ACCESS','What level of reach does the third party have into our plant network?','None, corporate systems only','Read only or monitoring access to plant systems','Able to change machine or line configuration',10),
-- ---- Banking and Capital Markets: the regulator''s view -------------------
 ('BANK','T32','REG','Would our regulator treat this arrangement as a critical or important function?','No, routine outsourcing','Important but not critical','Critical - registration and exit planning required',10),
-- ---- Healthcare -----------------------------------------------------------
 ('HEALTH','T33','DATA','Does the third party handle patient identifiable information on our behalf?','No patient data at all','Pseudonymised or aggregated only','Directly identifiable patient records',10);

/* Refs have to be unique across the sector questions, not just within an
   instrument. The pack is one sheet: two sectors both using T30 would put two
   columns under the same heading, and the legend would explain the ref twice
   with two different questions. MFG's was renumbered to T34 - this clears the
   superseded row so re-running lands on the new ref rather than leaving both. */
DELETE q FROM question q
  JOIN instrument_version iv ON iv.instrument_version_id = q.instrument_version_id
 WHERE iv.sector_code = 'MFG' AND q.q_type = 'tiering'
   AND q.is_core = 0 AND q.q_ref = 'T30'
   AND NOT EXISTS (SELECT 1 FROM response r WHERE r.q_ref = q.q_ref);

/* Written into the published instrument for each sector. A sector still being
   authored has no published version and is left alone. */
INSERT INTO question
    (instrument_version_id, q_type, q_ref, is_core, dimension_code, q_text,
     score_1_label, score_2_label, score_3_label, tier_applies, sort_order)
SELECT iv.instrument_version_id, 'tiering', t.q_ref, 0, t.dimension_code, t.q_text,
       t.score_1_label, t.score_2_label, t.score_3_label, 3, 1000 + t.ord
  FROM tmp_sector_t t
  JOIN instrument_version iv
    ON iv.sector_code = t.sector_code AND iv.status = 'published'
 WHERE NOT EXISTS (SELECT 1 FROM question q2
                    WHERE q2.instrument_version_id = iv.instrument_version_id
                      AND q2.q_ref = t.q_ref);

DROP TEMPORARY TABLE IF EXISTS tmp_sector_t;
