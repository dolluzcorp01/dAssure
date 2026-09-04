-- =====================================================================
--  dAssure  Migration 003   Third parties, assessments, evidence, findings
-- =====================================================================

CREATE TABLE IF NOT EXISTS third_party (
  third_party_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  ref_code          VARCHAR(24)  NOT NULL,
  third_party_name  VARCHAR(180) NOT NULL,
  sector_code       VARCHAR(24)  NOT NULL,
  service_desc      VARCHAR(300) NULL,
  country           VARCHAR(80)  NULL,
  contract_owner    VARCHAR(120) NULL,
  security_contact  VARCHAR(190) NULL,
  contract_start    DATE         NULL,
  contract_end      DATE         NULL,
  annual_value      DECIMAL(14,2) NULL,
  currency          CHAR(3)      NOT NULL DEFAULT 'INR',
  status            ENUM('active','offboarding','terminated') NOT NULL DEFAULT 'active',
  created_by        VARCHAR(20)     NULL,
  created_time      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  edited_by         VARCHAR(20)     NULL,
  edited_time       DATETIME(3)  NULL,
  deleted_time      DATETIME(3)  NULL,
  PRIMARY KEY (third_party_id),
  UNIQUE KEY uq_tp_ref (tenant_id, ref_code),
  KEY ix_tp_tenant (tenant_id, status),
  CONSTRAINT fk_tp_tenant FOREIGN KEY (tenant_id)   REFERENCES tenant (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_tp_sector FOREIGN KEY (sector_code) REFERENCES sector (sector_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Scope decision, kept for every third party so a descope is always defensible.
CREATE TABLE IF NOT EXISTS triage_decision (
  third_party_id    BIGINT UNSIGNED NOT NULL,
  in_scope          TINYINT(1)   NOT NULL,
  reason            VARCHAR(400) NULL,
  rule_version      VARCHAR(24)  NULL,
  decided_by        VARCHAR(20)     NULL,
  decided_time      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  recheck_due       DATE         NULL,
  PRIMARY KEY (third_party_id),
  CONSTRAINT fk_td_tp FOREIGN KEY (third_party_id) REFERENCES third_party (third_party_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One assessment cycle. instrument_version_id is set at draft and never
-- changes. Scores are cached on approval so a report is reproducible without
-- recomputing.
CREATE TABLE IF NOT EXISTS assessment (
  assessment_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  third_party_id    BIGINT UNSIGNED NOT NULL,
  instrument_version_id BIGINT UNSIGNED NOT NULL,
  cycle_label       VARCHAR(40)  NULL,
  state             ENUM('draft','in_progress','on_hold','under_review','approved','issued','closed')
                    NOT NULL DEFAULT 'draft',
  assessor_id       VARCHAR(20)     NULL,
  reviewer_id       VARCHAR(20)     NULL,
  hold_reason       VARCHAR(300) NULL,
  held_time         DATETIME(3)  NULL,
  hold_elapsed_sec  INT UNSIGNED NOT NULL DEFAULT 0,
  inherent_score    DECIMAL(4,2) NULL,
  tier              TINYINT UNSIGNED NULL,
  effectiveness     DECIMAL(5,4) NULL,
  residual_score    DECIMAL(4,2) NULL,
  residual_band     VARCHAR(12)  NULL,
  submitted_time    DATETIME(3)  NULL,
  approved_time     DATETIME(3)  NULL,
  issued_time       DATETIME(3)  NULL,
  closed_time       DATETIME(3)  NULL,
  created_by        VARCHAR(20)     NULL,
  created_time      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  edited_time       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (assessment_id),
  KEY ix_as_tenant (tenant_id, state),
  KEY ix_as_tp (third_party_id, created_time),
  KEY ix_as_assessor (assessor_id, state),
  CONSTRAINT fk_as_tenant FOREIGN KEY (tenant_id)      REFERENCES tenant (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_as_tp     FOREIGN KEY (third_party_id) REFERENCES third_party (third_party_id) ON DELETE CASCADE,
  CONSTRAINT fk_as_iv     FOREIGN KEY (instrument_version_id) REFERENCES instrument_version (instrument_version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Segregation of duties, enforced in the database rather than only in code.
-- An assessor can never be their own reviewer, on insert or on update.
DELIMITER $$

CREATE TRIGGER trg_assessment_sod_ins BEFORE INSERT ON assessment
FOR EACH ROW
BEGIN
  IF NEW.reviewer_id IS NOT NULL AND NEW.assessor_id IS NOT NULL
     AND NEW.reviewer_id = NEW.assessor_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Segregation of duties: the reviewer cannot be the assessor';
  END IF;
END$$

CREATE TRIGGER trg_assessment_sod_upd BEFORE UPDATE ON assessment
FOR EACH ROW
BEGIN
  IF NEW.reviewer_id IS NOT NULL AND NEW.assessor_id IS NOT NULL
     AND NEW.reviewer_id = NEW.assessor_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Segregation of duties: the reviewer cannot be the assessor';
  END IF;
END$$

DELIMITER ;

-- Current answer per question. History lives in response_history, never here.
CREATE TABLE IF NOT EXISTS response (
  response_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assessment_id     BIGINT UNSIGNED NOT NULL,
  q_ref             VARCHAR(16)  NOT NULL,
  q_type            ENUM('tiering','control') NOT NULL,
  tiering_score     TINYINT UNSIGNED NULL,
  position          ENUM('Compliant','Partially Compliant','Non-Compliant','Not Evidenced','Not Applicable') NULL,
  control_score     TINYINT UNSIGNED NULL,
  assessor_note     VARCHAR(1000) NULL,
  -- A supplier answer lands as an assertion until an assessor accepts it.
  vendor_asserted   TINYINT(1)   NOT NULL DEFAULT 0,
  is_override       TINYINT(1)   NOT NULL DEFAULT 0,
  override_reason   VARCHAR(600) NULL,
  override_by       VARCHAR(20)     NULL,
  answered_by       VARCHAR(20)     NULL,
  answered_time     DATETIME(3)  NULL,
  PRIMARY KEY (response_id),
  UNIQUE KEY uq_resp (assessment_id, q_ref),
  KEY ix_resp_type (assessment_id, q_type),
  CONSTRAINT fk_resp_as   FOREIGN KEY (assessment_id) REFERENCES assessment (assessment_id) ON DELETE CASCADE,
  CONSTRAINT ck_resp_tier CHECK (tiering_score IS NULL OR tiering_score BETWEEN 1 AND 3),
  CONSTRAINT ck_resp_ctrl CHECK (control_score IS NULL OR control_score BETWEEN 0 AND 2),
  CONSTRAINT ck_resp_ovr  CHECK (is_override = 0 OR override_reason IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS response_history (
  history_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  response_id       BIGINT UNSIGNED NOT NULL,
  old_position      VARCHAR(24)  NULL,
  new_position      VARCHAR(24)  NULL,
  old_score         TINYINT UNSIGNED NULL,
  new_score         TINYINT UNSIGNED NULL,
  reason            VARCHAR(600) NULL,
  changed_by        VARCHAR(20)     NULL,
  changed_time      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (history_id),
  KEY ix_rh_resp (response_id, changed_time),
  CONSTRAINT fk_rh_resp FOREIGN KEY (response_id) REFERENCES response (response_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Evidence as a first class object. expires_at drives automatic decay: a
-- lapsed certificate moves its control to Not Evidenced without anyone acting.
CREATE TABLE IF NOT EXISTS evidence (
  evidence_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  response_id       BIGINT UNSIGNED NOT NULL,
  file_key          VARCHAR(400) NOT NULL,
  original_name     VARCHAR(260) NOT NULL,
  mime_type         VARCHAR(120) NULL,
  byte_size         BIGINT UNSIGNED NULL,
  sha256            CHAR(64)     NOT NULL,
  doc_type          VARCHAR(80)  NULL,
  valid_from        DATE         NULL,
  expires_at        DATE         NULL,
  validated_by      VARCHAR(20)     NULL,
  validated_time    DATETIME(3)  NULL,
  uploaded_by       VARCHAR(20)     NOT NULL,
  uploaded_time     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (evidence_id),
  KEY ix_ev_resp (response_id),
  KEY ix_ev_expiry (expires_at),
  CONSTRAINT fk_ev_resp FOREIGN KEY (response_id) REFERENCES response (response_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finding (
  finding_id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  assessment_id     BIGINT UNSIGNED NOT NULL,
  finding_ref       VARCHAR(24)  NOT NULL,
  control_ref       VARCHAR(16)  NOT NULL,
  domain_code       VARCHAR(8)   NULL,
  title             VARCHAR(400) NOT NULL,
  detail            TEXT         NULL,
  severity          ENUM('Critical','High','Medium','Low') NOT NULL,
  status            ENUM('open','in_progress','evidence_under_review','closed','accepted') NOT NULL DEFAULT 'open',
  vendor_owner      VARCHAR(120) NULL,
  raised_by         VARCHAR(20)     NULL,
  raised_at         DATE         NOT NULL,
  due_at            DATE         NOT NULL,
  closed_at         DATE         NULL,
  closed_by         VARCHAR(20)     NULL,
  accept_reason     VARCHAR(600) NULL,
  accept_owner      VARCHAR(120) NULL,
  accept_expires    DATE         NULL,
  sla_paused_sec    INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (finding_id),
  UNIQUE KEY uq_find_ref (tenant_id, finding_ref),
  KEY ix_find_as (assessment_id, status),
  KEY ix_find_due (tenant_id, status, due_at),
  CONSTRAINT fk_find_tenant FOREIGN KEY (tenant_id)     REFERENCES tenant (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_find_as     FOREIGN KEY (assessment_id) REFERENCES assessment (assessment_id) ON DELETE CASCADE,
  CONSTRAINT ck_find_accept CHECK (status <> 'accepted' OR (accept_reason IS NOT NULL AND accept_expires IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contradiction_flag (
  flag_id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  assessment_id     BIGINT UNSIGNED NOT NULL,
  rule_id           BIGINT UNSIGNED NULL,
  refs_label        VARCHAR(60)  NOT NULL,
  message           VARCHAR(600) NOT NULL,
  state             ENUM('open','escalated','resolved') NOT NULL DEFAULT 'open',
  resolution_note   VARCHAR(600) NULL,
  resolved_by       VARCHAR(20)     NULL,
  detected_time     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (flag_id),
  KEY ix_cf_as (assessment_id, state),
  CONSTRAINT fk_cf_as FOREIGN KEY (assessment_id) REFERENCES assessment (assessment_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The issued artefact, stored with a hash so the file we sent is provable.
CREATE TABLE IF NOT EXISTS report_issue (
  report_issue_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  assessment_id     BIGINT UNSIGNED NULL,
  report_type       VARCHAR(40)  NOT NULL,
  doc_reference     VARCHAR(60)  NOT NULL,
  file_key          VARCHAR(400) NULL,
  sha256            CHAR(64)     NULL,
  recipients        VARCHAR(900) NOT NULL,
  cc_recipients     VARCHAR(900) NULL,
  subject           VARCHAR(300) NULL,
  issued_by         VARCHAR(20)     NOT NULL,
  issued_time       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  delivery_status   ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
  PRIMARY KEY (report_issue_id),
  UNIQUE KEY uq_ri_ref (doc_reference),
  KEY ix_ri_as (assessment_id, issued_time),
  CONSTRAINT fk_ri_tenant FOREIGN KEY (tenant_id)     REFERENCES tenant (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_ri_as     FOREIGN KEY (assessment_id) REFERENCES assessment (assessment_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
