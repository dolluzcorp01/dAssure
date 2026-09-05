-- =====================================================================
--  dAssure  Migration 021   The capability that makes the matrix editable
--
--  The Users and Roles screen has always said the matrix is "editable by
--  Practice Head" and that "permissions are data, not hard-coded". Half of
--  that was true: they are data. But nothing in the application ever wrote
--  tprm_role_permission, so changing the matrix meant a migration and a
--  deployment, and the screen was promising something the API could not do.
--
--  This adds the capability the write route is gated on. Practice Head
--  only. An Engagement Manager runs engagements; deciding what an
--  Engagement Manager may do is not itself an engagement task.
-- =====================================================================

USE dtprm;

INSERT INTO tprm_permission (perm_key, label, category, sort_order) VALUES
 ('permission.edit', 'Edit the permission matrix', 'admin', 22)
ON DUPLICATE KEY UPDATE label = VALUES(label), category = VALUES(category),
                        sort_order = VALUES(sort_order);

/* Practice Head alone. Deliberately not granted to EM: the matrix decides
   what every other role may do, including the roles that grant access, so
   it sits with the one role that owns the methodology and the programme. */
INSERT IGNORE INTO tprm_role_permission (role_id, permission_id, granted)
SELECT r.role_id, p.permission_id, 1
  FROM tprm_role r JOIN tprm_permission p
 WHERE r.role_code = 'PH' AND p.perm_key = 'permission.edit';
