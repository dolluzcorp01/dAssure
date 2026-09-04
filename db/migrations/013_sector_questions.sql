-- =====================================================================
--  dAssure  Migration 013   Sector questions, on top of the baseline
--
--  012 gave every sector the same 42 questions, which is what the original
--  toolkit does. That leaves one path untestable: the case where instruments
--  genuinely diverge. Every supplier gets an identical questionnaire, so a bug
--  that only appears when two instruments differ - a report naming the wrong
--  question set, a count taken from the wrong version, an import matching on
--  a q_ref that exists in one instrument and not another - cannot surface.
--
--  So seven instruments get questions the others do not have. They are real
--  questions mapped to real standards, not filler: IEC 62443 and API 1164 for
--  the OT sectors, DORA for banking, PCI DSS for payments, 21 CFR Part 11 for
--  healthcare, tenancy isolation for cloud, ISO/IEC 42001 for AI. That way the
--  divergence being tested looks like the divergence that will actually happen.
--
--  Deliberately NOT applied to every sector. A register where some instruments
--  differ and most do not is the harder case, and the one you will really have.
--
--  is_core = 0 marks these as sector additions rather than baseline. Only the
--  tiering pack reads is_core, and only for tiering questions, so a control
--  question marked non-core still reaches the supplier exactly as any other.
--
--  sort_order starts at 1000 so these sit after the 30 baseline controls
--  without having to read the current maximum back out of the table.
--
--  Idempotent: each row is guarded on its own (version, q_ref) not existing,
--  so re-running adds nothing. db/migrate.js replays every file each pass.
-- =====================================================================

USE dtprm;

DROP TEMPORARY TABLE IF EXISTS tmp_sector_q;
CREATE TEMPORARY TABLE tmp_sector_q (
  sector_code       VARCHAR(24)  NOT NULL,
  q_ref             VARCHAR(16)  NOT NULL,
  domain_code       VARCHAR(8)   NOT NULL,
  q_text            VARCHAR(600) NOT NULL,
  evidence_required VARCHAR(400) NULL,
  standards_mapping VARCHAR(400) NULL,
  tier_applies      TINYINT UNSIGNED NOT NULL,
  ord               SMALLINT UNSIGNED NOT NULL
);

INSERT INTO tmp_sector_q
  (sector_code, q_ref, domain_code, q_text, evidence_required, standards_mapping, tier_applies, ord)
VALUES
-- ---- Oil, Gas and Petroleum -------------------------------------------
 ('OILGAS','OT-01','INF','Is the process control network segmented from the corporate network, and is the boundary enforced by a device under our control?','Segmentation diagram and the firewall ruleset for the IDMZ','IEC 62443-3-3 SR 5.1',2,10),
 ('OILGAS','OT-02','IAM','How is remote vendor access to control systems brokered, and is every session recorded?','Jump host configuration and one sample session recording','IEC 62443-2-4',1,20),
 ('OILGAS','OT-03','IR','Does your incident response plan cover a safety instrumented system trip caused by a cyber event?','The plan section, and the last OT exercise report','API 1164',1,30),
-- ---- Manufacturing and OT ---------------------------------------------
 ('MFG','OT-01','INF','Is the plant network segmented from the corporate network, and who holds the rules on that boundary?','Segmentation diagram and the current ruleset','IEC 62443-3-3 SR 5.1',2,10),
 ('MFG','OT-04','VUL','How are patches applied to plant equipment that cannot be taken offline during production?','Patch policy for OT assets and the compensating controls list','IEC 62443-2-3',2,20),
-- ---- Banking and Capital Markets --------------------------------------
 ('BANK','DORA-01','BCM','Can you meet our documented recovery time objective under a severe but plausible disruption, and has that been tested rather than modelled?','Scenario test report naming the RTO actually achieved','DORA Art 11',1,10),
 ('BANK','DORA-02','SCM','Do you maintain a register of your own ICT third parties supporting this service, and will you share it on request?','Extract from the subcontractor register','DORA Art 29',1,20),
-- ---- Payments and Fintech ---------------------------------------------
 ('FINTECH','PCI-01','DAT','Is cardholder data stored, processed or transmitted on our behalf, and what is your current PCI DSS validation status?','Current Attestation of Compliance','PCI DSS 4.0',1,10),
 ('FINTECH','PCI-02','DAT','Is the primary account number rendered unreadable everywhere it is stored?','Tokenisation or encryption design note','PCI DSS 4.0 Req 3.5',1,20),
-- ---- Healthcare --------------------------------------------------------
 ('HEALTH','HLT-01','DAT','Is patient identifiable data segregated from other clients'' data, and how is that segregation enforced?','Tenancy or database segregation description','ISO/IEC 27701',1,10),
 ('HEALTH','HLT-02','GOV','Are electronic records and signatures for this service managed under a validated system?','Validation summary report','21 CFR Part 11',2,20),
-- ---- Cloud and Data Centre --------------------------------------------
 ('CLOUD','CLD-01','INF','How is our tenant isolated from others sharing the same infrastructure?','Multi-tenancy isolation design note','SOC 2 Type II',1,10),
 ('CLOUD','CLD-02','DAT','In which regions is our data stored and processed, and can it be pinned to a region we choose?','Region configuration and the data residency statement','GDPR Art 44',1,20),
-- ---- AI and Analytics --------------------------------------------------
 ('AISVC','AI-01','GOV','Do you operate a management system covering the AI components of this service?','ISO/IEC 42001 certificate, or the Statement of Applicability','ISO/IEC 42001:2023',2,10),
 ('AISVC','AI-02','DAT','Is our data used to train or fine tune models that serve any other client?','The contractual clause and your training data policy','ISO/IEC 42001:2023',1,20);

/* Added to the published instrument for each named sector. A sector with no
   published version simply matches nothing - it is not an error, it means
   somebody is still authoring it and this has no business writing into it. */
INSERT INTO question
    (instrument_version_id, q_type, q_ref, is_core, domain_code, q_text,
     evidence_required, standards_mapping, tier_applies, sort_order)
SELECT iv.instrument_version_id, 'control', t.q_ref, 0, t.domain_code, t.q_text,
       t.evidence_required, t.standards_mapping, t.tier_applies, 1000 + t.ord
  FROM tmp_sector_q t
  JOIN instrument_version iv
    ON iv.sector_code = t.sector_code AND iv.status = 'published'
 WHERE NOT EXISTS (SELECT 1 FROM question q2
                    WHERE q2.instrument_version_id = iv.instrument_version_id
                      AND q2.q_ref = t.q_ref);

/* The standards these questions cite, declared at instrument level too, so the
   Standards screen counts them the same way it counts the baseline's. */
INSERT IGNORE INTO instrument_standard (instrument_version_id, standard_code)
SELECT iv.instrument_version_id, s.standard_code
  FROM tmp_sector_q t
  JOIN instrument_version iv
    ON iv.sector_code = t.sector_code AND iv.status = 'published'
  JOIN standard s
    ON t.standards_mapping LIKE CONCAT(s.standard_code, '%')
 WHERE s.active = 1;

DROP TEMPORARY TABLE IF EXISTS tmp_sector_q;
