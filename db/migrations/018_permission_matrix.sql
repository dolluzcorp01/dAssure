-- =====================================================================
--  dAssure  Migration 018   The permission matrix as the practice defines it
--
--  The matrix seeded in 005 was my reading of the six roles. The signed off
--  version differs in four ways, and this brings the database to it. It runs
--  after 005 on every replay, so 005 is left as it was and this is the layer
--  that decides.
--
--  1. A Lead Assessor no longer grants roles, and no longer edits the third
--     party register.
--
--     Both are engagement management, not review. A reviewer who can add the
--     supplier, decide it is in scope, assign the assessor and then approve
--     the result holds every step of the chain their approval is supposed to
--     be independent of. The Engagement Manager owns the register and the
--     roster; the Lead Assessor owns the judgement.
--
--  2. Overriding a supplier's answer becomes its own capability.
--
--     It was folded into assessment.perform, so anyone who could record a
--     position could also overturn one. Those are different acts: recording a
--     position is reading what the supplier sent, overriding is substituting
--     your own judgement for it against written justification, and the second
--     is what an auditor reads first. Held by PH, EM and LA - not by the
--     Assessor whose own work it exists to correct.
--
--  3. Three labels take the practice's wording.
--
--  4. sort_order is restated so the matrix on screen reads down in the same
--     order as the printed sheet, with the permissions that sheet does not
--     list following after it rather than interleaved through it.
-- =====================================================================

USE dtprm;

/* ------------------------------------------------- 3. the wording */
UPDATE tprm_permission SET label = 'Create users and grant permissions'
 WHERE perm_key = 'user.grant';
UPDATE tprm_permission SET label = 'Accept a risk on the client''s behalf'
 WHERE perm_key = 'risk.accept';
UPDATE tprm_permission SET label = 'View own client dashboard and reports'
 WHERE perm_key = 'dashboard.view';

/* --------------------------------------- 2. the override capability */
INSERT INTO tprm_permission (perm_key, label, category, sort_order) VALUES
 ('response.override','Override a score, with justification','delivery',11)
ON DUPLICATE KEY UPDATE label = VALUES(label), category = VALUES(category);

INSERT IGNORE INTO tprm_role_permission (role_id, permission_id, granted)
SELECT r.role_id, p.permission_id, 1
  FROM tprm_role r JOIN tprm_permission p
 WHERE r.role_code IN ('PH','EM','LA') AND p.perm_key = 'response.override';

/* ------------------------------------- 1. what a Lead Assessor drops
   Written as a delete rather than granted=0 because the row's absence is what
   every other role's absence looks like, and two ways of saying "no" in one
   table is how a matrix starts disagreeing with itself. */
DELETE rp FROM tprm_role_permission rp
  JOIN tprm_role r ON r.role_id = rp.role_id
  JOIN tprm_permission p ON p.permission_id = rp.permission_id
 WHERE r.role_code = 'LA' AND p.perm_key IN ('user.grant','vendor.manage');

/* tprm_role.can_grant is the same fact said a second way - it is what the role
   list prints in its "Can grant" column. Left at 1 it would have the screen
   claiming a Lead Assessor grants roles on the very page where they no longer
   can. */
UPDATE tprm_role SET can_grant = 0 WHERE role_code = 'LA';

/* ----------------------------------------------------- 4. the order
   Absolute values by key, so a replay lands on the same order rather than
   shifting it further each time. */
UPDATE tprm_permission SET sort_order = CASE perm_key
    /* the sheet, in the sheet's order */
    WHEN 'client.create'      THEN 1
    WHEN 'methodology.edit'   THEN 2
    WHEN 'user.grant'         THEN 3
    WHEN 'instrument.author'  THEN 4
    WHEN 'instrument.publish' THEN 5
    WHEN 'vendor.manage'      THEN 6
    WHEN 'assessment.assign'  THEN 7
    WHEN 'assessment.perform' THEN 8
    WHEN 'evidence.manage'    THEN 9
    WHEN 'finding.manage'     THEN 10
    WHEN 'response.override'  THEN 11
    WHEN 'assessment.approve' THEN 12
    WHEN 'report.issue'       THEN 13
    WHEN 'risk.accept'        THEN 14
    WHEN 'dashboard.view'     THEN 15
    WHEN 'audit.read'         THEN 16
    /* real permissions the sheet does not list */
    WHEN 'triage.decide'      THEN 17
    WHEN 'report.generate'    THEN 18
    WHEN 'case.comment'       THEN 19
    WHEN 'assessment.hold'    THEN 20
    WHEN 'banner.manage'      THEN 21
    ELSE sort_order END;
