-- =====================================================================
--  dAssure  Migration 023   The login banners move to dAdmin
--
--  dAdmin now owns one Login Page Config for every dApp's sign-in screen
--  (Inside D -> Login Page Config), and dAssure's panel reads it from
--  /api/login-banners/public. The local banner table, its Banners screen and
--  the banner.manage permission that gated that screen are retired.
--
--  006_banner.sql, which created all three, has been deleted rather than
--  emptied. db/migrate.js keeps no ledger and re-runs every file on every
--  run, so leaving 006 in place would recreate the table and re-grant the
--  permission to PH and EM each time anyone migrated. This file removes
--  them from databases where 006 already ran, and is a no-op everywhere
--  else - safe to re-run forever.
--
--  tprm_role_permission is the only table keyed on permission_id; there is
--  no per-person grant table to clear. Its foreign key already cascades, so
--  deleting the permission row alone would clear the grants - they are
--  deleted explicitly anyway, so the intent is readable here rather than
--  inferred from a constraint in 001.
--
--  Audit rows that mention banners are left alone. They record what
--  happened; retiring a feature does not rewrite that.
-- =====================================================================

USE dtprm;

-- The grants first, joined exactly as 006 created them.
DELETE rp
  FROM tprm_role_permission rp
  JOIN tprm_permission p ON p.permission_id = rp.permission_id
 WHERE p.perm_key = 'banner.manage';

DELETE FROM tprm_permission WHERE perm_key = 'banner.manage';

DROP TABLE IF EXISTS banner;
