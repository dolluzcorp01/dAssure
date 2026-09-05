-- =====================================================================
--  dAssure  Migration 019   The client's own contact
--
--  Until now nothing recorded who to talk to at a client. The tenant row
--  held a name, a code and a sector, and every message that had to reach
--  the client - the intake template, the tiering pack, an issued report -
--  took its recipient from whatever somebody typed into the box at the
--  time. The same person's address, retyped at every step of a nine stage
--  engagement, with no record afterwards of who it had been sent to.
--
--  This is the client's OWN contact, not a login. A client user still
--  cannot sign in; identity comes from dadmin.employee and there is no
--  external principal. It is an address book entry, so the workflow stops
--  losing it.
-- =====================================================================

USE dtprm;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant'
              AND COLUMN_NAME = 'contact_name');
SET @s := IF(@c = 0,
  'ALTER TABLE tenant ADD COLUMN contact_name VARCHAR(160) NULL AFTER trading_name',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant'
              AND COLUMN_NAME = 'contact_email');
SET @s := IF(@c = 0,
  'ALTER TABLE tenant ADD COLUMN contact_email VARCHAR(190) NULL AFTER contact_name',
  'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
