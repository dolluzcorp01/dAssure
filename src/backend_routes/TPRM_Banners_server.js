// Login banners.
//
// Banners are global, not per client, so nothing here calls requireTenant.
// tenantScope still runs on the authenticated routes because requirePerm needs
// req.grants to answer at all.

require("dotenv").config({ quiet: true });
const express = require("express");
const getDBConnection = require('../../config/db');
const { verifyJWT } = require('./TPRM_Login_server');
const { audit, tenantScope, requirePerm , permitted } = require('./utils/tprm_audit');
const { logError } = require('./utils/tprm_log');

const router = express.Router();
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();

const HEX = /^#[0-9A-Fa-f]{6}$/;

/* ------------------------------------------------------------------ public */
// No verifyJWT: the sign-in screen calls this before anyone has signed in.
// It returns only the six columns already painted on that screen, and nothing
// that would tell an anonymous caller anything else about the system.
router.get("/public", async (_req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT banner_id, tag_label, headline, subline, gradient_from, gradient_to
               FROM banner WHERE active = 1 ORDER BY sort_order, banner_id`);
        res.json(rows);
    } catch (e) {
        logError('public banners', e, _req);
        // The sign-in screen has to render even with the database down, so an
        // empty list rather than a 500. The client falls back to its own copy.
        res.json([]);
    }
});

/* ------------------------------------------------- authenticated from here */
router.use(verifyJWT, tenantScope);

router.get("/", requirePerm('banner.manage'), async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT banner_id, tag_label, headline, subline, gradient_from, gradient_to,
                    sort_order, active, created_by, created_time, edited_by, edited_time
               FROM banner ORDER BY sort_order, banner_id`);
        res.json(rows);
    } catch (e) {
        logError('banners list', e, req);
        res.status(500).json({ error: "Database error" });
    }
});

function validate(body, { partial = false } = {}) {
    const errs = [];
    if (!partial || body.headline !== undefined) {
        if (!body.headline || !String(body.headline).trim()) {
            errs.push({ field: 'headline', message: 'A headline is required' });
        } else if (String(body.headline).length > 160) {
            errs.push({ field: 'headline', message: 'Maximum 160 characters' });
        }
    }
    if (body.subline && String(body.subline).length > 400) {
        errs.push({ field: 'subline', message: 'Maximum 400 characters' });
    }
    if (body.tagLabel && String(body.tagLabel).length > 40) {
        errs.push({ field: 'tagLabel', message: 'Maximum 40 characters' });
    }
    for (const k of ['gradientFrom', 'gradientTo']) {
        if (body[k] && !HEX.test(body[k])) {
            errs.push({ field: k, message: 'Use a 6 digit hex colour, for example #0E1A2B' });
        }
    }
    return errs;
}

router.post("/", requirePerm('banner.manage'), async (req, res) => {
    try {
        const errs = validate(req.body);
        if (errs.length) {
            return res.status(400).json({
                error: "VALIDATION", message: "That banner cannot be saved", details: errs });
        }
        const { tagLabel, headline, subline, gradientFrom, gradientTo } = req.body;
        const [[m]] = await db.query(`SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM banner`);
        const [r] = await db.query(
            `INSERT INTO banner
               (tag_label, headline, subline, gradient_from, gradient_to, sort_order, created_by)
             VALUES (?,?,?,?,?,?,?)`,
            [tagLabel || null, String(headline).trim(), subline || null,
             gradientFrom || '#0D1B2A', gradientTo || '#16334F',
             req.body.sortOrder != null ? Number(req.body.sortOrder) : m.n, req.emp_id]);
        await audit(req, {
            action: 'banner.created', entity: 'banner', entityId: r.insertId,
            after: { headline, gradientFrom, gradientTo } });
        res.json({ success: true, banner_id: r.insertId });
    } catch (e) {
        logError('banner create', e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.put("/:id", requirePerm('banner.manage'), async (req, res) => {
    try {
        const [[before]] = await db.query(
            `SELECT * FROM banner WHERE banner_id = ?`, [req.params.id]);
        if (!before) return res.status(404).json({ error: "NOT_FOUND", message: "No such banner" });

        // Deactivating is the only edit that can empty the sign-in screen.
        if (req.body.active === false && before.active) {
            const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM banner WHERE active = 1`);
            if (n <= 1) {
                return res.status(409).json({
                    error: "LAST_BANNER",
                    message: "At least one banner must stay active, or the sign-in screen has nothing to show.",
                });
            }
        }
        const errs = validate(req.body, { partial: true });
        if (errs.length) {
            return res.status(400).json({
                error: "VALIDATION", message: "That banner cannot be saved", details: errs });
        }

        const b = req.body;
        await db.query(
            `UPDATE banner SET
               tag_label     = COALESCE(?, tag_label),
               headline      = COALESCE(?, headline),
               subline       = COALESCE(?, subline),
               gradient_from = COALESCE(?, gradient_from),
               gradient_to   = COALESCE(?, gradient_to),
               sort_order    = COALESCE(?, sort_order),
               active        = COALESCE(?, active),
               edited_by     = ?
             WHERE banner_id = ?`,
            [b.tagLabel ?? null, b.headline ?? null, b.subline ?? null,
             b.gradientFrom ?? null, b.gradientTo ?? null,
             b.sortOrder == null ? null : Number(b.sortOrder),
             b.active === undefined ? null : (b.active ? 1 : 0),
             req.emp_id, req.params.id]);

        await audit(req, {
            action: 'banner.updated', entity: 'banner', entityId: Number(req.params.id),
            before: { headline: before.headline, active: before.active }, after: b });
        res.json({ success: true });
    } catch (e) {
        logError('banner update', e, req);
        res.status(500).json({ error: "Database error" });
    }
});

router.delete("/:id", requirePerm('banner.manage'), async (req, res) => {
    try {
        const [[before]] = await db.query(
            `SELECT * FROM banner WHERE banner_id = ?`, [req.params.id]);
        if (!before) return res.status(404).json({ error: "NOT_FOUND", message: "No such banner" });

        // Same rule as deactivating: the sign-in screen must keep one.
        if (before.active) {
            const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM banner WHERE active = 1`);
            if (n <= 1) {
                return res.status(409).json({
                    error: "LAST_BANNER",
                    message: "That is the only active banner. Activate another before deleting this one.",
                });
            }
        }
        await db.query(`DELETE FROM banner WHERE banner_id = ?`, [req.params.id]);
        await audit(req, {
            action: 'banner.deleted', entity: 'banner', entityId: Number(req.params.id),
            before: { headline: before.headline, tag_label: before.tag_label } });
        res.json({ success: true });
    } catch (e) {
        logError('banner delete', e, req);
        res.status(500).json({ error: "Database error" });
    }
});

module.exports = router;
