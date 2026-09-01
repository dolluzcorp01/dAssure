-- =====================================================================
--  dTprm  Migration 010   The operating context captured at onboarding
--
--  The onboarding wizard asks for more than a name and a code. Trading
--  name is a real field - it is what appears on a report when it differs
--  from the legal entity - so it gets a column.
--
--  The rest is context: secondary sectors, operating regions, applicable
--  regulators, scale band, data types in scope. Every one of them is a
--  list that will grow, and none of them is ever joined on or filtered by
--  in SQL - they are carried into each assessment as inherited context.
--  A JSON column says that honestly. Six lookup tables would say the
--  opposite and buy nothing.
--  Safe to re-run.
-- =====================================================================

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant'
              AND COLUMN_NAME = 'trading_name');
SET @s := IF(@c = 0,
  'ALTER TABLE tenant ADD COLUMN trading_name VARCHAR(160) NULL AFTER tenant_name',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant'
              AND COLUMN_NAME = 'context_json');
SET @s := IF(@c = 0,
  'ALTER TABLE tenant ADD COLUMN context_json JSON NULL AFTER default_sector',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
