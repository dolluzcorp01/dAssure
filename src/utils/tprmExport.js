// Themed Excel + PDF export helpers.
//
// Copied from dAdmin's src/utils/ticketExport.js so dTPRM exports carry the
// same house look as every other Dolluz Corp module: navy brand band, slate
// meta block, navy table header, zebra body rows. Nothing in here is specific
// to a module - each page passes its own columns and rows and gets identical
// chrome, and Excel and PDF share one palette so the two outputs match.
//
// Two deliberate departures from the dAdmin copy:
//   - the eagle watermark is dropped (it needs a second logo asset and an
//     async canvas pre-render; the house export spec does not include it)
//   - the status colour map is extended to the states TPRM actually uses

import ExcelJS from "exceljs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Palette - identical hex values across Excel + PDF.
const COL = {
    navy:   { argb: "FF0D1B2A", rgb: [13, 27, 42] },
    orange: { argb: "FFE8520A", rgb: [232, 82, 10] },
    sub:    { argb: "FFAABBCC", rgb: [170, 187, 204] },
    slate:  { argb: "FF64748B", rgb: [100, 116, 139] },
    line:   { argb: "FFE2E8F0", rgb: [226, 232, 240] },
    zebra:  { argb: "FFFAFBFD", rgb: [250, 251, 253] },
};

// The states TPRM actually uses, mapped onto the house colours. Green is
// "finished and stands", red is "will not proceed", blue is "live work",
// orange is everything still in flight.
const GREEN = ["closed", "approved", "paid", "completed", "published", "issued", "imported", "compliant"];
const RED = ["cancelled", "rejected", "non-compliant", "breached", "descoped"];
const BLUE = ["open", "in_progress", "in progress", "under_review", "under review", "emailed", "returned"];

function statusBucket(v) {
    const s = String(v == null ? "" : v).toLowerCase().trim();
    if (GREEN.includes(s)) return "green";
    if (RED.includes(s)) return "red";
    if (BLUE.includes(s)) return "blue";
    return "orange";
}
const statusArgb = (v) => ({ green: "FF15803D", red: "FFB91C1C", blue: "FF1D4ED8", orange: COL.orange.argb }[statusBucket(v)]);
const statusRgb = (v) => ({ green: [21, 128, 61], red: [185, 28, 28], blue: [29, 78, 216], orange: COL.orange.rgb }[statusBucket(v)]);

function fmtTs(d) {
    if (!d) return "";
    try {
        const x = new Date(d);
        return x.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    } catch { return String(d); }
}

// ── EXCEL ────────────────────────────────────────────────────────────
// columns: [{ key, label, width, wrap? }]
// rows:    [{ <key>: value, ... }]
// status field (optional): name of the column whose value should be
// colour-bolded in the body (Open=blue, Closed=green, Cancelled=red).
export async function exportThemedExcel({
    moduleName,       // e.g. "dAssist"
    sheetTitle,       // e.g. "Support Tickets"
    columns,
    rows,
    filterLabel,
    statusKey,
    filename,
}) {
    const wb = new ExcelJS.Workbook();
    wb.creator = `Dolluz Corp · ${moduleName}`;
    wb.created = new Date();
    const ws = wb.addWorksheet(sheetTitle);
    const cols = columns.length;

    ws.columns = columns.map(c => ({ key: c.key, width: c.width || 20 }));

    // Navy header band ("Dolluz Corp." + orange dot + "  moduleName")
    const brandRow = ws.addRow([]);
    ws.mergeCells(brandRow.number, 1, brandRow.number, cols);
    const brandCell = brandRow.getCell(1);
    brandCell.value = {
        richText: [
            { text: "Dolluz Corp",       font: { bold: true, color: { argb: "FFFFFFFF" }, size: 16, name: "Calibri" } },
            { text: ".",                 font: { bold: true, color: { argb: COL.orange.argb }, size: 16, name: "Calibri" } },
            { text: `    ${moduleName}`, font: { bold: true, color: { argb: COL.orange.argb }, size: 16, name: "Calibri" } },
        ],
    };
    brandCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COL.navy.argb } };
    brandCell.alignment = { vertical: "middle", indent: 1 };
    brandRow.height = 28;

    // Sub-band under the brand
    const subRow = ws.addRow([sheetTitle]);
    ws.mergeCells(subRow.number, 1, subRow.number, cols);
    const subCell = subRow.getCell(1);
    subCell.font = { color: { argb: COL.sub.argb }, size: 10, name: "Calibri" };
    subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COL.navy.argb } };
    subCell.alignment = { vertical: "middle", indent: 1 };
    subRow.height = 18;

    ws.addRow([]);

    // Meta block - filter (if any), generated timestamp, row count
    const metaRows = [
        ...(filterLabel ? [["Filter:",    filterLabel]] : []),
        ["Generated:", fmtTs(new Date().toISOString()) + " IST"],
        ["Rows:",      String(rows.length)],
    ];
    metaRows.forEach(([k, v]) => {
        const row = ws.addRow([k, v]);
        row.getCell(1).font = { color: { argb: COL.slate.argb }, size: 10 };
        row.getCell(2).font = { bold: true, color: { argb: COL.navy.argb }, size: 10 };
    });
    ws.addRow([]);

    // Table header
    const hdrRow = ws.addRow(columns.map(c => c.label));
    hdrRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10.5, name: "Calibri" };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COL.navy.argb } };
        cell.alignment = { vertical: "middle", indent: 1 };
        cell.border = { bottom: { style: "thin", color: { argb: COL.line.argb } } };
    });
    hdrRow.height = 22;

    // Body
    rows.forEach((r, i) => {
        const row = ws.addRow(r);
        row.eachCell((cell, col) => {
            cell.font = { color: { argb: COL.navy.argb }, size: 10, name: "Calibri" };
            if (i % 2 === 1) {
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COL.zebra.argb } };
            }
            cell.alignment = { vertical: "top", wrapText: !!columns[col - 1]?.wrap };
            cell.border = { bottom: { style: "hair", color: { argb: COL.line.argb } } };
        });
        if (statusKey && r[statusKey]) {
            const cell = row.getCell(statusKey);
            cell.font = { bold: true, color: { argb: statusArgb(r[statusKey]) }, size: 10 };
        }
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// ── PDF ──────────────────────────────────────────────────────────────
export function exportThemedPdf({
    moduleName,
    sheetTitle,
    columns,
    rows,
    filterLabel,
    statusKey,        // optional: colour-code this column's body cells
    filename,
}) {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a3" });
    const pageWidth = doc.internal.pageSize.getWidth();

    // Navy header band
    doc.setFillColor(...COL.navy.rgb);
    doc.rect(0, 0, pageWidth, 60, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text("Dolluz Corp", 28, 32);
    const wDol = doc.getTextWidth("Dolluz Corp");
    doc.setTextColor(...COL.orange.rgb);
    doc.text(".", 28 + wDol, 32);
    const wDot = doc.getTextWidth(".");
    doc.text(`    ${moduleName}`, 28 + wDol + wDot, 32);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...COL.sub.rgb);
    doc.text(sheetTitle, 28, 50);

    // Meta lines
    let metaY = 86;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    if (filterLabel) {
        doc.setTextColor(...COL.slate.rgb);
        doc.text("Filter:", 28, metaY);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...COL.navy.rgb);
        doc.text(filterLabel, 70, metaY);
        doc.setFont("helvetica", "normal");
        metaY += 14;
    }
    doc.setTextColor(...COL.slate.rgb);
    doc.text("Generated:", 28, metaY);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COL.navy.rgb);
    doc.text(fmtTs(new Date().toISOString()) + " IST", 90, metaY);
    metaY += 14;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COL.slate.rgb);
    doc.text("Rows:", 28, metaY);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...COL.navy.rgb);
    doc.text(String(rows.length), 70, metaY);

    // Table. Fill the full page width and let columns auto-size to at least
    // their header/content width, so single-word headers ("Downloaded",
    // "Deductions") never wrap/cut in half. pdfWidth is used only as a minimum
    // hint - columns grow beyond it to fill the page.
    const tableWidth = pageWidth - 56;   // 28pt margin each side
    autoTable(doc, {
        startY: metaY + 12,
        margin: { left: 28, right: 28 },
        tableWidth,
        head: [columns.map(c => c.label)],
        body: rows.map(r => columns.map(c => (r[c.key] == null ? "" : String(r[c.key])))),
        theme: "plain",
        styles: {
            font: "helvetica",
            fontSize: 9.5,
            cellPadding: { top: 7, right: 9, bottom: 7, left: 9 },
            textColor: COL.navy.rgb,
            lineColor: COL.line.rgb,
            lineWidth: 0.4,
            valign: "middle",
            overflow: "linebreak",
        },
        headStyles: {
            fillColor: COL.navy.rgb,
            textColor: [255, 255, 255],
            fontStyle: "bold",
            fontSize: 10.5,
            halign: "left",
            valign: "middle",
            cellPadding: { top: 9, right: 9, bottom: 9, left: 9 },
            lineWidth: 0,
        },
        bodyStyles: { minCellHeight: 20 },
        alternateRowStyles: { fillColor: COL.zebra.rgb },
        columnStyles: columns.reduce((acc, c, i) => {
            const st = {};
            if (c.pdfWidth) st.minCellWidth = c.pdfWidth;   // minimum, not a hard cap
            if (c.align) st.halign = c.align;
            if (Object.keys(st).length) acc[i] = st;
            return acc;
        }, {}),
        // Colour-code the status column body cells (matches the Excel look).
        didParseCell(data) {
            if (!statusKey || data.section !== "body") return;
            if (columns[data.column.index]?.key !== statusKey) return;
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.textColor = statusRgb(data.cell.raw);
        },
    });

    doc.save(filename);
}
