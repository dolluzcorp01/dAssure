-- =====================================================================
--  dAssure  Migration 022   What a mailed code is FOR
--
--  tprm_login_otp held one kind of code: the sign-in second factor. Adding
--  password reset puts a second kind in the same table, and the two must
--  never be interchangeable.
--
--  Without this column, a code mailed to finish a password reset would be
--  the newest live row for that person - which is exactly what
--  /mfa/verify looks for. A code issued for one purpose would open the
--  other door. They are separated here rather than in the query alone, so
--  the separation survives somebody writing a new query later.
--
--  Defaults to 'login', so every row already in the table keeps meaning
--  what it meant when it was written.
-- =====================================================================

USE dtprm;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tprm_login_otp'
              AND COLUMN_NAME = 'purpose');
SET @s := IF(@c = 0,
  'ALTER TABLE tprm_login_otp
     ADD COLUMN purpose ENUM(''login'',''reset'') NOT NULL DEFAULT ''login'' AFTER emp_id',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

/* The live-code lookup filters on purpose now, so it leads the index. */
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tprm_login_otp'
              AND INDEX_NAME = 'ix_otp_purpose');
SET @s := IF(@c = 0,
  'ALTER TABLE tprm_login_otp
     ADD KEY ix_otp_purpose (emp_id, purpose, consumed_at, superseded_at, expires_at)',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
