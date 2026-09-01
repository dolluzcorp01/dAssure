-- Login banners.
--
-- The rotating panel on the sign-in screen. It was hardcoded in TPRM_Login.js;
-- this makes it content, editable by a Practice Head without a deploy. Each
-- banner carries its own gradient, so the panels do not all look alike.
--
-- created_by / edited_by are VARCHAR(20): they hold a dadmin.employee.emp_id
-- like 'DZIND148', not an integer.

CREATE TABLE IF NOT EXISTS banner (
  banner_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tag_label      VARCHAR(40)  NULL,
  headline       VARCHAR(160) NOT NULL,
  subline        VARCHAR(400) NULL,
  gradient_from  CHAR(7)      NOT NULL DEFAULT '#0D1B2A',
  gradient_to    CHAR(7)      NOT NULL DEFAULT '#16334F',
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  active         TINYINT(1)   NOT NULL DEFAULT 1,
  created_by     VARCHAR(20)  NULL,
  edited_by      VARCHAR(20)  NULL,
  created_time   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  edited_time    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                   ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (banner_id),
  KEY ix_banner_live (active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The three panels that were hardcoded in TPRM_Login.js, text unchanged.
-- INSERT IGNORE keeps this re-runnable and never overwrites an edit made in
-- the app: once a Practice Head changes a headline, re-running the migration
-- leaves it alone.
INSERT IGNORE INTO banner
  (banner_id, tag_label, headline, subline, gradient_from, gradient_to, sort_order)
VALUES
 (1,'EVIDENCE','An assertion is not evidence',
  'A control claimed without proof is recorded as Not Evidenced and scores accordingly. The rule enforces itself.',
  '#0E1A2B','#1E3350',1),
 (2,'SEGREGATION','Nobody approves their own work',
  'The reviewer can never be the assessor. Enforced in the database, not only in the interface.',
  '#123F3A','#1B7A5A',2),
 (3,'TRACEABILITY','Every score traces to an answer',
  'Residual risk is derived from inherent risk and control effectiveness. It is never typed in by hand.',
  '#3D2E08','#8A6D12',3);

-- The permission that gates the Banners screen.
INSERT INTO tprm_permission (perm_key, label, category, sort_order)
VALUES ('banner.manage','Edit the login screen banners','admin',20)
ON DUPLICATE KEY UPDATE label=VALUES(label);

INSERT IGNORE INTO tprm_role_permission (role_id, permission_id, granted)
SELECT r.role_id, p.permission_id, 1 FROM tprm_role r JOIN tprm_permission p
 WHERE r.role_code IN ('PH','EM') AND p.perm_key = 'banner.manage';
