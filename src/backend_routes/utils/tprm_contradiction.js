// Cross-question consistency. A declaration contradicted by an answer
// elsewhere in the same questionnaire is escalated to the assessor, never
// quietly averaged into the score.

const getDBConnection = require('../../../config/db');
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();

/** Returns the rules that currently fire for an assessment. */
async function evaluate(assessmentId, instrumentVersionId) {
    const [rows] = await db.query(
        `SELECT q_ref, position FROM response
          WHERE assessment_id = ? AND q_type = 'control' AND position IS NOT NULL`,
        [assessmentId]
    );
    const pos = {};
    rows.forEach(r => { pos[r.q_ref] = r.position; });

    const [ruleRows] = await db.query(
        `SELECT rule_id, ref_a, positions_a, ref_b, positions_b, message
           FROM contradiction_rule
          WHERE active = 1 AND (instrument_version_id IS NULL OR instrument_version_id = ?)`,
        [instrumentVersionId]
    );

    const hits = [];
    for (const rule of ruleRows) {
        const a = pos[rule.ref_a], b = pos[rule.ref_b];
        if (!a || !b) continue;
        const setA = rule.positions_a.split('|').map(s => s.trim());
        const setB = rule.positions_b.split('|').map(s => s.trim());
        if (setA.includes(a) && setB.includes(b)) {
            hits.push({
                rule_id: rule.rule_id,
                refs: `${rule.ref_a} vs ${rule.ref_b}`,
                message: rule.message,
            });
        }
    }
    return hits;
}

/**
 * Refresh the stored flags: raise new ones, leave anything an assessor has
 * already escalated or resolved alone, and clear open flags that no longer
 * apply because the answer changed.
 */
async function refresh(assessmentId, instrumentVersionId) {
    const hits = await evaluate(assessmentId, instrumentVersionId);
    const [existing] = await db.query(
        `SELECT flag_id, refs_label, state FROM contradiction_flag WHERE assessment_id = ?`,
        [assessmentId]
    );
    const live = new Set(hits.map(h => h.refs));

    for (const h of hits) {
        if (!existing.find(o => o.refs_label === h.refs)) {
            await db.query(
                `INSERT INTO contradiction_flag (assessment_id, rule_id, refs_label, message)
                 VALUES (?,?,?,?)`,
                [assessmentId, h.rule_id, h.refs, h.message]
            );
        }
    }
    for (const o of existing) {
        if (!live.has(o.refs_label) && o.state === 'open') {
            await db.query(`DELETE FROM contradiction_flag WHERE flag_id = ?`, [o.flag_id]);
        }
    }

    const [out] = await db.query(
        `SELECT * FROM contradiction_flag WHERE assessment_id = ? ORDER BY flag_id`,
        [assessmentId]
    );
    return out;
}

module.exports = { evaluate, refresh };
