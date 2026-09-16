// The three workbooks.
//
//   1. Intake template      filled by the CLIENT  - who are your suppliers
//   2. Tiering pack         filled by the CLIENT  - what can they reach in you
//   3. Control questionnaire filled by the SUPPLIER - your own controls
//
// The client answers questions about the RELATIONSHIP. The supplier answers
// questions about ITSELF. Neither can answer the other side, which is why
// these are three separate files and not one.

const ExcelJS = require('exceljs');
const archiver = require('archiver');
const unzipper = require('unzipper');
const path = require('path');
const fs = require('fs');

const LOGO = path.join(__dirname, '..', '..', 'assets', 'img', 'DOLLUZ_CORP_reversed.png');
const NAVY = 'FF0D1B2A';
const GOLD = 'FFC9A227';
const LIGHT = 'FFFBFAF7';
const LINE = 'FFDCE3EB';

// The header band.
//
// DOLLUZ_CORP_reversed is the full lockup - eagle plus wordmark - drawn in
// WHITE ink, so it only reads on a dark ground. That is why row 1 is filled
// navy rather than left white: the reversed artwork on a white sheet is a gold
// bird and nothing else. It also matches the navy brand band every other
// Dolluz Corp export carries (see src/utils/tprmExport.js).
//
// The artwork is 3805x994. Sizing it by height and deriving the width keeps the
// lockup in proportion - the old code forced the eagle into a 150x38 box, which
// squashed it flat.
const LOGO_ASPECT = 3805 / 994;
const LOGO_H = 36;
const LOGO_W = Math.round(LOGO_H * LOGO_ASPECT);

// The title sits in the same merged cell the logo floats over, pushed clear of
// it by an indent rather than by starting in some column further along. Column
// widths differ on every sheet, so anchoring the title to a column letter is
// what put half a page between the mark and the heading. An indent is measured
// in characters of the cell's own font, so it holds wherever the columns land.
const LOGO_PAD_PX = 8;
const TITLE_INDENT = Math.ceil((LOGO_PAD_PX + LOGO_W + 20) / 8);

// One pixel in EMU, the unit a drawing anchor is stored in.
const EMU = 9525;

function brand(wb, ws, title, subtitle, span) {
    // The band runs the width of the table it heads, not a fixed eight columns:
    // a 20 column tiering pack with an A1:H1 band looks like the colour ran out
    // half way across.
    const last = ws.getColumn(Math.max(2, span || 8)).letter;
    // Tall enough to carry the lockup with air above and below it: the band is
    // the only place the mark appears, so it is drawn at a size that reads.
    ws.getRow(1).height = 38;
    ws.mergeCells(`A1:${last}1`);

    const t = ws.getCell('A1');
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    t.value = title;
    t.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    t.alignment = { vertical: 'middle', indent: TITLE_INDENT };

    if (fs.existsSync(LOGO)) {
        const id = wb.addImage({ filename: LOGO, extension: 'png' });
        // Anchored in absolute pixels, not as a fraction of column A. The
        // fractional form is scaled by whatever that column happens to be
        // wide, so the same logo sat 9px in on the questionnaire and 29px in
        // on the intake template, where it ran into the title.
        ws.addImage(id, {
            tl: {
                nativeCol: 0, nativeColOff: LOGO_PAD_PX * EMU,
                nativeRow: 0, nativeRowOff: 7 * EMU,
            },
            ext: { width: LOGO_W, height: LOGO_H },
        });
    }

    const s = ws.getCell('A2');
    s.value = subtitle;
    s.font = { name: 'Calibri', size: 9, color: { argb: 'FF5E6E80' } };
    s.alignment = { vertical: 'middle' };
    ws.mergeCells(`A2:${last}2`);
    ws.getRow(2).height = 16;
}

function headerRow(ws, rowNo, headers, widths) {
    const r = ws.getRow(rowNo);
    headers.forEach((h, i) => {
        const c = r.getCell(i + 1);
        c.value = h;
        c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
        c.alignment = { vertical: 'middle', wrapText: true };
        c.border = { bottom: { style: 'thin', color: { argb: LINE } } };
    });
    r.height = 30;
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.views = [{ state: 'frozen', ySplit: rowNo }];
}

/* ============================================ the dApps workbook theme ====
   The colours the rest of the suite issues its templates in. A header's fill
   is the one thing that says whether a column MUST be filled in, so the three
   fills are the whole grammar of these files:

     orange  you must answer this
     blue    optional, and there is a dropdown
     grey    we filled this in, or you may leave it

   A column that is both required and a dropdown takes orange: required is the
   thing somebody has to notice.

   Header text, column order, the header row (4) and the first data row (5) are
   NOT ours to move - the importer matches on header text, so a tidier layout
   here is a failed import later. */
const HEAD = {
    required: 'FFE8520A',
    optional: 'FF1E3A5F',
    fixed: 'FF374151',
    line: 'FFD1D5DB',
};

const T = {
    ink: 'FF374151',
    cellLine: 'FFE5E7EB',
    paper: 'FFFFFFFF',
    zebra: 'FFF9FAFB',
    legendFill: 'FFFFF3E0',
    legendInk: 'FFB45309',
    naFill: 'FFF3F4F6',
    naInk: 'FF9CA3AF',
    idInk: 'FF5E6E80',
    dimInk: 'FF6B7280',
    // The three scores, lowest risk to highest. Used by the conditional format
    // on the answer grid and by the score columns on the Questions sheet, so a
    // 3 reads the same in both places.
    score: [
        { fill: 'FFECFDF5', ink: 'FF047857' },
        { fill: 'FFFFFBEB', ink: 'FFB45309' },
        { fill: 'FFFEF2F2', ink: 'FFB91C1C' },
    ],
    everyFill: 'FFFFF3E0', everyInk: 'FFB45309', everyAsked: 'FFD97706',
    sectorFill: 'FFEFF6FF', sectorInk: 'FF1D4ED8',
};

const NBSP = ' ';

/* Hyphens only, everywhere. An en or em dash arrives by way of a paste out of
   Word, and it is the character that quietly breaks a header match when the
   file comes back. */
const plain = v => (v === null || v === undefined ? '' : String(v)).replace(/[–—]/g, '-');

const box = argb => ({
    top: { style: 'thin', color: { argb } }, left: { style: 'thin', color: { argb } },
    bottom: { style: 'thin', color: { argb } }, right: { style: 'thin', color: { argb } },
});

/** Row 3: what the colours mean, in the file itself rather than in a covering
 *  email nobody keeps. */
function legendBand(ws, span, text) {
    const last = ws.getColumn(Math.max(2, span)).letter;
    ws.mergeCells(`A3:${last}3`);
    const c = ws.getCell('A3');
    c.value = plain(text);
    c.font = { name: 'Calibri', size: 9, italic: true, color: { argb: T.legendInk } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: T.legendFill } };
    c.alignment = { vertical: 'middle', wrapText: true };
    ws.getRow(3).height = 30;
}

/** Row 4. cols: [{ header, kind: required|optional|fixed, width }] */
function themedHeader(ws, rowNo, cols) {
    const r = ws.getRow(rowNo);
    cols.forEach((col, i) => {
        const c = r.getCell(i + 1);
        c.value = plain(col.header);
        c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD[col.kind] } };
        c.alignment = {
            vertical: 'middle', wrapText: true,
            horizontal: col.kind === 'required' ? 'center' : 'left',
        };
        c.border = box(HEAD.line);
        ws.getColumn(i + 1).width = col.width;
    });
    r.height = 36;
    ws.views = [{ state: 'frozen', ySplit: rowNo }];
}

/** The ground under every data cell: zebra, thin rule, one grey ink. */
function dataCell(cell, i) {
    cell.font = { name: 'Calibri', size: 9, color: { argb: T.ink } };
    cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: i % 2 ? T.zebra : T.paper },
    };
    cell.border = box(T.cellLine);
}

const noteOf = text => ({
    texts: [{ font: { name: 'Calibri', size: 9 }, text: plain(text) }],
    margins: { insetmode: 'auto' },
});

/* Excel caps a data validation title at 32 characters and sizes the yellow box
   to the TITLE, not to the message - so a short title gives a narrow box that
   wraps the question into a thin ribbon. Padding the title out to the cap with
   non-breaking spaces is what makes the box wide enough to read. */
function promptTitle(text) {
    const base = `${plain(text)}  `;
    return base.length >= 32 ? base.slice(0, 32) : base + NBSP.repeat(32 - base.length);
}

/* [5,6,7,9] -> ['A5:A7', 'A9']. A sector question is asked of the suppliers on
   that instrument and of nobody else, and those rows are scattered through an
   alphabetical list - so a column's validation is one range per run of rows,
   never one that spans the n/a cells between them. */
function runs(rows) {
    const out = [];
    rows.forEach(r => {
        const last = out[out.length - 1];
        if (last && r === last[1] + 1) last[1] = r;
        else out.push([r, r]);
    });
    return out;
}

const rangeOf = (letter, [a, b]) => (a === b ? `${letter}${a}` : `${letter}${a}:${letter}${b}`);

/* Line breaks inside a data validation message.
 *
 * ExcelJS writes the prompt as an XML ATTRIBUTE and escapes only < > & " ',
 * so a newline goes into the file as a raw LF - and an XML parser is required
 * to turn any literal newline in an attribute into a space before Excel ever
 * sees it. The question and its three options therefore arrived as one
 * paragraph. The character reference &#10; survives that normalisation, and is
 * the only thing that does, so the attribute is re-encoded here after ExcelJS
 * has finished. Cell values are untouched - this rewrites nothing but the
 * newlines in a prompt or error message. */
const encodeBreaks = xml => xml.replace(
    / (prompt|error)="([^"]*)"/g,
    (whole, attr, value) => (value.includes('\n')
        ? ` ${attr}="${value.replace(/\n/g, '&#10;')}"`
        : whole));

/** Writes the workbook, then repacks it with the prompt newlines encoded. */
async function writeWorkbook(wb) {
    const original = Buffer.from(await wb.xlsx.writeBuffer());
    const dir = await unzipper.Open.buffer(original);

    const zip = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    zip.on('data', c => chunks.push(c));
    const closed = new Promise((resolve, reject) => {
        zip.on('end', resolve);
        zip.on('error', reject);
    });

    // Same entries, same order - only the worksheet parts are rewritten, and
    // only where a prompt carries a newline.
    for (const file of dir.files) {
        if (file.type !== 'File') continue;
        const body = await file.buffer();
        zip.append(
            /^xl\/worksheets\/sheet\d+\.xml$/.test(file.path)
                ? Buffer.from(encodeBreaks(body.toString('utf8')), 'utf8')
                : body,
            { name: file.path });
    }
    zip.finalize();
    await closed;
    return Buffer.concat(chunks);
}

/* ==================================================== 1. intake template */

const INTAKE_COLUMNS = [
    { key: 'vendor_name', header: 'Supplier legal name', required: true, width: 34 },
    { key: 'trading_name', header: 'Trading name', required: false, width: 24 },
    { key: 'service_desc', header: 'Service description', required: true, width: 44 },
    { key: 'spend_category', header: 'Your spend category', required: false, width: 24 },
    { key: 'annual_value', header: 'Annual contract value', required: false, width: 20 },
    { key: 'contract_owner', header: 'Contract owner', required: true, width: 22 },
    { key: 'contact_email', header: 'Supplier contact email', required: true, width: 30 },
    { key: 'data_access', header: 'Accesses our data (Y/N)', required: true, width: 20, dropdown: true },
    { key: 'system_access', header: 'Connects to our systems (Y/N)', required: true, width: 24, dropdown: true },
    { key: 'category', header: 'Category (leave blank)', required: false, width: 24, ours: true },
];

const INTAKE_LEGEND =
    '\u{1F4A1} Orange header = Required  |  Dark grey header = Optional  |  '
    + '▼ = pick from dropdown  |  Required columns are also marked with *. '
    + 'Do not add, remove or reorder columns. Leave the Category column blank - '
    + 'we suggest it for you.';

const GUIDANCE_LEGEND =
    '\u{1F4A1} YES = the file cannot be loaded without it  |  '
    + '▼ = pick from the dropdown on the Supplier list sheet  |  '
    + 'Every column is listed here in the order it appears there';

async function intakeTemplate({ tenantName, businessUnit }) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Dolluz Corp TPRM';
    wb.created = new Date();

    const LAST = 2000;
    const ws = wb.addWorksheet('Supplier list', { views: [{ showGridLines: false }] });
    brand(wb, ws, 'Supplier intake template',
        `${tenantName}${businessUnit ? ' | ' + businessUnit : ''}   Export your supplier master into row 5 onward`,
        INTAKE_COLUMNS.length);
    legendBand(ws, INTAKE_COLUMNS.length, INTAKE_LEGEND);

    themedHeader(ws, 4, INTAKE_COLUMNS.map(c => ({
        header: c.header + (c.required ? ' *' : ''),
        // Both Y/N columns are required as well as pick-lists, and required is
        // the thing that has to be noticed, so they take orange rather than the
        // dropdown blue.
        kind: c.required ? 'required' : 'fixed',
        width: c.width,
    })));

    // The arrow only appears once a cell is selected, so the header says it too.
    INTAKE_COLUMNS.forEach((c, i) => {
        if (c.dropdown) ws.getRow(4).getCell(i + 1).note = noteOf('▼ Select from dropdown list');
    });

    for (let r = 5; r <= LAST; r++) {
        const row = ws.getRow(r);
        INTAKE_COLUMNS.forEach((c, i) => {
            const cell = row.getCell(i + 1);
            dataCell(cell, r - 5);
            // Ours to fill in, not theirs. Drawn faint so the empty column does
            // not read as something they missed.
            if (c.ours) cell.font = { name: 'Calibri', size: 9, color: { argb: T.naInk } };
            if (c.key === 'annual_value') cell.numFmt = '#,##0';
        });
    }

    const colOf = key => ws.getColumn(INTAKE_COLUMNS.findIndex(c => c.key === key) + 1).letter;
    const whole = letter => `${letter}5:${letter}${LAST}`;

    // Y/N dropdowns so the two triage answers arrive clean rather than as
    // "Yes", "yes", "TRUE", "1" and every other variant a spreadsheet invites.
    for (const key of ['data_access', 'system_access']) {
        ws.dataValidations.add(whole(colOf(key)), {
            type: 'list', allowBlank: false, formulae: ['"Y,N"'],
            showInputMessage: true,
            promptTitle: promptTitle('Y or N'),
            prompt: 'Y if they do, N if they do not.\n'
                + 'This answer decides whether the supplier is assessed at all.',
            showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Y or N only',
            error: 'Enter Y or N.',
        });
    }

    // Caught here rather than on import: a duplicate found in Excel costs one
    // edit, the same duplicate found after upload costs a re-issued file.
    const name = colOf('vendor_name');
    ws.dataValidations.add(whole(name), {
        type: 'custom', allowBlank: true,
        formulae: [`COUNTIF($${name}$5:$${name}$${LAST},${name}5)=1`],
        showInputMessage: true,
        promptTitle: promptTitle('Supplier legal name'),
        prompt: 'As it appears on the contract.\nEach supplier may appear only once in this file.',
        showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Already in this file',
        error: 'That supplier is listed above already. Every legal name must be unique.',
    });

    const mail = colOf('contact_email');
    ws.dataValidations.add(whole(mail), {
        type: 'custom', allowBlank: true,
        formulae: [`AND(ISNUMBER(SEARCH("@",${mail}5)),ISNUMBER(SEARCH(".",${mail}5)))`],
        showInputMessage: true,
        promptTitle: promptTitle('Supplier contact email'),
        prompt: 'Where the security questionnaire will be sent.\nOne address, with an @ and a dot.',
        showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Not an email address',
        error: 'Enter one address, for example name@supplier.com.',
    });

    const money = colOf('annual_value');
    ws.dataValidations.add(whole(money), {
        type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true,
        showInputMessage: true,
        promptTitle: promptTitle('Annual contract value'),
        prompt: 'A number, with no currency symbol.\nUsed for materiality, not for tiering on its own.',
        showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Numbers only',
        error: 'Enter a number of 0 or more, with no currency symbol or text.',
    });

    const g = wb.addWorksheet('Guidance', { views: [{ showGridLines: false }] });
    brand(wb, g, 'How to complete this workbook', tenantName, 3);
    legendBand(g, 3, GUIDANCE_LEGEND);
    themedHeader(g, 4, [
        { header: 'Column', kind: 'optional', width: 32 },
        { header: 'Required', kind: 'optional', width: 14 },
        { header: 'What to enter', kind: 'optional', width: 86 },
    ]);
    const guide = [
        ['Supplier legal name', 'YES', 'As it appears on the contract. Must be unique in this file.'],
        ['Trading name', 'no', 'Only if different from the legal name.'],
        ['Service description', 'YES', 'One line describing what they do for you. This drives the category suggestion.'],
        ['Your spend category', 'Recommended', 'Straight from your procurement system, whatever code you already use.'],
        ['Annual contract value', 'Recommended', 'Numeric. Used for materiality, not for tiering on its own.'],
        ['Contract owner', 'YES', 'Who inside your organisation owns the relationship.'],
        ['Supplier contact email', 'YES', 'Where the security questionnaire will be sent.'],
        ['Accesses our data ▼', 'YES', 'Y or N. Drives the triage decision.'],
        ['Connects to our systems ▼', 'YES', 'Y or N. Drives the triage decision.'],
        ['Category', 'Leave blank', 'We suggest this from the rules and an assessor confirms it.'],
    ];
    const LEVEL = {
        YES: { argb: 'FFD97706', bold: true },
        no: { argb: T.naInk, bold: false },
        Recommended: { argb: T.dimInk, bold: true },
        'Leave blank': { argb: T.dimInk, bold: true },
    };
    guide.forEach((row, i) => {
        const r = g.getRow(5 + i);
        row.forEach((v, c) => {
            const cell = r.getCell(c + 1);
            cell.value = plain(v);
            dataCell(cell, i);
            cell.alignment = { wrapText: true, vertical: 'top' };
        });
        const required = row[1] === 'YES';
        const first = r.getCell(1);
        if (required) {
            first.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: T.everyFill } };
        }
        first.font = {
            name: 'Calibri', size: 9, bold: true,
            color: { argb: required ? T.everyInk : T.ink },
        };
        const level = LEVEL[row[1]];
        r.getCell(2).font = { name: 'Calibri', size: 9, bold: level.bold, color: { argb: level.argb } };
        r.height = 26;
    });

    return writeWorkbook(wb);
}

/* =============================================== 2. parse a returned intake */

const HEADER_ALIASES = {
    vendor_name: ['supplier legal name', 'supplier name', 'vendor name', 'vendor legal name', 'name'],
    trading_name: ['trading name', 'trade name'],
    service_desc: ['service description', 'description of service', 'service', 'scope of work'],
    spend_category: ['your spend category', 'spend category', 'procurement category', 'category code'],
    annual_value: ['annual contract value', 'contract value', 'po value', 'annual value', 'spend'],
    contract_owner: ['contract owner', 'owner', 'business owner'],
    contact_email: ['supplier contact email', 'vendor contact email', 'contact email', 'email'],
    data_access: ['accesses our data', 'data access', 'accesses our data (y/n)'],
    system_access: ['connects to our systems', 'system access', 'connects to our systems (y/n)'],
    category: ['category', 'category (leave blank)', 'instrument'],
};

const norm = s => String(s === null || s === undefined ? '' : s)
    .toLowerCase().replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();

function mapColumns(headerCells) {
    const map = {}, unmapped = [];
    headerCells.forEach((h, idx) => {
        const n = norm(h);
        if (!n) return;
        let hit = null;
        for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
            if (aliases.includes(n)) { hit = key; break; }
        }
        if (hit && map[hit] === undefined) map[hit] = idx;
        else unmapped.push(String(h));
    });
    return { map, unmapped };
}

const cellText = v => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'object') {
        if (v.text !== undefined) return String(v.text);
        if (v.result !== undefined) return String(v.result);
        if (v.richText) return v.richText.map(t => t.text).join('');
        return String(v);
    }
    return String(v);
};

async function parseIntake(buffer) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer); }
    catch { throw Object.assign(new Error('That file could not be opened as an Excel workbook'), { code: 'FILE_UNREADABLE' }); }

    const ws = wb.worksheets[0];
    if (!ws) throw Object.assign(new Error('The workbook has no worksheets'), { code: 'NO_SHEET' });

    // Find the header row: the first row in the top 15 that carries a
    // recognisable supplier-name column. Clients add their own title rows.
    let headerRowNo = null, headerCells = null;
    for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
        const vals = ws.getRow(r).values.slice(1).map(cellText);
        const { map } = mapColumns(vals);
        if (map.vendor_name !== undefined) { headerRowNo = r; headerCells = vals; break; }
    }
    if (!headerRowNo) {
        throw Object.assign(
            new Error('No supplier name column was found in the first 15 rows. Use the issued intake template.'),
            { code: 'HEADER_NOT_FOUND' });
    }

    const { map, unmapped } = mapColumns(headerCells);
    const missing = ['vendor_name', 'service_desc', 'contract_owner', 'contact_email', 'data_access', 'system_access']
        .filter(k => map[k] === undefined);

    const rows = [], seen = new Map();
    for (let r = headerRowNo + 1; r <= ws.rowCount; r++) {
        const raw = ws.getRow(r).values.slice(1).map(cellText);
        if (!raw.length || raw.every(v => v === null || String(v).trim() === '')) continue;

        const get = k => (map[k] === undefined ? null : (raw[map[k]] === undefined ? null : raw[map[k]]));
        const trim = v => (v ? String(v).trim() : null);
        const numRaw = get('annual_value');

        const rec = {
            row_no: r,
            raw,
            vendor_name: trim(get('vendor_name')),
            service_desc: trim(get('service_desc')),
            spend_category: trim(get('spend_category')),
            annual_value: (numRaw !== null && String(numRaw).trim() !== '')
                ? Number(String(numRaw).replace(/[^0-9.\-]/g, '')) : null,
            contract_owner: trim(get('contract_owner')),
            contact_email: trim(get('contact_email')),
            data_access: get('data_access') ? String(get('data_access')).trim().toUpperCase().charAt(0) : null,
            system_access: get('system_access') ? String(get('system_access')).trim().toUpperCase().charAt(0) : null,
            errors: [],
        };

        for (const [k, label] of [
            ['vendor_name', 'Supplier legal name'], ['service_desc', 'Service description'],
            ['contract_owner', 'Contract owner'], ['contact_email', 'Supplier contact email'],
        ]) {
            if (!rec[k]) rec.errors.push({
                code: 'REQUIRED_FIELD_MISSING', field: k,
                message: `${label} is required and was left blank`,
            });
        }
        if (rec.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.contact_email)) {
            rec.errors.push({
                code: 'INVALID_EMAIL', field: 'contact_email',
                message: `"${rec.contact_email}" is not a valid email address`,
            });
        }
        for (const [k, label] of [
            ['data_access', 'Accesses our data'], ['system_access', 'Connects to our systems'],
        ]) {
            if (!rec[k]) rec.errors.push({
                code: 'REQUIRED_FIELD_MISSING', field: k,
                message: `${label} is required. Enter Y or N`,
            });
            else if (!['Y', 'N'].includes(rec[k])) rec.errors.push({
                code: 'INVALID_YN', field: k,
                message: `${label} must be Y or N, found "${rec[k]}"`,
            });
        }
        if (rec.annual_value !== null && Number.isNaN(rec.annual_value)) {
            rec.errors.push({
                code: 'INVALID_NUMBER', field: 'annual_value',
                message: 'Annual contract value must be a number',
            });
            rec.annual_value = null;
        }
        if (rec.vendor_name) {
            const key = rec.vendor_name.toLowerCase();
            if (seen.has(key)) rec.errors.push({
                code: 'DUPLICATE_IN_FILE', field: 'vendor_name',
                message: `Duplicate of row ${seen.get(key)} in this file`,
            });
            else seen.set(key, r);
        }
        rows.push(rec);
    }

    return { headerRowNo, map, unmapped, missing, rows };
}

/* ================================================ 3. tiering pack, one file */

const TIERING_LEGEND =
    '\u{1F4A1} Orange header = Required (answer 1, 2 or 3)  |  Dark grey header = Pre-filled, '
    + 'do not edit  |  Grey n/a cell = not asked of this supplier  |  Click any answer cell or '
    + 'hover a T-header to see the question and what 1 / 2 / 3 mean';

const QUESTIONS_LEGEND =
    '\u{1F4A1} Orange Ref = asked of every supplier  |  Blue Ref = asked only of the sector shown '
    + 'in "Asked of"  |  Score 1 = lowest risk, Score 3 = highest risk';

const askedOf = q => (q.sector_code ? `${q.sector_code} suppliers only` : 'Every supplier');

/* What the yellow box says when an answer cell is clicked.
 *
 * Excel stops at 255 characters and truncates silently, mid word - which is
 * how option 3 of the second T01 once went out as "regulated pers". Drop the
 * stock opening first, and if it still will not fit, fail the export and name
 * the question: half an answer on screen is worse than no file. */
function clickBox(q) {
    const withOptions = text => `${plain(text)}`
        + `\n1 = ${plain(q.score_1_label)}`
        + `\n2 = ${plain(q.score_2_label)}`
        + `\n3 = ${plain(q.score_3_label)}`;

    let prompt = withOptions(q.q_text);
    if (prompt.length > 255) {
        const shorter = plain(q.q_text).replace(/^What is the /, '');
        prompt = withOptions(shorter.charAt(0).toUpperCase() + shorter.slice(1));
    }
    if (prompt.length > 255) {
        throw new Error(
            `Tiering pack: the question box for ${q.q_ref} needs ${prompt.length} characters and `
            + 'Excel allows 255. Shorten the question or one of its score labels.');
    }
    return prompt;
}

async function tieringPack({ tenantName, questions, vendors }) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Dolluz Corp TPRM';

    const span = 3 + questions.length;
    const ws = wb.addWorksheet('Tiering', { views: [{ showGridLines: false }] });
    brand(wb, ws, 'Inherent risk tiering pack',
        `${tenantName}   One row per supplier. Answer 1, 2 or 3 in every question column.`, span);
    legendBand(ws, span, TIERING_LEGEND);

    themedHeader(ws, 4, [
        { header: 'Supplier id', kind: 'fixed', width: 12 },
        { header: 'Supplier', kind: 'fixed', width: 32 },
        { header: 'Instrument', kind: 'fixed', width: 24 },
        ...questions.map(q => ({ header: q.q_ref, kind: 'required', width: 7 })),
    ]);

    /* Everything below reaches a question BY POSITION. Two columns can carry
       the same Ref - the core T01 and a sector T01 are different questions with
       the same name - so anything that looked a question up by its header text
       would hang the wrong box on one of them. This checks the assumption
       rather than trusting it. */
    questions.forEach((q, i) => {
        const written = ws.getRow(4).getCell(4 + i).value;
        if (written !== q.q_ref) {
            throw new Error(`Tiering pack: column ${4 + i} reads "${written}" `
                + `but question ${i + 1} is ${q.q_ref}. The header and question order have diverged.`);
        }
    });

    const legend = wb.addWorksheet('Questions', { views: [{ showGridLines: false }] });
    brand(wb, legend, 'What each column asks', tenantName, 7);
    legendBand(legend, 7, QUESTIONS_LEGEND);
    themedHeader(legend, 4, [
        { header: 'Ref', kind: 'optional', width: 8 },
        { header: 'Dimension', kind: 'optional', width: 10 },
        { header: 'Question', kind: 'optional', width: 60 },
        { header: 'Score 1', kind: 'optional', width: 26 },
        { header: 'Score 2', kind: 'optional', width: 26 },
        { header: 'Score 3', kind: 'optional', width: 30 },
        { header: 'Asked of', kind: 'optional', width: 20 },
    ]);
    questions.forEach((qq, i) => {
        const r = legend.getRow(5 + i);
        const every = !qq.sector_code;
        [qq.q_ref, qq.dimension_code, qq.q_text, qq.score_1_label, qq.score_2_label,
         qq.score_3_label, askedOf(qq)]
            .forEach((v, c) => {
                const cell = r.getCell(c + 1);
                cell.value = plain(v);
                dataCell(cell, i);
                cell.alignment = { wrapText: true, vertical: 'top' };
            });

        // The Ref carries who the question is put to, so the sheet can be read
        // down its first column alone.
        const ref = r.getCell(1);
        ref.fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: every ? T.everyFill : T.sectorFill },
        };
        ref.font = {
            name: 'Calibri', size: 9, bold: true,
            color: { argb: every ? T.everyInk : T.sectorInk },
        };
        r.getCell(2).font = { name: 'Calibri', size: 9, bold: true, color: { argb: T.dimInk } };
        r.getCell(2).alignment = { horizontal: 'center', vertical: 'top' };
        T.score.forEach((s, n) => {
            r.getCell(4 + n).font = { name: 'Calibri', size: 9, color: { argb: s.ink } };
        });
        r.getCell(7).font = {
            name: 'Calibri', size: 9, bold: true,
            color: { argb: every ? T.everyAsked : T.sectorInk },
        };
        r.height = 30;
    });

    // Which rows each question is actually put to, gathered as the grid is
    // written so the validations below cover those cells and no others.
    const asked = questions.map(() => []);

    vendors.forEach((v, i) => {
        const r = ws.getRow(5 + i);
        const id = r.getCell(1), supplier = r.getCell(2), instrument = r.getCell(3);
        id.value = v.third_party_id;
        supplier.value = plain(v.third_party_name);
        instrument.value = plain(v.sector_name || v.sector_code);
        [id, supplier, instrument].forEach(c => dataCell(c, i));
        id.font = { name: 'Consolas', size: 9, color: { argb: T.idInk } };
        supplier.font = { name: 'Calibri', size: 9, bold: true, color: { argb: T.ink } };
        instrument.font = { name: 'Calibri', size: 9, color: { argb: T.dimInk } };

        questions.forEach((q, c) => {
            const cell = r.getCell(4 + c);
            dataCell(cell, i);
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            // A sector question is only asked of suppliers on that instrument.
            // The cell is filled and marked rather than left blank, so nobody
            // has to work out from the column heading whether it was an
            // oversight or deliberate.
            const applies = !q.sector_code || q.sector_code === v.sector_code;
            if (!applies) {
                cell.value = 'n/a';
                cell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: T.naInk } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: T.naFill } };
                return;
            }
            cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: T.ink } };
            asked[c].push(5 + i);
        });
    });

    questions.forEach((q, c) => {
        const letter = ws.getColumn(4 + c).letter;

        // The same words as the click box, plus who the question is put to,
        // reachable without selecting the cell.
        ws.getRow(4).getCell(4 + c).note = noteOf(
            `${q.q_ref} - ${q.dimension_code}\n${plain(q.q_text)}\n\n`
            + `1 = ${plain(q.score_1_label)}\n2 = ${plain(q.score_2_label)}\n3 = ${plain(q.score_3_label)}\n\n`
            + `Asked of: ${askedOf(q)}`);

        const validation = {
            type: 'list', allowBlank: true, formulae: ['"1,2,3"'],
            showInputMessage: true,
            promptTitle: promptTitle(`${q.q_ref} - ${q.dimension_code}`),
            prompt: clickBox(q),
            showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Answer 1, 2 or 3',
            error: 'Pick 1, 2 or 3 from the dropdown.',
        };
        runs(asked[c]).forEach(run => ws.dataValidations.add(rangeOf(letter, run), validation));
    });

    // Colour follows the answer as it is typed, so a sheet of 3s is visible
    // from across the room rather than read a cell at a time.
    if (vendors.length && questions.length) {
        const first = ws.getColumn(4).letter;
        const last = ws.getColumn(3 + questions.length).letter;
        ws.addConditionalFormatting({
            ref: `${first}5:${last}${4 + vendors.length}`,
            rules: T.score.map((s, n) => ({
                type: 'cellIs', operator: 'equal', formulae: [String(n + 1)], priority: n + 1,
                style: {
                    font: { bold: true, color: { argb: s.ink } },
                    fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: s.fill } },
                },
            })),
        });
    }

    return writeWorkbook(wb);
}

/** Reads a returned tiering pack back. Returns one record per supplier row. */
async function parseTieringPack(buffer) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer); }
    catch { throw Object.assign(new Error('That file could not be opened as an Excel workbook'), { code: 'FILE_UNREADABLE' }); }

    const ws = wb.getWorksheet('Tiering') || wb.worksheets[0];
    const headers = ws.getRow(4).values.slice(1).map(cellText);
    const refs = headers.slice(3).filter(Boolean);   // columns 4+ are q_refs

    const out = [], problems = [];
    for (let r = 5; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const tpId = Number(cellText(row.getCell(1).value));
        if (!tpId) continue;
        const answers = [];
        // Not every column is asked of every supplier: a sector question is
        // written 'n/a' on the rows it does not apply to. Those are neither an
        // answer nor a gap, so they count towards neither.
        let expected = 0;
        refs.forEach((ref, i) => {
            const v = cellText(row.getCell(4 + i).value);
            const t = v === null ? '' : String(v).trim();
            if (t.toLowerCase() === 'n/a') return;
            expected += 1;
            if (t === '') return;
            const n = Number(t);
            if (![1, 2, 3].includes(n)) {
                problems.push({ row: r, ref, code: 'SCORE_NOT_RECOGNISED', message: `"${v}" is not 1, 2 or 3` });
                return;
            }
            answers.push({ q_ref: ref, score: n });
        });
        out.push({
            third_party_id: tpId,
            third_party_name: cellText(row.getCell(2).value),
            answers,
            expected,
        });
    }
    return { rows: out, problems, refs };
}

/* ========================== 4. control questionnaire, one per supplier ==== */

const VALID_POSITIONS = [
    'Compliant', 'Partially Compliant', 'Non-Compliant', 'Not Evidenced', 'Not Applicable',
];

async function controlWorkbook({ tenantName, vendor, assessment, controls }) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Dolluz Corp TPRM';

    const ws = wb.addWorksheet('Questionnaire', { views: [{ showGridLines: false }] });
    brand(wb, ws, 'Security questionnaire',
        `${tenantName}   ${vendor.third_party_name}   ${vendor.sector_name || vendor.sector_code}   Tier ${assessment.tier}`);

    headerRow(ws, 4,
        ['Ref', 'Control area', 'Question', 'Evidence required', 'Your position', 'Notes', 'Evidence folder'],
        [10, 22, 62, 40, 22, 34, 22]);

    controls.forEach((c, i) => {
        const r = ws.getRow(5 + i);
        r.getCell(1).value = c.q_ref;
        r.getCell(2).value = c.domain_name || c.domain_code;
        r.getCell(3).value = c.q_text;
        r.getCell(4).value = c.evidence_required || '';
        r.getCell(5).dataValidation = {
            type: 'list', allowBlank: false,
            formulae: [`"${VALID_POSITIONS.join(',')}"`],
            showErrorMessage: true, errorTitle: 'Choose one of the five positions',
            error: 'Pick from the dropdown. A different value cannot be read back.',
        };
        r.getCell(7).value = c.q_ref;
        for (let c2 = 1; c2 <= 7; c2++) {
            const cell = r.getCell(c2);
            cell.font = { name: 'Calibri', size: 9, bold: c2 === 1 };
            cell.alignment = { wrapText: true, vertical: 'top' };
            cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
        }
        r.height = 30;
    });

    // Hidden identity sheet. This is what lets a returned file be matched back
    // to its supplier automatically, with no manual mapping step and no chance
    // of loading Acme's answers against Globex's assessment.
    const id = wb.addWorksheet('_identity');
    id.state = 'veryHidden';
    id.addRow(['tenant_id', assessment.tenant_id]);
    id.addRow(['third_party_id', vendor.third_party_id]);
    id.addRow(['assessment_id', assessment.assessment_id]);
    id.addRow(['instrument_version_id', assessment.instrument_version_id]);
    id.addRow(['issued_at', new Date().toISOString()]);

    return wb.xlsx.writeBuffer();
}

async function parseControlWorkbook(buffer) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer); }
    catch { throw Object.assign(new Error('That file could not be opened as an Excel workbook'), { code: 'FILE_UNREADABLE' }); }

    const id = wb.getWorksheet('_identity');
    if (!id) {
        throw Object.assign(new Error(
            'This workbook has no identity sheet, so it cannot be matched to a supplier. '
            + 'It was probably created by copying the template rather than using the issued file.'
        ), { code: 'IDENTITY_MISSING' });
    }
    const meta = {};
    id.eachRow(r => { meta[String(cellText(r.getCell(1).value))] = cellText(r.getCell(2).value); });

    const ws = wb.getWorksheet('Questionnaire') || wb.worksheets[0];
    const answers = [], problems = [];
    for (let r = 5; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const refS = cellText(row.getCell(1).value);
        if (!refS || !refS.trim()) continue;
        const pos = cellText(row.getCell(5).value);
        const note = cellText(row.getCell(6).value);
        if (!pos || !pos.trim()) {
            problems.push({ row: r, ref: refS.trim(), code: 'POSITION_BLANK', message: 'No position was chosen' });
            continue;
        }
        if (!VALID_POSITIONS.includes(pos.trim())) {
            problems.push({
                row: r, ref: refS.trim(), code: 'POSITION_NOT_RECOGNISED',
                message: `"${pos}" is not one of the five allowed positions`,
            });
            continue;
        }
        answers.push({ q_ref: refS.trim(), position: pos.trim(), note: note ? note.trim() : null });
    }
    return { meta, answers, problems };
}

/* ============================================= 5. the third party register */

async function registerExport({ tenantName, rows }) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Dolluz Corp TPRM';
    const ws = wb.addWorksheet('Register', { views: [{ showGridLines: false }] });
    brand(wb, ws, 'Third party register', `${tenantName}   ${rows.length} suppliers   Exported ${new Date().toLocaleDateString('en-GB')}`);
    headerRow(ws, 4,
        ['Ref', 'Supplier', 'Instrument', 'In scope', 'Tier', 'Inherent', 'Effectiveness',
            'Residual', 'Band', 'State', 'Open findings', 'Contract owner'],
        [12, 34, 22, 10, 8, 10, 13, 10, 12, 14, 13, 22]);

    rows.forEach((v, i) => {
        const r = ws.getRow(5 + i);
        const vals = [
            v.ref_code, v.third_party_name, v.sector_name || v.sector_code,
            v.in_scope === null || v.in_scope === undefined ? 'Not triaged' : (v.in_scope ? 'Yes' : 'No'),
            v.tier || '', v.inherent_score || '',
            v.effectiveness === null || v.effectiveness === undefined ? '' : Math.round(v.effectiveness * 100) + '%',
            v.residual_score || '', v.residual_band || '', v.assessment_state || 'Not started',
            v.open_findings || 0, v.contract_owner || '',
        ];
        vals.forEach((val, c) => {
            const cell = r.getCell(c + 1);
            cell.value = val;
            cell.font = { name: 'Calibri', size: 9, bold: c === 0 };
            cell.alignment = { wrapText: true, vertical: 'top' };
        });
        if (i % 2 === 1) {
            for (let c = 1; c <= 12; c++) {
                r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
            }
        }
    });
    return wb.xlsx.writeBuffer();
}

/* ============================================ 4. the question template
   Authoring an instrument a question at a time is fine for a correction and
   painful for a new one: thirty control questions is thirty rows typed into a
   browser. This is the same set as a workbook - fill it in Excel, import it,
   review what came in, save.

   Two sheets, because the two kinds of question genuinely differ: a tiering
   question carries three score labels and no evidence, a control question
   carries evidence and a standard and no score labels. One merged sheet would
   be half empty whichever row you were on. */

const TIERING_COLS = [
    ['Ref *', 12], ['Dimension code *', 18], ['Question *', 60],
    ['Score 1 label', 26], ['Score 2 label', 26], ['Score 3 label', 26],
    ['Why we ask', 40],
];

const CONTROL_COLS = [
    ['Ref *', 12], ['Control area code *', 20], ['Question *', 60],
    ['Evidence expected', 34], ['Standard', 26], ['Applies to tier', 15],
    ['Why we ask', 40],
];

function questionSheet(wb, name, title, subtitle, cols, sample) {
    const ws = wb.addWorksheet(name);
    brand(wb, ws, title, subtitle);
    headerRow(ws, 4, cols.map(c => c[0]), cols.map(c => c[1]));
    const r = ws.getRow(5);
    sample.forEach((v, c) => { r.getCell(c + 1).value = v; });
    r.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF8494A5' } };
    r.alignment = { vertical: 'top', wrapText: true };
    return ws;
}

/** vars: { sectorName, dimensions, domains, standards } */
async function questionTemplate(vars) {
    const v = vars || {};
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Dolluz Corp TPRM Toolkit';
    const name = v.sectorName || 'instrument';
    const dims = v.dimensions || [];
    const doms = v.domains || [];

    questionSheet(wb, 'Tiering', 'Tiering questions',
        name + ' - answered by the CLIENT, about the relationship',
        TIERING_COLS, [
            'T01', (dims[0] || {}).dimension_code || 'DATA',
            'What is the highest classification of our data the third party can access?',
            'Public or non-sensitive', 'Internal use only', 'Confidential, restricted or regulated',
            'Delete this example row before importing.',
        ]);

    questionSheet(wb, 'Control', 'Control questions',
        name + ' - answered by the SUPPLIER, about its own controls',
        CONTROL_COLS, [
            'GOV-01', (doms[0] || {}).domain_code || 'GOV',
            'Is there a board approved information security policy, and when was it last reviewed?',
            'Policy document with approval page and review date', 'ISO/IEC 27001:2022', 3,
            'Delete this example row before importing.',
        ]);

    /* Every code the two sheets will accept, on a sheet of its own. A template
       that validates against codes it never shows you is one that gets filled
       in wrong once and then blamed. */
    const ref = wb.addWorksheet('Reference');
    brand(wb, ref, 'Codes you may use', 'Copy these exactly into the code columns');
    headerRow(ref, 4, ['Sheet', 'Code', 'Means'], [14, 22, 60]);
    let n = 5;
    const put = (sheet, code, means) => {
        const row = ref.getRow(n++);
        row.getCell(1).value = sheet;
        row.getCell(2).value = code;
        row.getCell(3).value = means;
        row.alignment = { vertical: 'top', wrapText: true };
    };
    dims.forEach(d => put('Tiering', d.dimension_code, d.dimension_name));
    doms.forEach(d => put('Control', d.domain_code, d.domain_name));
    put('Control', '1 / 2 / 3', 'Applies to tier: 1 = Tier 1 only, 2 = Tier 1 and 2, 3 = every tier');
    (v.standards || []).forEach(x => put('Control', x, 'Standard, optional'));

    return wb.xlsx.writeBuffer();
}

/** Reads a filled question template back. Writes nothing - the caller decides
 *  what to do with the rows and with the problems. */
async function parseQuestionTemplate(buffer, valid) {
    const v = valid || {};
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer); } catch (e) {
        throw Object.assign(new Error('That file could not be opened as an Excel workbook'),
            { code: 'FILE_UNREADABLE' });
    }

    const dims = new Set((v.dimensions || []).map(d => d.dimension_code));
    const doms = new Set((v.domains || []).map(d => d.domain_code));
    const rows = [];
    const problems = [];
    const seen = new Set();

    const readSheet = (sheetName, qType) => {
        const ws = wb.getWorksheet(sheetName);
        if (!ws) return;
        for (let n = 5; n <= ws.rowCount; n++) {
            const vals = ws.getRow(n).values.slice(1).map(cellText);
            const cell = (i) => {
                const x = vals[i];
                return (x === null || x === undefined) ? '' : String(x).trim();
            };
            const qRef = cell(0).toUpperCase();
            const code = cell(1).toUpperCase();
            const qText = cell(2);
            // A wholly blank row is where someone stopped typing, not an error.
            if (!qRef && !code && !qText) continue;

            const errs = [];
            if (!qRef) errs.push('Ref is blank');
            else if (qRef.length > 16) errs.push('Ref is longer than 16 characters');
            else if (seen.has(qRef)) errs.push('Ref ' + qRef + ' appears more than once');
            if (!qText) errs.push('Question is blank');
            else if (qText.length > 600) errs.push('Question is longer than 600 characters');

            if (!code) {
                errs.push(qType === 'tiering' ? 'Dimension code is blank' : 'Control area code is blank');
            } else if (qType === 'tiering' && !dims.has(code)) {
                errs.push(code + ' is not a dimension code');
            } else if (qType === 'control' && !doms.has(code)) {
                errs.push(code + ' is not a control area code');
            }

            let tier = 3;
            if (qType === 'control') {
                const t = cell(5);
                if (t) {
                    tier = Number(t);
                    if ([1, 2, 3].indexOf(tier) === -1) {
                        errs.push('Applies to tier must be 1, 2 or 3');
                        tier = 3;
                    }
                }
            }

            if (qRef) seen.add(qRef);
            const row = {
                sheet: sheetName, rowNo: n, qType: qType, qRef: qRef, qText: qText,
                dimensionCode: qType === 'tiering' ? code : null,
                domainCode: qType === 'control' ? code : null,
                score1: qType === 'tiering' ? (cell(3) || null) : null,
                score2: qType === 'tiering' ? (cell(4) || null) : null,
                score3: qType === 'tiering' ? (cell(5) || null) : null,
                evidenceRequired: qType === 'control' ? (cell(3) || null) : null,
                standardsMapping: qType === 'control' ? (cell(4) || null) : null,
                tierApplies: tier,
                rationale: cell(6) || null,
                errors: errs,
            };
            if (errs.length) problems.push(row); else rows.push(row);
        }
    };

    readSheet('Tiering', 'tiering');
    readSheet('Control', 'control');

    if (!rows.length && !problems.length) {
        throw Object.assign(
            new Error('No question rows were found. Fill the Tiering or Control sheet and try again.'),
            { code: 'NO_ROWS' });
    }
    return { rows: rows, problems: problems };
}

module.exports = {
    INTAKE_COLUMNS, VALID_POSITIONS,
    questionTemplate, parseQuestionTemplate,
    intakeTemplate, parseIntake,
    tieringPack, parseTieringPack,
    controlWorkbook, parseControlWorkbook,
    registerExport, mapColumns,
};
