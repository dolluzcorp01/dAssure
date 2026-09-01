-- =====================================================================
--  dTprm  -  empty the database
--
--  Section 1 clears everything the app RECORDS: engagements, suppliers,
--  assessments, findings, reports, logs. Run it and dTprm is a working,
--  empty installation.
--
--  Section 2 clears what the app was TAUGHT: the instrument library and
--  the login banners. Both are restored by `node db/migrate.js`, but any
--  instrument you authored yourself is gone for good. It is commented out
--  for that reason - uncomment deliberately.
--
--  What is never truncated here is the reference catalogue: sectors,
--  standards, control domains, tiering dimensions, classification rules,
--  roles and the permission matrix. Empty those and the app cannot answer
--  a single request until the migrations are re-run.
--
--  After running section 1:  nobody holds an engagement role, so the first
--  person to sign in lands in setup mode and can onboard the first client.
--  That is by design - it is the same path a fresh install takes.
-- =====================================================================

USE dtprm;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
--  1. Operational data
-- ---------------------------------------------------------------------

-- Assessment work, deepest first
TRUNCATE TABLE response_history;
TRUNCATE TABLE evidence;
TRUNCATE TABLE response;
TRUNCATE TABLE case_message;
TRUNCATE TABLE contradiction_flag;
TRUNCATE TABLE finding;
TRUNCATE TABLE report_issue;
TRUNCATE TABLE distribution;
TRUNCATE TABLE assessment;

-- The supplier population pipeline
TRUNCATE TABLE intake_row;
TRUNCATE TABLE intake_batch;
TRUNCATE TABLE triage_decision;
TRUNCATE TABLE third_party;

-- Clients, their methodology dials and who is granted a role on them
TRUNCATE TABLE tenant_methodology;
TRUNCATE TABLE tprm_user_tenant_role;
TRUNCATE TABLE tenant;

-- Logs and one-time codes
TRUNCATE TABLE tprm_audit_event;
TRUNCATE TABLE tprm_mail_outbox;
TRUNCATE TABLE tprm_login_otp;

-- ---------------------------------------------------------------------
--  2. Authored content  -  uncomment only if you mean it
--     Restored by `node db/migrate.js`, EXCEPT anything you authored.
-- ---------------------------------------------------------------------

-- TRUNCATE TABLE contradiction_rule;
-- TRUNCATE TABLE instrument_standard;
-- TRUNCATE TABLE question;
-- TRUNCATE TABLE instrument_version;
-- TRUNCATE TABLE banner;

SET FOREIGN_KEY_CHECKS = 1;
