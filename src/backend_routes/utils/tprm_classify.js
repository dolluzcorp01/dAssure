// Suggests which sector questionnaire fits a supplier, from its name, service
// description and the client's own procurement category.
//
// The rules live in the classify_rule table, so adding a mapping is a row
// rather than a release.

const getDBConnection = require('../../../config/db');
const db = getDBConnection(process.env.DB_NAME || 'dtprm').promise();

let cache = null;
let cachedAt = 0;
const TTL_MS = 60_000;

async function rules() {
    if (cache && Date.now() - cachedAt < TTL_MS) return cache;
    const [rows] = await db.query(
        `SELECT sector_code, keyword, weight FROM classify_rule WHERE active = 1`
    );
    cache = rows;
    cachedAt = Date.now();
    return cache;
}

function resetCache() { cache = null; }

async function suggest({ vendorName, serviceDesc, spendCategory }) {
    const hay = [vendorName, serviceDesc, spendCategory].filter(Boolean).join(' ').toLowerCase();
    if (!hay.trim()) return { sector: null, confidence: 0, matched: [] };

    const score = {}, matched = {};
    for (const r of await rules()) {
        const kw = String(r.keyword).toLowerCase();
        if (!hay.includes(kw)) continue;
        score[r.sector_code] = (score[r.sector_code] || 0) + Number(r.weight);
        (matched[r.sector_code] = matched[r.sector_code] || []).push(r.keyword);
    }

    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return { sector: null, confidence: 0, matched: [] };

    const [top, topScore] = ranked[0];
    const second = ranked[1] ? ranked[1][1] : 0;
    // Confidence rises with absolute keyword strength AND with the gap to the
    // runner up. Two sectors tied at 24 points is a coin flip, not a match.
    const strength = Math.min(1, topScore / 30);
    const margin = topScore ? (topScore - second) / topScore : 1;
    const confidence = Math.round(Math.min(99, 55 + strength * 30 + margin * 14));

    return { sector: top, confidence, matched: matched[top] };
}

module.exports = { suggest, resetCache };
