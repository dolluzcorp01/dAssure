-- =====================================================================
--  dAssure  Migration 009   Align the standards catalogue with the
--                         Dolluz TPRM UI reference
--
--  Four standards the reference lists were missing, and two titles read
--  differently there. Nothing is removed: DPDP Act 2023 is ours and stays,
--  and dropping a standard that questions already map to would take their
--  mapping with it.
--  Safe to re-run.
-- =====================================================================

INSERT INTO standard (standard_code, title, family, scope_note) VALUES
 ('DORA','Digital Operational Resilience Act','Regulatory','EU financial sector ICT third party risk'),
 ('API 1164','Pipeline Control Systems Cybersecurity','OT','Pipeline SCADA and control systems'),
 ('ISO 21434','Road Vehicles Cybersecurity Engineering','Automotive','Automotive supply chain security'),
 ('21 CFR Part 11','Electronic Records and Signatures','Life Sciences','FDA electronic records integrity')
ON DUPLICATE KEY UPDATE title=VALUES(title), family=VALUES(family), scope_note=VALUES(scope_note);

-- The reference spells these two out rather than abbreviating them.
UPDATE standard SET title='Cyber Supply Chain Risk Management' WHERE standard_code='NIST SP 800-161r1';
UPDATE standard SET title='Critical Security Controls'         WHERE standard_code='CIS Controls v8.1';
