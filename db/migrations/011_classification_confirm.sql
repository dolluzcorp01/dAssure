-- =====================================================================
--  dTprm  Migration 011   Who confirmed a supplier's classification
--
--  The classification review asks a person to confirm, or correct, the
--  instrument a keyword rule suggested. Until now there was nowhere to
--  record that they had: the screen could change the instrument but not
--  remember that a human had signed off the ones it left alone, so the
--  step could never be finished, only revisited.
--
--  Confirmation is evidence, not a checkbox - this is the record that a
--  named person accepted the rule's answer - so it stores who and when
--  rather than a boolean.
--  Safe to re-run.
-- =====================================================================

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'third_party'
              AND COLUMN_NAME = 'sector_confirmed_by');
SET @s := IF(@c = 0,
  'ALTER TABLE third_party ADD COLUMN sector_confirmed_by VARCHAR(20) NULL AFTER sector_code',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'third_party'
              AND COLUMN_NAME = 'sector_confirmed_time');
SET @s := IF(@c = 0,
  'ALTER TABLE third_party ADD COLUMN sector_confirmed_time DATETIME(3) NULL AFTER sector_confirmed_by',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
