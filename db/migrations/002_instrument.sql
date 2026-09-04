-- =====================================================================
--  dAssure  Migration 002   Instruments, questions, standards
--
--  The version freeze lives here. An assessment binds to one
--  instrument_version for its whole life, so editing a question later can
--  never rewrite a report that was already issued.
-- =====================================================================

CREATE TABLE IF NOT EXISTS sector (
  sector_code       VARCHAR(24)  NOT NULL,
  sector_name       VARCHAR(120) NOT NULL,
  sector_group      VARCHAR(60)  NOT NULL,
  sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  active            TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (sector_code),
  KEY ix_sector_group (sector_group, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS standard (
  standard_code     VARCHAR(60)  NOT NULL,
  title             VARCHAR(200) NOT NULL,
  family            VARCHAR(40)  NOT NULL,
  scope_note        VARCHAR(300) NULL,
  active            TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (standard_code),
  KEY ix_std_family (family)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS control_domain (
  domain_code       VARCHAR(8)   NOT NULL,
  domain_name       VARCHAR(120) NOT NULL,
  default_weight    SMALLINT UNSIGNED NOT NULL,
  sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (domain_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tiering_dimension (
  dimension_code    VARCHAR(8)   NOT NULL,
  dimension_name    VARCHAR(120) NOT NULL,
  default_weight    DECIMAL(4,3) NOT NULL,
  note              VARCHAR(300) NULL,
  sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (dimension_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- draft is editable, published is immutable, retired stays readable so old
-- assessments still render.
CREATE TABLE IF NOT EXISTS instrument_version (
  instrument_version_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sector_code       VARCHAR(24)  NOT NULL,
  version_no        SMALLINT UNSIGNED NOT NULL,
  status            ENUM('draft','published','retired') NOT NULL DEFAULT 'draft',
  frozen            TINYINT(1)   NOT NULL DEFAULT 0,
  change_note       VARCHAR(600) NULL,
  authored_by       VARCHAR(20)     NULL,
  published_by      VARCHAR(20)     NULL,
  published_time    DATETIME(3)  NULL,
  retired_time      DATETIME(3)  NULL,
  created_time      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (instrument_version_id),
  UNIQUE KEY uq_iv (sector_code, version_no),
  KEY ix_iv_status (sector_code, status),
  CONSTRAINT fk_iv_sector FOREIGN KEY (sector_code) REFERENCES sector (sector_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS instrument_standard (
  instrument_version_id BIGINT UNSIGNED NOT NULL,
  standard_code         VARCHAR(60) NOT NULL,
  PRIMARY KEY (instrument_version_id, standard_code),
  CONSTRAINT fk_is_iv  FOREIGN KEY (instrument_version_id) REFERENCES instrument_version (instrument_version_id) ON DELETE CASCADE,
  CONSTRAINT fk_is_std FOREIGN KEY (standard_code)         REFERENCES standard (standard_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tiering and control questions share one table, separated by q_type.
-- tier_applies: 1 = Tier 1 only, 2 = Tier 1 and 2, 3 = every tier.
CREATE TABLE IF NOT EXISTS question (
  question_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  instrument_version_id BIGINT UNSIGNED NOT NULL,
  q_type            ENUM('tiering','control') NOT NULL,
  q_ref             VARCHAR(16)  NOT NULL,
  is_core           TINYINT(1)   NOT NULL DEFAULT 1,
  dimension_code    VARCHAR(8)   NULL,
  domain_code       VARCHAR(8)   NULL,
  q_text            VARCHAR(600) NOT NULL,
  score_1_label     VARCHAR(200) NULL,
  score_2_label     VARCHAR(200) NULL,
  score_3_label     VARCHAR(200) NULL,
  rationale         VARCHAR(600) NULL,
  evidence_required VARCHAR(400) NULL,
  standards_mapping VARCHAR(400) NULL,
  tier_applies      TINYINT UNSIGNED NOT NULL DEFAULT 3,
  sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (question_id),
  UNIQUE KEY uq_q (instrument_version_id, q_ref),
  KEY ix_q_type (instrument_version_id, q_type, sort_order),
  CONSTRAINT fk_q_iv  FOREIGN KEY (instrument_version_id) REFERENCES instrument_version (instrument_version_id) ON DELETE CASCADE,
  CONSTRAINT fk_q_dim FOREIGN KEY (dimension_code) REFERENCES tiering_dimension (dimension_code),
  CONSTRAINT fk_q_dom FOREIGN KEY (domain_code)    REFERENCES control_domain (domain_code),
  CONSTRAINT ck_q_shape CHECK (
    (q_type = 'tiering' AND dimension_code IS NOT NULL) OR
    (q_type = 'control' AND domain_code    IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cross-question consistency rules. Data, not code, so a new rule needs no
-- deployment.
CREATE TABLE IF NOT EXISTS contradiction_rule (
  rule_id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  instrument_version_id BIGINT UNSIGNED NULL,
  ref_a             VARCHAR(16)  NOT NULL,
  positions_a       VARCHAR(200) NOT NULL,
  ref_b             VARCHAR(16)  NOT NULL,
  positions_b       VARCHAR(200) NOT NULL,
  message           VARCHAR(600) NOT NULL,
  active            TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (rule_id),
  KEY ix_cr_iv (instrument_version_id, active),
  CONSTRAINT fk_cr_iv FOREIGN KEY (instrument_version_id) REFERENCES instrument_version (instrument_version_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Keyword rules that map a supplier name and service line to an instrument.
CREATE TABLE IF NOT EXISTS classify_rule (
  classify_rule_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sector_code       VARCHAR(24)  NOT NULL,
  keyword           VARCHAR(80)  NOT NULL,
  weight            TINYINT UNSIGNED NOT NULL DEFAULT 10,
  active            TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (classify_rule_id),
  KEY ix_clr_sector (sector_code, active),
  CONSTRAINT fk_clr_sector FOREIGN KEY (sector_code) REFERENCES sector (sector_code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
