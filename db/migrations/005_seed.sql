-- =====================================================================
--  dTprm  Migration 005   Reference data + one working starter instrument
--  Safe to re-run: every insert is INSERT IGNORE or ON DUPLICATE KEY UPDATE.
-- =====================================================================

/* ---------------------------------------------------------- roles */
INSERT INTO tprm_role (role_code, role_name, rank_value, can_grant, is_client_role, description) VALUES
 ('PH','Practice Head',      100,1,0,'Owns the methodology, the roles and the programme'),
 ('EM','Engagement Manager',  80,1,0,'Runs client engagements, issues questionnaires, releases reports'),
 ('LA','Lead Assessor',       60,1,0,'Reviews and approves assessments'),
 ('AS','Assessor',            40,0,0,'Performs assessments, validates evidence, raises findings'),
 ('IA','Instrument Author',   40,0,0,'Maintains question sets and standards mapping'),
 ('CV','Client Viewer',       10,0,1,'Read only access to one client dashboard and issued reports')
ON DUPLICATE KEY UPDATE role_name=VALUES(role_name), rank_value=VALUES(rank_value), can_grant=VALUES(can_grant);

/* ---------------------------------------------------- permissions */
INSERT INTO tprm_permission (perm_key, label, category, sort_order) VALUES
 ('client.create','Create and configure clients','admin',1),
 ('methodology.edit','Edit methodology: weights, thresholds, SLA','admin',2),
 ('user.grant','Grant engagement roles','admin',3),
 ('instrument.author','Edit question banks and standards mapping','library',4),
 ('instrument.publish','Publish a new instrument version','library',5),
 ('vendor.manage','Add and edit third parties','delivery',6),
 ('assessment.assign','Assign assessments to assessors','delivery',7),
 ('assessment.perform','Perform tiering and control assessment','delivery',8),
 ('evidence.manage','Upload and validate evidence','delivery',9),
 ('finding.manage','Raise and edit findings','delivery',10),
 ('case.comment','Comment on a case','delivery',11),
 ('assessment.hold','Place a case on hold','delivery',12),
 ('assessment.approve','Approve an assessment','governance',13),
 ('triage.decide','Decide whether a supplier is in scope','governance',14),
 ('report.generate','Generate reports and exports','output',15),
 ('report.issue','Issue a report to the client','output',16),
 ('risk.accept','Accept a risk on the client behalf','governance',17),
 ('dashboard.view','View the client dashboard and reports','output',18),
 ('audit.read','Read the audit trail','governance',19)
ON DUPLICATE KEY UPDATE label=VALUES(label);

/* ------------------------------------------- the permission matrix */
INSERT IGNORE INTO tprm_role_permission (role_id, permission_id, granted)
SELECT r.role_id, p.permission_id, 1 FROM tprm_role r JOIN tprm_permission p
 WHERE r.role_code='PH';

INSERT IGNORE INTO tprm_role_permission (role_id, permission_id, granted)
SELECT r.role_id, p.permission_id, 1 FROM tprm_role r JOIN tprm_permission p
 WHERE r.role_code='EM' AND p.perm_key IN
 ('client.create','methodology.edit','user.grant','vendor.manage','assessment.assign',
  'assessment.perform','evidence.manage','finding.manage','case.comment','assessment.hold',
  'assessment.approve','triage.decide','report.generate','report.issue','risk.accept',
  'dashboard.view','audit.read');

INSERT IGNORE INTO tprm_role_permission (role_id, permission_id, granted)
SELECT r.role_id, p.permission_id, 1 FROM tprm_role r JOIN tprm_permission p
 WHERE r.role_code='LA' AND p.perm_key IN
 ('user.grant','vendor.manage','assessment.assign','assessment.perform','evidence.manage',
  'finding.manage','case.comment','assessment.hold','assessment.approve','triage.decide',
  'report.generate','dashboard.view','audit.read');

INSERT IGNORE INTO tprm_role_permission (role_id, permission_id, granted)
SELECT r.role_id, p.permission_id, 1 FROM tprm_role r JOIN tprm_permission p
 WHERE r.role_code='AS' AND p.perm_key IN
 ('assessment.perform','evidence.manage','finding.manage','case.comment','dashboard.view');

INSERT IGNORE INTO tprm_role_permission (role_id, permission_id, granted)
SELECT r.role_id, p.permission_id, 1 FROM tprm_role r JOIN tprm_permission p
 WHERE r.role_code='IA' AND p.perm_key IN ('instrument.author','instrument.publish','case.comment');

INSERT IGNORE INTO tprm_role_permission (role_id, permission_id, granted)
SELECT r.role_id, p.permission_id, 1 FROM tprm_role r JOIN tprm_permission p
 WHERE r.role_code='CV' AND p.perm_key IN ('dashboard.view');

/* --------------------------------------------- tiering dimensions */
INSERT INTO tiering_dimension (dimension_code, dimension_name, default_weight, note, sort_order) VALUES
 ('DATA','Data and information exposure',0.280,'What the third party can see, hold, move or lose',1),
 ('ACCESS','System and network access',   0.240,'Blast radius if the third party is compromised',2),
 ('CRIT','Business and operational criticality',0.240,'What stops, and how fast, if the third party fails',3),
 ('CHAIN','Supply chain and concentration',0.140,'Substitutability, subcontracting and nth party exposure',4),
 ('REG','Regulatory and legal exposure',  0.100,'Whose rules land on us when the third party gets it wrong',5)
ON DUPLICATE KEY UPDATE dimension_name=VALUES(dimension_name), default_weight=VALUES(default_weight);

/* ------------------------------------------------ control domains */
INSERT INTO control_domain (domain_code, domain_name, default_weight, sort_order) VALUES
 ('GOV','Governance, Policy and Accountability',8,1),
 ('RSK','Risk Management and Assurance',6,2),
 ('IAM','Identity and Access Management',13,3),
 ('DAT','Data Protection and Privacy',12,4),
 ('DEV','Secure Development and Change',8,5),
 ('INF','Infrastructure and Network Security',9,6),
 ('VUL','Vulnerability and Patch Management',9,7),
 ('LOG','Logging, Monitoring and Detection',8,8),
 ('IR','Incident Response and Notification',9,9),
 ('BCM','Business Continuity and Resilience',8,10),
 ('SCM','Supply Chain and Fourth Party',6,11),
 ('PHY','Physical and Environmental Security',4,12),
 ('HR','People Security and Awareness',5,13),
 ('EXIT','Exit, Termination and Return of Data',5,14)
ON DUPLICATE KEY UPDATE domain_name=VALUES(domain_name), default_weight=VALUES(default_weight);

/* ------------------------------------------------------- sectors */
INSERT INTO sector (sector_code, sector_name, sector_group, sort_order) VALUES
 ('OILGAS','Oil, Gas and Petroleum','Energy and Resources',1),
 ('POWER','Power and Utilities','Energy and Resources',2),
 ('WATER','Water and Wastewater','Energy and Resources',3),
 ('RENEW','Renewables and Storage','Energy and Resources',4),
 ('MINING','Mining and Metals','Energy and Resources',5),
 ('CHEM','Chemicals','Energy and Resources',6),
 ('AUTO','Automotive and Mobility','Industrial and Mobility',7),
 ('MFG','Manufacturing and OT','Industrial and Mobility',8),
 ('AERO','Aerospace and Defence','Industrial and Mobility',9),
 ('AVIA','Aviation and Airports','Industrial and Mobility',10),
 ('MARI','Maritime and Ports','Industrial and Mobility',11),
 ('RAIL','Rail and Mass Transit','Industrial and Mobility',12),
 ('LOGI','Logistics','Industrial and Mobility',13),
 ('CONST','Construction','Industrial and Mobility',14),
 ('AGRI','Agriculture and Agritech','Food and Land',15),
 ('FOOD','Food and Beverage','Food and Land',16),
 ('PHARMA','Pharmaceutical','Life Sciences and Health',17),
 ('HEALTH','Healthcare','Life Sciences and Health',18),
 ('MEDDEV','Medical Devices','Life Sciences and Health',19),
 ('BANK','Banking and Capital Markets','Financial Services',20),
 ('INSUR','Insurance','Financial Services',21),
 ('FINTECH','Payments and Fintech','Financial Services',22),
 ('ITSVC','IT and Software','Technology',23),
 ('CLOUD','Cloud and Data Centre','Technology',24),
 ('TELCO','Telecommunications','Technology',25),
 ('MEDIA','Media and Broadcast','Technology',26),
 ('AISVC','AI and Analytics','Technology',27),
 ('RETAIL','Retail and E-commerce','Consumer and Services',28),
 ('PROF','Legal and Professional','Consumer and Services',29),
 ('HOSP','Hospitality','Consumer and Services',30),
 ('REALEST','Real Estate','Consumer and Services',31),
 ('BPO','Business Process Outsourcing','Consumer and Services',32),
 ('GOVT','Government','Public and Universal',33),
 ('EDU','Education and Research','Public and Universal',34),
 ('GENERIC','Cross-Sector Baseline','Public and Universal',35)
ON DUPLICATE KEY UPDATE sector_name=VALUES(sector_name);

/* ----------------------------------------------------- standards */
INSERT INTO standard (standard_code, title, family, scope_note) VALUES
 ('ISO/IEC 27001:2022','Information Security Management Systems','Universal','Certifiable ISMS baseline'),
 ('ISO/IEC 27002:2022','Information Security Controls','Universal','Control implementation guidance'),
 ('ISO/IEC 27036','Supplier Relationship Information Security','Universal','The TPRM standard proper'),
 ('ISO 22301:2019','Business Continuity Management','Universal','Continuity and resilience'),
 ('NIST CSF 2.0','Cybersecurity Framework','Universal','Govern, Identify, Protect, Detect, Respond, Recover'),
 ('NIST SP 800-161r1','C-SCRM Practices','Universal','Cyber supply chain risk management'),
 ('CIS Controls v8.1','Critical Security Controls','Universal','Prioritised technical baseline'),
 ('GDPR','General Data Protection Regulation','Privacy','Processor obligations'),
 ('DPDP Act 2023','Digital Personal Data Protection Act','Privacy','India data fiduciary obligations'),
 ('ISO/IEC 27701','Privacy Information Management','Privacy','PIMS extension to 27001'),
 ('PCI DSS 4.0','Payment Card Industry Data Security','Regulatory','Cardholder data'),
 ('IEC 62443','Industrial Automation and Control Systems','OT','OT and control system security'),
 ('ISO/IEC 42001:2023','AI Management Systems','Emerging','AI governance'),
 ('SOC 2 Type II','Trust Services Criteria','Assurance','Independent control attestation')
ON DUPLICATE KEY UPDATE title=VALUES(title);

/* --------------------------------------------- classification rules */
INSERT IGNORE INTO classify_rule (sector_code, keyword, weight) VALUES
 ('CLOUD','cloud',12),('CLOUD','hosting',12),('CLOUD','data centre',12),('CLOUD','data center',12),
 ('CLOUD','colocation',10),('CLOUD','iaas',10),('CLOUD','aws',10),('CLOUD','azure',10),
 ('ITSVC','software',12),('ITSVC','application',10),('ITSVC','development',10),('ITSVC','sap',10),
 ('ITSVC','erp',10),('ITSVC','devops',10),('ITSVC','it services',12),
 ('TELCO','telecom',12),('TELCO','connectivity',10),('TELCO','fibre',10),('TELCO','mpls',10),
 ('MFG','scada',12),('MFG','plc',10),('MFG','automation',10),('MFG','control system',12),('MFG','dcs',10),
 ('OILGAS','drilling',12),('OILGAS','pipeline',12),('OILGAS','upstream',10),('OILGAS','refinery',12),
 ('PROF','legal',12),('PROF','audit',10),('PROF','advisory',10),('PROF','consulting',10),
 ('BPO','bpo',12),('BPO','contact centre',12),('BPO','call centre',12),('BPO','staffing',10),('BPO','payroll',10),
 ('LOGI','logistics',12),('LOGI','freight',12),('LOGI','shipping',10),('LOGI','warehouse',10),('LOGI','courier',10),
 ('CONST','construction',12),('CONST','civil works',12),('CONST','contracting',10),('CONST','epc',10),
 ('HOSP','catering',12),('HOSP','facilities',10),('HOSP','cleaning',10),('HOSP','housekeeping',10),
 ('HEALTH','clinic',12),('HEALTH','medical services',12),('HEALTH','hospital',12),
 ('AISVC','analytics',12),('AISVC','machine learning',12),('AISVC','artificial intelligence',12),
 ('FINTECH','payment gateway',12),('FINTECH','fintech',12),('FINTECH','upi',10);

/* -------------------------- the GENERIC v1 starter instrument ----- */
INSERT IGNORE INTO instrument_version
  (sector_code, version_no, status, frozen, change_note, published_time)
VALUES ('GENERIC', 1, 'published', 1, 'Seeded cross-sector baseline', NOW(3));

SET @iv := (SELECT instrument_version_id FROM instrument_version
             WHERE sector_code='GENERIC' AND version_no=1);

INSERT IGNORE INTO instrument_standard (instrument_version_id, standard_code) VALUES
 (@iv,'ISO/IEC 27001:2022'),(@iv,'ISO/IEC 27002:2022'),(@iv,'ISO/IEC 27036'),
 (@iv,'NIST CSF 2.0'),(@iv,'CIS Controls v8.1');

/* 12 tiering questions - answered by the CLIENT about the relationship */
INSERT IGNORE INTO question
 (instrument_version_id,q_type,q_ref,dimension_code,q_text,score_1_label,score_2_label,score_3_label,sort_order)
VALUES
 (@iv,'tiering','T01','DATA','What is the highest classification of our data the third party can access?','Public or unrestricted','Internal use only','Confidential, restricted or regulated',1),
 (@iv,'tiering','T02','DATA','Does the third party process personal data on our behalf?','No personal data','Limited personal data','Special category or large volume personal data',2),
 (@iv,'tiering','T03','DATA','Can the third party move or export our data outside our control?','No export possible','Export with approval','Routine export or offshore processing',3),
 (@iv,'tiering','T07','ACCESS','What level of account does the third party hold in our environment?','No account','Standard user account','Privileged or administrative account',4),
 (@iv,'tiering','T08','ACCESS','What is the network connectivity model between us and the third party?','No connectivity','Brokered or time bound access','Persistent site to site connectivity',5),
 (@iv,'tiering','T09','ACCESS','Can the third party change code or configuration in our production estate?','No change rights','Change with our approval','Direct build or deploy rights',6),
 (@iv,'tiering','T13','CRIT','What is the operational impact if the service fails without warning?','Minimal, absorbed locally','Degraded service within hours','Immediate stoppage of a core process',7),
 (@iv,'tiering','T15','CRIT','Could a failure affect the safety of people, plant or the environment?','No safety consequence','Indirect safety consequence','Direct safety consequence',8),
 (@iv,'tiering','T19','CHAIN','How substitutable is the third party within a reasonable transition window?','Several alternatives available','Alternatives exist with effort','Single source, no viable alternative',9),
 (@iv,'tiering','T20','CHAIN','Does the third party subcontract material parts of the service?','No subcontracting','Subcontracting declared and controlled','Material or undeclared subcontracting',10),
 (@iv,'tiering','T23','REG','Is the service subject to sector regulation or supervisory oversight?','No specific regulation','General regulation applies','Sector regulator with reporting duties',11),
 (@iv,'tiering','T25','REG','Would a failure trigger a mandatory external notification?','No notification duty','Notification at our discretion','Mandatory regulatory notification',12);

/* 30 control questions - answered by the SUPPLIER about itself */
INSERT IGNORE INTO question
 (instrument_version_id,q_type,q_ref,domain_code,q_text,evidence_required,standards_mapping,tier_applies,sort_order)
VALUES
 (@iv,'control','GOV-01','GOV','Is there a board approved information security policy, and when was it last reviewed?','Policy document with approval page and review date','ISO/IEC 27001:2022 A.5.1',3,1),
 (@iv,'control','GOV-02','GOV','Who is accountable for information security, and to whom do they report?','Organisation chart or role description','ISO/IEC 27001:2022 A.5.2',3,2),
 (@iv,'control','GOV-03','GOV','Do you hold ISO/IEC 27001 certification, and does the scope cover the service provided to us?','Certificate and Statement of Applicability','ISO/IEC 27001:2022 Clause 4.3',2,3),
 (@iv,'control','GOV-04','GOV','Has an independent third party audit of your controls been completed in the last 12 months?','SOC 2 Type II report or equivalent','SOC 2 Type II',1,4),
 (@iv,'control','RSK-01','RSK','Do you operate a documented risk assessment process, and when was it last run?','Risk register extract and methodology','ISO/IEC 27001:2022 Clause 6.1',2,5),
 (@iv,'control','IAM-01','IAM','How is access provisioned, modified and revoked, and within what timeframe on exit?','Joiner mover leaver procedure with the revocation SLA','ISO/IEC 27002:2022 5.16',3,6),
 (@iv,'control','IAM-02','IAM','Is multi factor authentication enforced for all remote and privileged access?','Conditional access or MFA policy export','CIS Controls v8.1 6.3',3,7),
 (@iv,'control','IAM-03','IAM','Are all privileged accounts individually attributable, with no shared credentials?','Privileged account listing, sanitised','ISO/IEC 27002:2022 8.2',2,8),
 (@iv,'control','IAM-04','IAM','How frequently are user access reviews performed, and who approves the outcome?','The last two completed access review records','ISO/IEC 27002:2022 5.18',2,9),
 (@iv,'control','DAT-01','DAT','What data of ours do you hold, process or transmit, and in which physical locations?','Data flow description naming every location','GDPR Art 30',3,10),
 (@iv,'control','DAT-02','DAT','Is our data encrypted at rest, and to what algorithm and key length?','Encryption standard or configuration evidence','ISO/IEC 27002:2022 8.24',3,11),
 (@iv,'control','DAT-03','DAT','Is our data encrypted in transit, and are legacy protocols disabled?','TLS configuration or scan output','ISO/IEC 27002:2022 8.24',3,12),
 (@iv,'control','DAT-06','DAT','What is your retention schedule for our data, and how is secure disposal evidenced?','Retention schedule and a destruction certificate','ISO/IEC 27002:2022 8.10',2,13),
 (@iv,'control','DEV-01','DEV','Is there a documented change management process covering emergency change?','Change procedure and a sample change record','ISO/IEC 27002:2022 8.32',2,14),
 (@iv,'control','INF-01','INF','How is the network segmented, and is our data separated from other clients?','Network or tenancy segregation description','ISO/IEC 27002:2022 8.22',2,15),
 (@iv,'control','VUL-01','VUL','What are your patching timeframes by severity, and are they met in practice?','Patch policy and the last compliance report','CIS Controls v8.1 7.3',3,16),
 (@iv,'control','VUL-02','VUL','When was the last independent penetration test, and were findings closed?','Test report summary and remediation evidence','ISO/IEC 27002:2022 8.8',1,17),
 (@iv,'control','LOG-01','LOG','What security events are logged, how long are logs retained, and who reviews them?','Logging standard and retention period','ISO/IEC 27002:2022 8.15',2,18),
 (@iv,'control','IR-01','IR','Is there a documented incident response plan, and when was it last exercised?','Plan and the last exercise report','ISO/IEC 27002:2022 5.24',2,19),
 (@iv,'control','IR-02','IR','Within what timeframe will you notify us of an incident affecting our data?','Contractual notification clause or policy','GDPR Art 33',3,20),
 (@iv,'control','BCM-02','BCM','What are the documented RTO and RPO for our service, and do they meet our requirement?','Documented RTO and RPO','ISO 22301:2019',2,21),
 (@iv,'control','BCM-03','BCM','When was continuity last tested, what was the scope, and were objectives met?','Test report showing scope and outcome','ISO 22301:2019 Clause 8.5',2,22),
 (@iv,'control','BCM-05','BCM','When was a restore from backup last tested, and was integrity verified?','Restore test record','CIS Controls v8.1 11.5',2,23),
 (@iv,'control','SCM-01','SCM','Do you subcontract any part of the service to us, and can you name every party?','Declaration naming all subcontractors','ISO/IEC 27036-2',3,24),
 (@iv,'control','SCM-03','SCM','Will you notify us before adding or changing a subcontractor serving our account?','Contractual clause and evidence of operation','GDPR Art 28(2)',2,25),
 (@iv,'control','PHY-01','PHY','How is physical access to facilities holding our data controlled and logged?','Physical access policy and a sample log','ISO/IEC 27002:2022 7.2',2,26),
 (@iv,'control','HR-01','HR','Are background checks performed on staff with access to our data?','Screening policy','ISO/IEC 27002:2022 6.1',2,27),
 (@iv,'control','HR-02','HR','Is security awareness training mandatory, and what is the completion rate?','Training records or completion report','ISO/IEC 27002:2022 6.3',3,28),
 (@iv,'control','EXIT-01','EXIT','On termination, how and when is our data returned or destroyed?','Exit procedure and destruction certificate template','ISO/IEC 27002:2022 5.10',2,29),
 (@iv,'control','EXIT-02','EXIT','Has an exit plan been tested, or is it a document only?','Exit test record if one exists','ISO/IEC 27036',1,30);

/* Contradiction rules - a claim contradicted elsewhere is escalated, never
   quietly scored. NULL instrument_version_id means: applies to every version. */
INSERT IGNORE INTO contradiction_rule (instrument_version_id, ref_a, positions_a, ref_b, positions_b, message) VALUES
 (NULL,'IAM-02','Compliant','IAM-03','Non-Compliant|Not Evidenced','MFA reported as fully enforced while privileged accounts are not individually attributable. Shared credentials cannot carry per user MFA.'),
 (NULL,'BCM-02','Compliant','BCM-03','Non-Compliant|Not Evidenced','RTO and RPO asserted as met while continuity has not been tested. An untested objective is an intention, not a capability.'),
 (NULL,'SCM-01','Compliant','DAT-01','Non-Compliant|Partially Compliant','No subcontracting declared while the data flow shows processing locations that are not accounted for.'),
 (NULL,'GOV-03','Compliant','GOV-04','Not Evidenced','Certification asserted but no independent audit evidence supplied. A certificate without a current report is a claim.'),
 (NULL,'DAT-02','Compliant','DAT-03','Non-Compliant','Data encrypted at rest but not in transit. Protection at one layer only leaves the exposure open.'),
 (NULL,'EXIT-01','Compliant','EXIT-02','Not Evidenced|Non-Compliant','Exit process asserted as documented but never tested. An untested exit plan is not a capability.');
