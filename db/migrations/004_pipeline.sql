-- =====================================================================
--  dTprm  Migration 004   Intake pipeline, distribution, mail, case notes
-- =====================================================================

-- Rows exactly as received from the client intake workbook, before any
-- interpretation. Kept so an import can always be explained or replayed.
CREATE TABLE IF NOT EXISTS intake_batch (
  batch_id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  filename          VARCHAR(260) NOT NULL,
  business_unit     VARCHAR(160) NULL,
  rows_read         INT UNSIGNED NOT NULL DEFAULT 0,
  rows_valid        INT UNSIGNED NOT NULL DEFAULT 0,
  rows_rejected     INT UNSIGNED NOT NULL DEFAULT 0,
  duplicates        INT UNSIGNED NOT NULL DEFAULT 0,
  column_map_json   JSON         NULL,
  state             ENUM('previewed','committed','discarded') NOT NULL DEFAULT 'previewed',
  uploaded_by       VARCHAR(20)     NOT NULL,
  created_time      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  committed_time    DATETIME(3)  NULL,
  PRIMARY KEY (batch_id),
  KEY ix_ib_tenant (tenant_id, state),
  CONSTRAINT fk_ib_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS intake_row (
  intake_row_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id          BIGINT UNSIGNED NOT NULL,
  row_no            INT UNSIGNED NOT NULL,
  raw_json          JSON         NOT NULL,
  vendor_name       VARCHAR(180) NULL,
  service_desc      VARCHAR(400) NULL,
  spend_category    VARCHAR(120) NULL,
  annual_value      DECIMAL(14,2) NULL,
  contract_owner    VARCHAR(120) NULL,
  contact_email     VARCHAR(190) NULL,
  data_access       CHAR(1)      NULL,
  system_access     CHAR(1)      NULL,
  suggested_sector  VARCHAR(24)  NULL,
  confidence        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  confirmed_sector  VARCHAR(24)  NULL,
  status            ENUM('ok','rejected','duplicate','imported') NOT NULL DEFAULT 'ok',
  error_code        VARCHAR(32)  NULL,
  error_message     VARCHAR(400) NULL,
  third_party_id    BIGINT UNSIGNED NULL,
  PRIMARY KEY (intake_row_id),
  KEY ix_ir_batch (batch_id, status),
  KEY ix_ir_tp (third_party_id),
  CONSTRAINT fk_ir_batch FOREIGN KEY (batch_id)       REFERENCES intake_batch (batch_id) ON DELETE CASCADE,
  CONSTRAINT fk_ir_tp    FOREIGN KEY (third_party_id) REFERENCES third_party (third_party_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Questionnaire distribution and response tracking, one row per assessment.
CREATE TABLE IF NOT EXISTS distribution (
  distribution_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assessment_id     BIGINT UNSIGNED NOT NULL,
  channel           ENUM('zip','email') NOT NULL,
  state             ENUM('ready','zipped','emailed','reminded','returned','imported') NOT NULL DEFAULT 'ready',
  recipient         VARCHAR(190) NULL,
  workbook_key      VARCHAR(400) NULL,
  issued_time       DATETIME(3)  NULL,
  issued_by         VARCHAR(20)     NULL,
  reminded_time     DATETIME(3)  NULL,
  returned_time     DATETIME(3)  NULL,
  imported_time     DATETIME(3)  NULL,
  PRIMARY KEY (distribution_id),
  UNIQUE KEY uq_dist_as (assessment_id),
  KEY ix_dist_state (state),
  CONSTRAINT fk_dist_as FOREIGN KEY (assessment_id) REFERENCES assessment (assessment_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Outbound mail, queued here first so delivery is part of the audit trail
-- even when SendGrid is down. Same outbox pattern as dNews.
CREATE TABLE IF NOT EXISTS tprm_mail_outbox (
  mail_id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id         BIGINT UNSIGNED NULL,
  to_addr           VARCHAR(400) NOT NULL,
  cc_addr           VARCHAR(400) NULL,
  subject           VARCHAR(300) NOT NULL,
  body_text         TEXT         NOT NULL,
  attachment_key    VARCHAR(400) NULL,
  attachment_name   VARCHAR(260) NULL,
  kind              VARCHAR(40)  NOT NULL,
  state             ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
  provider_id       VARCHAR(120) NULL,
  error             VARCHAR(400) NULL,
  attempts          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_by        VARCHAR(20)     NULL,
  created_time      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_time         DATETIME(3)  NULL,
  PRIMARY KEY (mail_id),
  KEY ix_mail_state (state, created_time),
  CONSTRAINT fk_mail_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Human comments and system activity share one stream so a case reads as a
-- single story. msg_kind separates them for rendering.
CREATE TABLE IF NOT EXISTS case_message (
  message_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assessment_id     BIGINT UNSIGNED NOT NULL,
  msg_kind          ENUM('comment','activity') NOT NULL DEFAULT 'comment',
  author_id         VARCHAR(20)     NULL,
  body              TEXT         NOT NULL,
  context_ref       VARCHAR(16)  NULL,
  deleted_time      DATETIME(3)  NULL,
  created_time      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (message_id),
  KEY ix_cm_as (assessment_id, created_time),
  CONSTRAINT fk_cm_as FOREIGN KEY (assessment_id) REFERENCES assessment (assessment_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$
CREATE TRIGGER trg_case_message_author_ins BEFORE INSERT ON case_message
FOR EACH ROW
BEGIN
  IF NEW.msg_kind = 'comment' AND NEW.author_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A comment must have an author';
  END IF;
END$$
DELIMITER ;
