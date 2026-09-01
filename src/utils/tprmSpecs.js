// The build notes, lifted verbatim from Dolluz_TPRM_UI_Reference.jsx.
//
// This is documentation, not behaviour: what each screen is for, who may see
// it, and which API calls it makes. The header's "Show spec" button opens it
// beside whatever page you are on, so the intent behind a screen is readable
// from the screen itself rather than from a document nobody has open.
//
// Nothing here is a source of truth for the app. The permission matrix decides
// who sees what; these notes only describe it. Copied rather than paraphrased
// so a change in the reference shows up as a diff.

/* eslint-disable */

export const SPECS = {
  login: { t: 'Login', who: 'Public', notes: [
    'Left pane: banner carousel, 3 second rotation, pause on hover, dots clickable',
    'Banners come from the banner table where active = 1, ordered by sort_order',
    'Right pane: work email, password, remember device 14 days, forgot password',
    'Continue is disabled until both fields have content',
    'Failure never says which field was wrong. One message only',
    'Five failures locks the account for 15 minutes and writes an audit event',
    'Rate limited per IP and per email address'] },
  mfa: { t: 'Two factor', who: 'Any authenticated user', notes: [
    'Six digit TOTP from the authenticator app, 30 second window, one step of drift allowed',
    'Mandatory for every role including Client Viewer',
    'Use a recovery code link for a lost device, one time use, ten codes issued at enrolment',
    'Three failures returns the user to login and writes an audit event',
    'Remember device sets a signed cookie bound to the session family'] },
  forgot: { t: 'Forgot password', who: 'Public', notes: [
    'Always shows the same confirmation, whether or not the email exists',
    'Reset token is single use, 30 minutes, only the hash is stored',
    'Using the link revokes every active session for that user',
    'Setting a new password requires re-enrolling two factor if it was never completed'] },
  invite: { t: 'Accept invitation', who: 'Invited person', notes: [
    'Reached only from a single use emailed link, expiry 7 days',
    'Shows which client and which role is being granted, before acceptance',
    'Sets password, then forces two factor enrolment before any screen is reachable',
    'Acceptance writes user_tenant_role with granted_by set to the inviter',
    'An expired or already used link shows a request new invitation action'] },
  account: { t: 'My Account', who: 'Any authenticated user', notes: [
    'Profile: full name, job title, phone. Email is not editable, it is the identity',
    'Change password requires the current password',
    'Two factor: view enrolment status, regenerate recovery codes, reset device',
    'Active sessions listed with device, IP and last used. Sign out others available',
    'My roles is read only: client, role, granted by whom, granted when'] },
  banners: { t: 'Banner management', who: 'Practice Head, Engagement Manager', notes: [
    'Add, edit, reorder by drag, activate, deactivate, delete',
    'Deactivate is the primary action. Delete asks for confirmation and is audited',
    'At least one banner must remain active. The last one cannot be deactivated',
    'Live preview of the login pane as the fields are edited',
    'Headline max 160 characters, subline max 400'] },
  clients: { t: 'Clients', who: 'Practice Head, Engagement Manager', notes: [
    'Table of tenants with sector, third party count, open findings and status',
    'Onboard client is the only creation path',
    'Row click opens the client home with its onboarding checklist',
    'Lead Assessor, Assessor and Instrument Author never see this screen'] },
  ob1: { t: 'Onboard step 1, Identity', who: 'Practice Head, Engagement Manager', notes: [
    'Legal entity name is mandatory and must be unique across tenants',
    'Client code is 3 to 8 characters, uppercase, used in every document reference',
    'PRIMARY SECTOR is the client own industry. It drives the regulatory overlay',
    'It does NOT decide which questionnaire a vendor receives',
    'Secondary sectors are optional and additive to the overlay'] },
  ob2: { t: 'Onboard step 2, Operating context', who: 'Practice Head, Engagement Manager', notes: [
    'Operating regions and jurisdictions drive the applicable law set',
    'Regulators are prefilled from the primary sector and remain editable',
    'Scale band drives default tiering sensitivity, not the questions themselves',
    'Data types in scope drive the privacy overlay on every vendor assessment',
    'All of this is written to tenant.branding_json and the overlay resolver'] },
  ob3: { t: 'Onboard step 3, Methodology', who: 'Practice Head, Engagement Manager', notes: [
    'Weights prefill from the sector default and stay editable',
    'Dimension weights must total 1.00. Save is blocked until they do',
    'Tier 1 threshold must exceed Tier 2 threshold, enforced in the database',
    'SLA days per severity default to 14, 30, 60, 90',
    'Written to tenant_methodology. Every later change is audited'] },
  ob4: { t: 'Onboard step 4, Team and access', who: 'Practice Head, Engagement Manager', notes: [
    'Invite internal staff by email with a role, subject to the delegation ceiling',
    'The role list shows only roles at or below the inviter own rank',
    'Client Viewers are invited individually by named email, never a shared link',
    'Nothing is sent until the wizard is completed on step 5',
    'Each invitation is single use with a 7 day expiry'] },
  ob5: { t: 'Onboard step 5, Review and create', who: 'Practice Head, Engagement Manager', notes: [
    'Full read back of every field with an edit link to each step',
    'Create writes tenant, tenant_methodology, invitations and audit events in one transaction',
    'Failure rolls back everything. A half created client is not possible',
    'On success the client home opens with the onboarding checklist part complete'] },
  home: { t: 'Client home', who: 'Practice Head, Engagement Manager, Lead Assessor', notes: [
    'Onboarding checklist drives the next action until the first assessment is issued',
    'Add third parties is the next step, and it is where the VENDOR sector is chosen',
    'The vendor sector decides the instrument. The client sector decides the overlay',
    'Assign to an assessor becomes available once a third party exists'] },
  tp: { t: 'Add third party', who: 'Practice Head, Engagement Manager', notes: [
    'VENDOR SECTOR is chosen here and is independent of the client sector',
    'The preview panel shows exactly which instrument and how many questions will issue',
    'The regulatory overlay from the client is shown as read only context',
    'Bulk import from CSV is available with a preview and a per row error report',
    'Assign to assessor can be done here or later from the client home'] },
  issue: { t: 'Issue questionnaire', who: 'Assessor and above', notes: [
    'Generates an Excel pack containing only controls in scope for the computed tier',
    'Columns: reference, question, evidence required, position dropdown, notes',
    'Question reference is embedded and locked so the file cannot be mis-mapped',
    'Position column is a locked dropdown of the five allowed values',
    'Workbook is watermarked with client, vendor, instrument version and issue date'] },
  assess: { t: 'Control assessment', who: 'Assessor and above', notes: [
    'Imported vendor answers land as VENDOR ASSERTED where evidence is attached',
    'Where no evidence is attached the control drops to Not Evidenced automatically and scores 1',
    'Accept all evidenced in this area settles a whole control area in one audited action',
    'An override cannot be saved without a position change and 15 characters of justification',
    'The justification is stored, printed on the report and written to the audit trail',
    'Effectiveness and residual recalculate live as each control is settled',
    'The contradiction engine runs continuously and is escalated, never scored'] },
  gate: { t: 'Submit for review', who: 'Assessor', notes: [
    'Five checks. Submission is blocked until every one passes',
    'No control may remain vendor asserted at submission',
    'Open contradictions must be escalated or resolved first',
    'The reviewer must be assigned and must not be the assessor',
    'On submit the assessment locks for the assessor and enters the review queue'] },
  revw: { t: 'Reviewer workspace', who: 'Lead Assessor and above', notes: [
    'Read only view of every position, its evidence and any override justification',
    'Send back unlocks only the selected controls, everything else stays as recorded',
    'Approve freezes positions, scores, the calculation and finding severities',
    'Finding status stays open, because remediation continues after approval',
    'A change after approval requires a new assessment cycle, by design'] },
  findings: { t: 'Findings', who: 'Assessor and above', notes: [
    'Raised from any control recorded Non-Compliant, Not Evidenced or Partially Compliant',
    'Severity is derived from the position and the tier, never chosen by hand',
    'SLA days come from the client methodology: 14, 30, 60, 90 by default',
    'The clock pauses while the case is on hold, so a client side delay never counts against us',
    'Risk acceptance needs a written reason, a named owner and an expiry date',
    'Finding text freezes on approval, status keeps moving until closure'] },
  reports: { t: 'Reports', who: 'Engagement Manager and above to issue', notes: [
    'The assessment report is generated from live data, never assembled by hand',
    'Overrides and their justifications print on the report, they are not hidden',
    'A report can only be issued once the assessment is approved',
    'Issuance records the reference, the recipients and the SHA-256 of the file',
    'The register export is the file a client asks for at board time'] },
  qbank: { t: 'Question bank', who: 'All internal roles can read', notes: [
    '36 sector instruments, 652 questions, 85 standards mapped',
    'Tier applies decides scope: 3 for every supplier, 1 for Tier 1 only',
    'A published version is immutable. Editing needs a new draft version',
    'An assessment binds to one version for its whole life',
    'Only an Instrument Author can create a draft or publish'] },
  authoring: { t: 'Instrument authoring', who: 'Instrument Author', notes: [
    'A draft is created by copying the published version forward',
    'Questions and standards mapping are editable only while the version is a draft',
    'Publishing retires the previous published version in the same transaction',
    'Assessments already under way keep their bound version and are unaffected',
    'An Instrument Author cannot perform an assessment. Separation of duties'] },
  standards: { t: 'Standards', who: 'All internal roles', notes: [
    'Every control question carries its standards mapping',
    'A client can see which obligation each answer satisfies',
    'Sector instruments inherit the universal set plus their own regulatory family'] },
  methodology: { t: 'Methodology', who: 'Practice Head, Engagement Manager', notes: [
    'Held per client, so two clients can weight risk differently',
    'Dimension weights must total 1.00, enforced in the API and the database',
    'Tier 1 threshold must exceed Tier 2, enforced by a database trigger',
    'Saving rescores every supplier immediately, with no release',
    'Every change is written to the audit trail with actor and time'] },
  users: { t: 'Users and roles', who: 'Practice Head, Engagement Manager, Lead Assessor', notes: [
    'A role may only grant access at or below its own rank',
    'The role dropdown shows only what you may grant, and the API checks it again',
    'You cannot revoke your own access, or anyone above your rank',
    'Invitations are single use, 7 day expiry, only the hash is stored',
    'The permission matrix is data. Editing it needs permission.edit, held by the Practice Head'] },
  audit: { t: 'Audit trail', who: 'Lead Assessor and above', notes: [
    'Append only. The app database account has INSERT and SELECT here and nothing else',
    'Every override, descope and risk acceptance records its written reason',
    'Actor, entity, before and after, IP and user agent are all captured',
    'Scoped to one client, so an audit read cannot cross a tenant boundary'] },
  dash: { t: 'Dashboard', who: 'All roles, scoped to their access', notes: [
    'Tier 1 coverage is the number a programme is judged on',
    'Concentration shows where a single sector failure would hurt most',
    'Counts are live, never a stored snapshot',
    'A Client Viewer sees this for their own client only'] },
  tier: { t: 'Tiering, step 5', who: 'Assessor and above', notes: [
    'Only the client can answer these. They describe the relationship, not the vendor own controls',
    'Route A, tiering pack: one workbook, one row per vendor, locked dropdown columns',
    'Route B, facilitated session: assessor records live on a call with the client contact',
    'Both routes write the same data. Route B is recommended for likely Tier 1 vendors',
    'The computed tier updates as answers are recorded, and decides the control scope',
    'Progress shows answered against in scope, and names who the next action sits with'] },
  dist: { t: 'Issue and track, step 6', who: 'Assessor and above', notes: [
    'Both delivery routes remain available and can be mixed across one population',
    'Route A: a ZIP download is stamped with who took it and when, and those vendors read PDO to forward',
    'Route B: the tool emails each vendor its own workbook, from an editable template',
    'Every status change stamps a date, so progress is measured rather than estimated',
    'Next action with is derived from status: Dolluz to issue, PDO to forward, Vendor to respond, Dolluz to import',
    'Reminders can be sent per vendor or in bulk to everyone still outstanding'] },
  pop: { t: 'Vendor population', who: 'Assessor and above', notes: [
    'The funnel is the main path. The single add form exists only for one-off vendors',
    'Stages: received, classified, in scope, tiered, assessed. Each is a filter, not a queue',
    'Counts are live from the register, never a stored snapshot',
    'Every stage links to the screen that clears its backlog'] },
  tpl: { t: 'Intake template', who: 'Assessor and above', notes: [
    'Client exports their supplier master into this workbook, usually in one pass',
    'Their own spend category is requested because it already exists in procurement',
    'The Category column is left blank on purpose. Rules suggest it, an assessor confirms',
    'Data access and system access are required, because they drive the triage decision',
    'Template can be downloaded or emailed straight to the client contact'] },
  upl: { t: 'Upload vendor list', who: 'Assessor and above', notes: [
    'Accepts xlsx, xls and csv, up to 25,000 rows in one upload',
    'Column headings are detected and mapped. The client does not have to match our names',
    'Unmapped columns are shown as ignored, never silently dropped',
    'Nothing is written until the mapping and the row summary are confirmed',
    'Duplicates and incomplete rows are reported and downloadable as an exception file'] },
  cls: { t: 'Classification review', who: 'Assessor and above', notes: [
    'Keyword rules across vendor name, service line and the client own spend category',
    'Rules live in a table, so a new mapping needs no deployment',
    'Confidence under 90 is surfaced for a human. No match blocks progress',
    'Accept all suggestions is available, and is itself a single audited action',
    'Changing a category after issue requires a new assessment cycle'] },
  tri: { t: 'Triage, scope decision', who: 'Lead Assessor and above', notes: [
    'Default rule: no data, no system access, below materiality, therefore descoped',
    'The rule is editable per client and the version used is recorded on the decision',
    'Descoped vendors stay in the register with a reason and an annual re-check',
    'A descope decision is audited with actor and timestamp, so it is defensible'] },
  bulk: { t: 'Bulk issue', who: 'Assessor and above', notes: [
    'Vendors are grouped by instrument, one workbook each, one ZIP per group',
    'Each workbook carries a hidden identity sheet: client, vendor id, instrument, version',
    'Only controls in scope for that vendor computed tier are included',
    'Two delivery modes: client distributes the ZIP, or the tool emails each vendor',
    'Issue is recorded per vendor so response tracking starts immediately'] },
  zip: { t: 'Bulk import', who: 'Assessor and above', notes: [
    'Accepts the whole returned ZIP. Every workbook inside is read separately',
    'Each file is matched by the hidden identity sheet, never by file name',
    'A file with no identity sheet is skipped and reported, never guessed at',
    'Evidence archives inside the pack are attached to the matching controls',
    'Preview first. Nothing is written until the whole pack is confirmed'] },
  imp: { t: 'Import responses', who: 'Assessor and above', notes: [
    'Matches strictly on question reference, never on row order',
    'Preview shows will set, will change and cannot match, before anything is written',
    'Rows that do not match are reported with the reason and are never guessed at',
    'Import writes response and response_history, and a single audit event',
    'Evidence files are attached separately, one per control'] }
};

export const API_MAP = {
  login: [
    ['GET', '/api/public/banners', 'Banner carousel, no token needed'],
    ['POST', '/api/auth/login', 'Returns mfaToken and next: mfa or mfa_enrol'],
    ['POST', '/api/auth/forgot', 'Always the same response, no account discovery']
  ],
  mfa: [
    ['POST', '/api/auth/mfa/enrol/start', 'Returns the TOTP secret and otpauth URI'],
    ['POST', '/api/auth/mfa/enrol/confirm', 'Confirms, signs in, returns 10 recovery codes once'],
    ['POST', '/api/auth/mfa/verify', 'Accepts a TOTP code or a recovery code']
  ],
  forgot: [['POST', '/api/auth/forgot', 'Identical response whether or not the address exists'],
           ['POST', '/api/auth/reset', 'Single use, 30 minutes, revokes every session']],
  invite: [['GET', '/api/auth/invitation/:token', 'Shows client and role before acceptance'],
           ['POST', '/api/auth/invitation/:token/accept', 'Sets password, then forces MFA enrolment']],
  account: [
    ['GET', '/api/account', 'Profile, sessions, roles, recovery codes remaining'],
    ['PUT', '/api/account/profile', 'Email is not editable, it is the identity'],
    ['POST', '/api/account/password', 'Requires the current password'],
    ['POST', '/api/account/mfa/reset', 'Re-enrolment, requires the current password'],
    ['DELETE', '/api/account/sessions/:id', 'Sign out one device']
  ],
  banners: [
    ['GET', '/api/banners', 'All banners including inactive'],
    ['POST', '/api/banners', 'Requires banner.manage'],
    ['PUT', '/api/banners/:id', 'Blocks deactivating the last active banner'],
    ['DELETE', '/api/banners/:id', 'Same guard applies']
  ],
  clients: [['GET', '/api/tenants', 'Only clients you hold a role on'],
            ['POST', '/api/tenants', 'Requires client.create']],
  ob1: [['GET', '/api/sectors', 'The 36 instruments for the sector dropdown']],
  ob3: [['PUT', '/api/tenants/:id/methodology', 'Rejects WEIGHTS_UNBALANCED and THRESHOLDS_INVALID']],
  ob4: [['GET', '/api/roles', 'Filter client side to your own rank and below'],
        ['POST', '/api/tenants/:id/invitations', 'Server enforces ABOVE_YOUR_RANK']],
  ob5: [['POST', '/api/tenants', 'One transaction: tenant, methodology, invitations, audit']],
  home: [['GET', '/api/tenants/:id', 'Client with branding and methodology'],
         ['GET', '/api/tenants/:id/funnel', 'Live counts, never a stored snapshot']],
  pop: [['GET', '/api/tenants/:id/funnel', 'The five stage counts']],
  tpl: [['GET', '/api/tenants/:id/intake-template', 'Branded xlsx, returns a file'],
        ['POST', '/api/tenants/:id/intake-template/email', 'Queues it to a business unit']],
  upl: [['POST', '/api/tenants/:id/intake/preview', 'multipart. Writes nothing. Per row errors'],
        ['GET', '/api/intake/:batchId/errors.csv', 'The rejected rows with codes'],
        ['POST', '/api/intake/:batchId/commit', 'Creates third parties from valid rows only']],
  cls: [['GET', '/api/tenants/:id/classification', 'Suggested instrument and confidence'],
        ['PUT', '/api/third-parties/:id/sector', 'Blocked once an assessment is in flight']],
  tri: [['GET', '/api/tenants/:id/triage', 'Data and system access per supplier'],
        ['POST', '/api/third-parties/:id/triage', 'A descope returns REASON_REQUIRED without one']],
  tier: [['GET', '/api/tenants/:id/tiering-pack', 'One row per in scope supplier, returns a file'],
         ['POST', '/api/assessments/:id/tiering', 'Recomputes inherent and tier on every save']],
  dist: [['GET', '/api/tenants/:id/distribution', 'Per supplier state and owner'],
         ['POST', '/api/tenants/:id/issue', 'channel: zip returns a file, channel: email queues mail'],
         ['POST', '/api/assessments/:id/remind', 'Stamps reminded_at']],
  zip: [['POST', '/api/import/preview', 'A workbook or a whole ZIP. Writes nothing'],
        ['POST', '/api/import/commit', 'Applies the Option C model']],
  imp: [['POST', '/api/import/preview', 'Preview first, always'],
        ['POST', '/api/import/commit', 'Matched on question reference, never row order']],
  bulk: [['POST', '/api/tenants/:id/issue', 'Grouped by instrument, one workbook per supplier']],
  assess: [
    ['GET', '/api/assessments/:id', 'Questions, responses, flags, findings in one payload'],
    ['POST', '/api/assessments/:id/responses', 'override: true needs 15+ characters'],
    ['POST', '/api/assessments/:id/accept-area', 'Option C bulk accept, evidenced rows only'],
    ['POST', '/api/assessments/:id/raise-findings', 'Severity from position and tier'],
    ['POST', '/api/assessments/:id/hold', 'Pauses SLA clocks on open findings']
  ],
  gate: [['GET', '/api/assessments/:id/submit-check', 'The five checks, each with pass and detail'],
         ['POST', '/api/assessments/:id/submit', 'Returns GATE_FAILED with the failing checks']],
  revw: [['POST', '/api/assessments/:id/send-back', 'Unlocks only the selected controls'],
         ['POST', '/api/assessments/:id/approve', 'Freezes scores. SOD_VIOLATION if you are the assessor']],
  findings: [['GET', '/api/tenants/:id/findings', 'Includes age, days remaining and breached'],
             ['PUT', '/api/findings/:id', 'Risk acceptance needs reason, owner and expiry']],
  reports: [['GET', '/api/assessments/:id/report.pdf', 'Branded PDF, returns a file'],
            ['GET', '/api/tenants/:id/register.xlsx', 'The whole register, returns a file'],
            ['POST', '/api/assessments/:id/issue', 'Only after approval. Logs recipients and hash'],
            ['GET', '/api/tenants/:id/issuances', 'Issuance history']],
  qbank: [['GET', '/api/sectors', 'The 36 instruments'],
          ['GET', '/api/instruments/:sector', 'Questions, standards and counts for the published version'],
          ['PUT', '/api/questions/:id', 'Draft versions only, published are immutable']],
  standards: [['GET', '/api/standards', 'The 85 standards with sector counts']],
  authoring: [['POST', '/api/instruments/:sector/draft', 'Copies the published set forward'],
              ['POST', '/api/instruments/version/:id/publish', 'Retires the previous published version']],
  methodology: [['GET', '/api/tenants/:id', 'Methodology comes back on the client payload'],
                ['PUT', '/api/tenants/:id/methodology', 'Weights must total 1.00']],
  users: [['GET', '/api/tenants/:id/users', 'Members of this client only'],
          ['GET', '/api/roles', 'For the invite dropdown'],
          ['POST', '/api/tenants/:id/invitations', 'Subject to the delegation ceiling'],
          ['DELETE', '/api/tenants/:id/users/:userId', 'Cannot revoke yourself or a higher rank']],
  audit: [['GET', '/api/tenants/:id/audit?limit=200', 'Append only, newest first']],
  dash: [['GET', '/api/tenants/:id/dashboard', 'KPI, tier split, findings, concentration']]
};
