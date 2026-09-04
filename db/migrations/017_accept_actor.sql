-- =====================================================================
--  dAssure  Migration 017   Who accepted a risk, and when
--
--  The finding recorded accept_owner as free text somebody typed, and nothing
--  at all about when the acceptance happened. Both were being asked for in the
--  UI when neither needed asking: the person accepting is the person clicking,
--  and the moment is now. Typing your own name into a box the system already
--  knows the answer to is a way to get it wrong.
--
--  accept_owner stays, and is now filled from the signed-in employee rather
--  than typed. Keeping it denormalised means a report can name the acceptor
--  without joining out to dadmin, and it still reads correctly years later if
--  that person has since left.
--
--  What is NOT removed is accept_expires. The table's own CHECK constraint
--  refuses an accepted finding without one:
--
--    CHECK (status <> 'accepted' OR (accept_reason IS NOT NULL
--                                    AND accept_expires IS NOT NULL))
--
--  That is deliberate. Without a review date, "risk accepted" is how a finding
--  disappears for good, and the whole point of the status is that it comes
--  back. The reason and the date are the two things a person must supply; the
--  name and the timestamp are the two the system supplies for them.
-- =====================================================================

USE dtprm;

SET @has_by := (SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = 'finding'
                   AND column_name = 'accept_by');
SET @sql := IF(@has_by = 0,
  'ALTER TABLE finding ADD COLUMN accept_by VARCHAR(20) NULL AFTER accept_owner',
  'DO 0');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @has_at := (SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = 'finding'
                   AND column_name = 'accept_at');
SET @sql := IF(@has_at = 0,
  'ALTER TABLE finding ADD COLUMN accept_at DATETIME(3) NULL AFTER accept_by',
  'DO 0');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
