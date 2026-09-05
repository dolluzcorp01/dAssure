-- =====================================================================
--  dAssure  Migration 020   The mail body column the code already writes
--
--  tprm_mailer.queue() has always inserted body_html alongside body_text -
--  it is what carries the house email shell - but no migration ever created
--  the column. Every database built by hand carried it; every database
--  built by running the migrations did not.
--
--  That gap was survivable only while nothing sent mail on the sign-in
--  path. It is not survivable now: sendOtp awaits the outbox insert, so on
--  a freshly migrated system the missing column makes /Verifylogin throw
--  and NOBODY can sign in at all - with an error that says "Database
--  error" and nothing about a column.
--
--  LONGTEXT rather than TEXT: a rendered questionnaire mail with the full
--  shell around it runs past TEXT's 64 KB without much effort.
-- =====================================================================

USE dtprm;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tprm_mail_outbox'
              AND COLUMN_NAME = 'body_html');
SET @s := IF(@c = 0,
  'ALTER TABLE tprm_mail_outbox ADD COLUMN body_html LONGTEXT NULL AFTER body_text',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
