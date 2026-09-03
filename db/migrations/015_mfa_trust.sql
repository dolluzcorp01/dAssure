-- =====================================================================
--  dTprm  Migration 015   "Remember for 14 days"
--
--  The sign-in screen has carried this checkbox and sent it to the server for
--  a while; the server ignored it, because two factor was unconditional.
--
--  READ THIS BEFORE CHANGING IT. The trust recorded here is per ACCOUNT, not
--  per device or per browser. That is deliberate and it is what was asked for:
--  sign in on Chrome with the box ticked, and Firefox on another machine will
--  not ask for a code either. The row is keyed on emp_id alone, and no cookie,
--  user agent or address is part of the lookup.
--
--  What that means in practice: for fourteen days after one successful code,
--  the password is the only thing standing between anyone and this account,
--  from anywhere. It is not "remember this device" - it is "second factor off
--  for fourteen days". The columns below record who granted it, from where and
--  when, because that is the only trail there will be.
--
--  To make it device bound instead, keep this table and add a random token
--  stored in a long lived cookie: write its hash here on grant and require a
--  match on lookup. A new browser then has no token and gets the code, which
--  is how the control is normally built.
-- =====================================================================

USE dtprm;

CREATE TABLE IF NOT EXISTS tprm_mfa_trust (
  emp_id            VARCHAR(20)  NOT NULL,
  trusted_until     DATETIME(3)  NOT NULL,
  granted_time      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  granted_ip        VARCHAR(64)  NULL,
  granted_agent     VARCHAR(255) NULL,
  revoked_time      DATETIME(3)  NULL,
  PRIMARY KEY (emp_id),
  KEY ix_trust_live (trusted_until, revoked_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
