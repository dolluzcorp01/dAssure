-- =====================================================================
--  dTprm  Migration 001   Clients, engagement roles, methodology, audit
--  Database: tprm      Engine: InnoDB / utf8mb4
--
--  Identity is NOT duplicated here. Dolluz staff live in dadmin.employee
--  and sign in with the same credentials they use for every other dApp.
--  This file only records WHICH client each employee may work on and in
--  WHAT capacity.
-- =====================================================================

CREATE TABLE IF NOT EXISTS tenant (
  tenant_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_code       VARCHAR(24)  NOT NULL,
  tenant_name       VARCHAR(160) NOT NULL,
  default_sector    VARCHAR(24)  NULL,
  status            ENUM('active','suspended','closed') NOT NULL DEFAULT 'active',
  created_by        VARCHAR(20)     NULL,
  created_time      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  edited_by         VARCHAR(20)     NULL,
  edited_time       DATETIME(3)  NULL,
  deleted_time      DATETIME(3)  NULL,
  PRIMARY KEY (tenant_id),
  UNIQUE KEY uq_tenant_code (tenant_code),
  KEY ix_tenant_status (status, deleted_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Engagement roles. rank_value drives the delegation ceiling: you may only
-- grant a role at or below your own rank.
CREATE TABLE IF NOT EXISTS tprm_role (
  role_id           SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_code         VARCHAR(8)   NOT NULL,
  role_name         VARCHAR(80)  NOT NULL,
  rank_value        SMALLINT UNSIGNED NOT NULL,
  can_grant         TINYINT(1)   NOT NULL DEFAULT 0,
  is_client_role    TINYINT(1)   NOT NULL DEFAULT 0,
  description       VARCHAR(400) NULL,
  PRIMARY KEY (role_id),
  UNIQUE KEY uq_role_code (role_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- emp_id references dadmin.employee.emp_id, which is VARCHAR(20) holding
-- codes like 'DZIND148' - not an integer. MySQL cannot foreign-key across
-- databases, so this stays an unconstrained VARCHAR by design.
CREATE TABLE IF NOT EXISTS tprm_user_tenant_role (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  emp_id            VARCHAR(20)     NOT NULL,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  role_id           SMALLINT UNSIGNED NOT NULL,
  granted_by        VARCHAR(20)     NULL,
  granted_time      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_by        VARCHAR(20)     NULL,
  revoked_time      DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_utr (emp_id, tenant_id, role_id),
  KEY ix_utr_tenant (tenant_id, role_id),
  KEY ix_utr_live (emp_id, revoked_time),
  CONSTRAINT fk_utr_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_utr_role   FOREIGN KEY (role_id)   REFERENCES tprm_role (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tprm_permission (
  permission_id     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  perm_key          VARCHAR(64)  NOT NULL,
  label             VARCHAR(180) NOT NULL,
  category          VARCHAR(40)  NOT NULL,
  sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (permission_id),
  UNIQUE KEY uq_perm_key (perm_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tprm_role_permission (
  role_id           SMALLINT UNSIGNED NOT NULL,
  permission_id     SMALLINT UNSIGNED NOT NULL,
  granted           TINYINT(1)   NOT NULL DEFAULT 1,
  edited_by         VARCHAR(20)     NULL,
  edited_time       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_trp_role FOREIGN KEY (role_id)       REFERENCES tprm_role (role_id) ON DELETE CASCADE,
  CONSTRAINT fk_trp_perm FOREIGN KEY (permission_id) REFERENCES tprm_permission (permission_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-client methodology. No row means fall back to the platform defaults in
-- src/backend_routes/utils/tprm_scoring.js
CREATE TABLE IF NOT EXISTS tenant_methodology (
  tenant_id         BIGINT UNSIGNED NOT NULL,
  dimension_weights JSON         NOT NULL,
  domain_weights    JSON         NOT NULL,
  tier1_threshold   DECIMAL(4,2) NOT NULL DEFAULT 2.30,
  tier2_threshold   DECIMAL(4,2) NOT NULL DEFAULT 1.60,
  sla_json          JSON         NOT NULL,
  edited_by         VARCHAR(20)     NULL,
  edited_time       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_tm_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id) ON DELETE CASCADE,
  CONSTRAINT ck_tm_thresholds CHECK (tier1_threshold > tier2_threshold)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only. Grant the app DB user INSERT + SELECT only on this table.
CREATE TABLE IF NOT EXISTS tprm_audit_event (
  audit_id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_emp_id      VARCHAR(20)     NULL,
  actor_email       VARCHAR(190) NULL,
  tenant_id         BIGINT UNSIGNED NULL,
  action            VARCHAR(60)  NOT NULL,
  entity_type       VARCHAR(40)  NOT NULL,
  entity_id         BIGINT UNSIGNED NULL,
  before_json       JSON         NULL,
  after_json        JSON         NULL,
  reason            VARCHAR(600) NULL,
  ip_addr           VARCHAR(45)  NULL,
  user_agent        VARCHAR(300) NULL,
  occurred_time     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (audit_id),
  KEY ix_audit_entity (entity_type, entity_id, occurred_time),
  KEY ix_audit_tenant (tenant_id, occurred_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
