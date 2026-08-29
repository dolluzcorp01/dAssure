# dTprm — Third Party Risk Management Toolkit

Internal Dolluz Corp tool for assessing our clients' suppliers. Staff-only:
there is no public side, and suppliers never get an account. They receive an
Excel workbook by email and return it the same way.

Follows the dAdmin conventions throughout — `config/db.js`, `server.js`
mounting `src/backend_routes/*_server.js`, `src/utils/api.js`, page component
plus matching `.css`.

---

## Installing into a fresh project

```bash
npx create-react-app dtprm
cd dtprm
# unzip this pack here, overwriting package.json, public/ and src/
npm install
```

The pack replaces `package.json`, `public/` and `src/`, and adds `config/`,
`db/`, `server.js` and `.env.example`. Nothing from create-react-app is needed
except `node_modules`.

---

## Configuration

Copy `.env.example` to `.env` and fill it in.

| Key | Notes |
|---|---|
| `TPRM_PORT` | `4009`. Not used by another dApp (4001 dAssist, 4002 dAdmin, 4003 dTime, 4004 dBug, 4007 dSlip) |
| `DB_HOST` / `DB_USER` / `DB_PASSWORD` | Same MySQL server as the other dApps |
| `DB_NAME` | `dtprm` |
| `JWT_SECRET` | **Must be byte-identical to dAdmin's**, or nobody can sign in |
| `TPRM_MAIL_DRIVER` | `outbox` queues mail in the database without sending. `sendgrid` actually delivers |
| `SENDGRID_API_KEY` | Only needed when the driver is `sendgrid` |
| `TPRM_STORAGE_DIR` | Where evidence and generated workbooks land. Defaults to `./TPRM_file_uploads` |

---

## Database

```bash
node db/migrate.js
```

Creates the `dtprm` database and applies all five migrations in order. Safe to
re-run — every statement is `IF NOT EXISTS`, `INSERT IGNORE` or
`ON DUPLICATE KEY UPDATE`.

`dTprm` reads `dadmin.employee` for sign-in and owns everything in `tprm`.
There is no cross-database foreign key on `emp_id` because MySQL does not
support them; the column is a plain `BIGINT` by design.

### Recommended grants

The audit trail is append-only by intent. Enforce it at the database level so
a bug in the application cannot rewrite history:

```sql
CREATE USER 'dtprm'@'localhost' IDENTIFIED BY '<password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON tprm.* TO 'dtprm'@'localhost';
REVOKE UPDATE, DELETE ON tprm.tprm_audit_event FROM 'dtprm'@'localhost';
GRANT SELECT ON dadmin.employee TO 'dtprm'@'localhost';
FLUSH PRIVILEGES;
```

---

## First run

Sign-in requires an **engagement grant**, not just a valid dAdmin account. With
no grant on any client, login returns `NO_ENGAGEMENT`. Bootstrap yourself:

```sql
-- 1. Create the first client
INSERT INTO tenant (tenant_code, tenant_name, default_sector)
VALUES ('PDO', 'Petroleum Development Oman', 'OILGAS');

-- 2. Make yourself Practice Head on it.
--    Find your emp_id with:
--    SELECT emp_id, CONCAT_WS(' ', emp_first_name, emp_last_name) AS emp_name
--      FROM dadmin.employee;
--    emp_id is a code like 'DZIND148', so it must be quoted.
INSERT INTO tprm_user_tenant_role (emp_id, tenant_id, role_id)
SELECT '<your_emp_id>', t.tenant_id, r.role_id
  FROM tenant t, tprm_role r
 WHERE t.tenant_code = 'PDO' AND r.role_code = 'PH';

-- 3. Seed that client's methodology from the platform defaults
INSERT INTO tenant_methodology
  (tenant_id, dimension_weights, domain_weights, tier1_threshold, tier2_threshold, sla_json)
SELECT t.tenant_id,
       '{"DATA":0.28,"ACCESS":0.24,"CRIT":0.24,"CHAIN":0.14,"REG":0.10}',
       (SELECT JSON_OBJECTAGG(domain_code, default_weight) FROM control_domain),
       2.30, 1.60,
       '{"Critical":14,"High":30,"Medium":60,"Low":90}'
  FROM tenant t WHERE t.tenant_code = 'PDO';
```

Every client created through the UI after this gets steps 2 and 3 automatically.

Then:

```bash
npm run server     # API on 4009
npm start          # React dev server on 3000
```

Check `http://localhost:4009/api/tprm/health` — it reports the database state
too, so a failure is diagnosable from one call.

---

## The workflow

Nine stages, in order. The Vendor Population page walks the first six.

1. **Onboard client** — name, code, their own sector
2. **Intake** — send the client a template, they return their supplier master
3. **Classify** — rules suggest a questionnaire per supplier, sorted
   worst-confidence first so you review only the uncertain ones
4. **Triage** — in scope or out. A descope needs a written reason
5. **Tiering** — the client answers 12 relationship questions per supplier.
   Produces an inherent score and Tier 1/2/3
6. **Distribution** — one ZIP for the client to forward, or direct email per
   supplier with the workbook attached
7. **Import** — drop the returned workbooks (or a ZIP with evidence) back in
8. **Assess** — accept or override each position, attach evidence, raise findings
9. **Review and issue** — a different person approves, then the PDF is issued

### Who answers what

The **client** answers about the *relationship* — what can this supplier reach
inside us. The **supplier** answers about *itself* — what controls do you run.
Neither can answer the other's questions, which is why the tiering pack and the
control questionnaire are separate files.

---

## Rules that are enforced, not documented

| Rule | Where |
|---|---|
| An assertion with no evidence is **Not Evidenced**, scoring 1 | Applied at import in `TPRM_Distribution_server.js`. Blank answers get the same drop — silence is not a pass |
| The reviewer can never be the assessor | Checked in the API *and* by two `BEFORE INSERT`/`BEFORE UPDATE` triggers on `assessment` |
| A published questionnaire version is immutable | Editing a question on a non-draft version returns `VERSION_FROZEN`. Assessments stay bound to the version they started on |
| An override needs 15+ characters of justification | `ck_resp_ovr` check constraint plus the API |
| A descope needs a written reason | API, minimum 10 characters |
| Accepting a risk needs an owner, a reason and an expiry | `ck_find_accept` check constraint plus the API |
| You can only grant a role at or below your own | Delegation ceiling in `TPRM_Clients_server.js` |
| Residual risk is derived, never typed | `tprm_scoring.js` is the only place the formula exists |

Scoring: `inherent = weighted mean of tiering answers (1–3)`,
`effectiveness = domain-weighted mean where Compliant=2, Partially=1,
Not Evidenced=1, Non-Compliant=0, Not Applicable excluded`,
`residual = inherent × (1 − effectiveness)`.

---

## Evidence in a returned ZIP

Suppliers can return one ZIP containing their workbook plus supporting files.
A file is matched to a control by either:

- a folder named after the control reference — `IAM-02/mfa_policy.pdf`
- a filename prefix — `IAM-02_mfa_policy.pdf`

Unmatched files are ignored. The questionnaire has an "Evidence folder" column
telling the supplier which name to use.

Each workbook carries a `veryHidden` `_identity` sheet, so a returned file is
matched to its supplier automatically. A file created by copying a blank
template has no identity sheet and is rejected with `IDENTITY_MISSING` rather
than being loaded against the wrong supplier.

---

## Deployment

nginx, matching the other dApps:

```nginx
server {
    server_name dtprm.dolluzcorp.com;
    root /var/www/dtprm/build;
    index index.html;

    location / { try_files $uri /index.html; }

    location /api/ {
        proxy_pass http://127.0.0.1:4009;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 60M;      # returned ZIPs with evidence
    }

    # Rate limiting lives here rather than in Express. express-rate-limit v7
    # does not export ipKeyGenerator and broke every rate-limited endpoint in
    # dShield; there is no reason to repeat that in Node.
    limit_req_zone $binary_remote_addr zone=dtprm:10m rate=30r/m;
}
```

```bash
pm2 start server.js --name dtprm
pm2 save
```

### Two things that will bite you

**Do not run `npm run build` on the droplet.** 1 vCPU / 1 GB with ~11 Node
processes already resident will OOM the webpack build. Build locally or on CI
and rsync the `build/` folder up.

**PDF generation works here.** This uses PDFKit, not Puppeteer — roughly 50 MB
rather than the 4 GB headless Chrome needs. Unlike dShield, reports are on by
default and no RAM upgrade is required.

### Nightly evidence decay

An expired certificate should demote its control without anyone remembering to
check. Add to cron:

```
0 2 * * * curl -s -X POST -b "dTprm_token=$DTPRM_SERVICE_TOKEN" \
  http://127.0.0.1:4009/api/tprm/evidence/maintenance/expire
```

---

## Files

```
config/db.js                          pooled MySQL, same factory as dAdmin
server.js                             CORS allowlist, route mounting, mail worker
db/migrate.js                         migration runner
db/migrations/00{1..5}_*.sql          schema and seed

src/backend_routes/
  TPRM_Login_server.js                exports { router, verifyJWT }
  TPRM_Clients_server.js              clients, methodology, role grants, dashboard
  TPRM_Library_server.js              sectors, standards, instrument versions
  TPRM_Vendors_server.js              intake, classification, triage, register
  TPRM_Assessments_server.js          tiering, positions, submit gate, approval
  TPRM_Distribution_server.js         questionnaire issue and import
  TPRM_Evidence_server.js             upload, validate, expiry decay
  TPRM_Findings_server.js             findings and SLA clocks
  TPRM_Reports_server.js              PDFKit reports, issuance, register export
  TPRM_Audit_server.js                read-only audit trail
  utils/tprm_scoring.js               the methodology, in one place
  utils/tprm_audit.js                 audit writer, tenant scope, permission gate
  utils/tprm_excel.js                 all four workbooks, generate and parse
  utils/tprm_classify.js              keyword classification with confidence
  utils/tprm_contradiction.js         cross-question consistency engine
  utils/tprm_mailer.js                outbox + SendGrid, with attachments
  utils/tprm_storage.js               disk storage, swap for Spaces later

src/
  App.js / index.js / left_navbar.js  shell, routing, permission-filtered menu
  utils/api.js                        apiFetch, apiJson, apiUpload, apiDownload
  utils/AccessContext.js              user, clients, per-client permissions
  utils/tprmAlert.js                  SweetAlert2 wrapper
  TPRM_Login.js                       sign-in
  TPRM_Dashboard.js                   programme position
  TPRM_Clients.js                     client list and onboarding
  TPRM_VendorPopulation.js            the 7-step pipeline
  TPRM_Assessments.js                 assessment list
  TPRM_AssessmentDetail.js            the assessor's workspace
  TPRM_Findings.js                    findings and SLA
  TPRM_Reports.js                     issue and history
  TPRM_QuestionBank.js                instrument versions and questions
  TPRM_Methodology.js                 weights, thresholds, SLA
  TPRM_UsersAndRoles.js               engagement role grants
  TPRM_AuditTrail.js                  audit view
```

Every page has a matching `.css` file.

---

## Known gaps

- **No Client Viewer login yet.** The `CV` role is seeded, but sign-in reads
  `dadmin.employee`, so an external client contact has nowhere to authenticate.
  Adding a `tprm_client_user` table is the next step if you want this.
- **Legal and report wording** is placeholder-free but has not been reviewed by
  anyone qualified. The scope-and-basis section of the PDF is the part to look at.
- **No reassessment scheduler.** `CADENCE_MONTHS` exists in `tprm_scoring.js`
  (12/24/36 by tier) but nothing acts on it yet.
- **Classification rules are seeded generously but not tuned.** Expect to add
  rows to `classify_rule` after the first real engagement.
