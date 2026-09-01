-- Widen tprm_audit_event.entity_id so it can hold an employee id.
--
-- entity_id is polymorphic: it is read together with entity_type and means
-- "the id of the thing this event was about". Most of those ids are numeric
-- (assessment_id, tenant_id, finding_id), so the column was declared
-- BIGINT UNSIGNED. But identity lives in dadmin.employee, where emp_id is
-- VARCHAR(20) and looks like 'DZIND148'. Every audit row about a person -
-- auth.login, auth.mfa_enrolled, user.granted, user.revoked - therefore
-- failed to insert with:
--
--   ER_TRUNCATED_WRONG_VALUE_FOR_FIELD (1366)
--   Incorrect integer value: 'DZIND148' for column 'entity_id'
--
-- audit() deliberately swallows its own failures so a broken audit write can
-- never take down the action being audited, which is why this surfaced only
-- as a logged error and not as a failed sign-in. The cost was silent: none of
-- those events were ever recorded.
--
-- VARCHAR(40) holds both forms. entity_id is only ever selected or compared
-- with '=' (TPRM_Audit_server.js), never ordered or summed, so nothing depends
-- on it sorting numerically. Existing numeric rows convert in place.

ALTER TABLE tprm_audit_event
  MODIFY COLUMN entity_id VARCHAR(40) NULL;
