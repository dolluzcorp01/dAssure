-- Two factor: a six digit code, emailed.
--
-- Same model as the rest of the suite (dadmin.otpstorage), but dTprm keeps its
-- own table rather than writing to that one. dadmin.otpstorage is UNIQUE on
-- UserInput, so it holds one live code per email address across every dApp -
-- a code requested in dTime would overwrite one requested here, and whichever
-- app asked second would silently break the first. A table per app avoids that
-- entirely, and keeps a dTprm sign-in out of a shared row.
--
-- emp_id is VARCHAR(20): it holds a dadmin.employee.emp_id like 'DZIND148',
-- not an integer - the same convention as banner.created_by.
--
-- The code is stored as a SHA-256 hash, never in the clear, so reading this
-- table does not hand anybody a working second factor. It is emailed once and
-- is not recoverable from here afterwards - a lost code is resent, not looked
-- up, which is the whole reason this design needs no recovery codes.
--
-- One row per send. Requesting a new code supersedes every earlier unconsumed
-- row for that person, so only the newest code can ever be redeemed.

DROP TABLE IF EXISTS tprm_user_mfa;

CREATE TABLE IF NOT EXISTS tprm_login_otp (
  otp_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  emp_id        VARCHAR(20)  NOT NULL,
  code_hash     CHAR(64)     NOT NULL,
  expires_at    DATETIME(3)  NOT NULL,
  consumed_at   DATETIME(3)  NULL,
  superseded_at DATETIME(3)  NULL,
  attempts      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  send_no       SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  mail_id       BIGINT UNSIGNED NULL,
  ip_addr       VARCHAR(45)  NULL,
  user_agent    VARCHAR(300) NULL,
  created_time  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (otp_id),
  KEY ix_otp_live (emp_id, consumed_at, superseded_at, expires_at),
  KEY ix_otp_created (emp_id, created_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
