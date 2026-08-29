// =====================================================================
//  The methodology, in one place.
//  Every scoring rule lives here and nowhere else, so a change to how risk
//  is calculated is a change to this file only.
// =====================================================================

const POSITIONS = [
    'Compliant', 'Partially Compliant', 'Non-Compliant', 'Not Evidenced', 'Not Applicable'
];

// An unevidenced assertion scores 1, never 2. "We do MFA" with no proof is
// worth exactly as much as "we half do MFA".
const POSITION_SCORE = {
    'Compliant': 2,
    'Partially Compliant': 1,
    'Non-Compliant': 0,
    'Not Evidenced': 1,
    'Not Applicable': null,      // excluded from the denominator entirely
};

const DEFAULT_DIMENSION_WEIGHTS = { DATA: 0.28, ACCESS: 0.24, CRIT: 0.24, CHAIN: 0.14, REG: 0.10 };
const DEFAULT_TIER1 = 2.30;
const DEFAULT_TIER2 = 1.60;
const DEFAULT_SLA = { Critical: 14, High: 30, Medium: 60, Low: 90 };

// Reassessment cadence by tier, in months.
const CADENCE_MONTHS = { 1: 12, 2: 24, 3: 36 };

/**
 * Weighted inherent risk from the tiering answers.
 * @param answers [{ dimension_code, tiering_score }] where score is 1..3
 */
function inherentScore(answers, weights = DEFAULT_DIMENSION_WEIGHTS) {
    const byDim = {};
    for (const a of answers) {
        if (a.tiering_score === null || a.tiering_score === undefined) continue;
        (byDim[a.dimension_code] = byDim[a.dimension_code] || []).push(Number(a.tiering_score));
    }
    let total = 0, wsum = 0;
    for (const [dim, w] of Object.entries(weights)) {
        const vals = byDim[dim];
        if (!vals || !vals.length) continue;
        const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
        total += mean * w;
        wsum += w;
    }
    if (!wsum) return null;
    return Number((total / wsum).toFixed(2));
}

function tierFor(score, t1 = DEFAULT_TIER1, t2 = DEFAULT_TIER2) {
    if (score === null || score === undefined) return null;
    if (score >= t1) return 1;
    if (score >= t2) return 2;
    return 3;
}

/**
 * Control effectiveness, weighted by control area rather than averaged flat,
 * so a weak access area is not cancelled out by a strong policy area.
 * @param responses [{ domain_code, position }]
 * @param domainWeights { GOV: 8, IAM: 13, ... }
 */
function effectiveness(responses, domainWeights) {
    const byDom = {};
    for (const r of responses) {
        const s = POSITION_SCORE[r.position];
        if (s === null || s === undefined) continue;
        const d = byDom[r.domain_code] || (byDom[r.domain_code] = { got: 0, max: 0 });
        d.got += s;
        d.max += 2;
    }
    let num = 0, den = 0;
    for (const [dom, agg] of Object.entries(byDom)) {
        if (!agg.max) continue;
        const w = (domainWeights && domainWeights[dom]) || 1;
        num += (agg.got / agg.max) * w;
        den += w;
    }
    if (!den) return null;
    return Number((num / den).toFixed(4));
}

/** Residual risk is derived, never estimated. */
function residual(inherent, eff) {
    if (inherent === null || eff === null || inherent === undefined || eff === undefined) return null;
    return Number((inherent * (1 - eff)).toFixed(2));
}

function residualBand(r) {
    if (r === null || r === undefined) return null;
    if (r >= 1.60) return 'CRITICAL';
    if (r >= 0.90) return 'HIGH';
    if (r >= 0.40) return 'MEDIUM';
    return 'LOW';
}

/** Severity of a finding raised from a control position, scaled by tier. */
function severityFor(position, tier) {
    if (position === 'Non-Compliant') return tier === 1 ? 'Critical' : tier === 2 ? 'High' : 'Medium';
    if (position === 'Not Evidenced') return tier === 1 ? 'High' : 'Medium';
    if (position === 'Partially Compliant') return tier === 1 ? 'Medium' : 'Low';
    return null;
}

/** tier_applies: 1 = Tier 1 only, 2 = Tier 1 and 2, 3 = every tier. */
const inScopeForTier = (tierApplies, tier) => Number(tierApplies) >= Number(tier);

/** JSON columns come back as a string on some MySQL/driver combinations. */
function jsonOf(value, fallback) {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return fallback; }
}

module.exports = {
    POSITIONS, POSITION_SCORE,
    DEFAULT_DIMENSION_WEIGHTS, DEFAULT_TIER1, DEFAULT_TIER2, DEFAULT_SLA, CADENCE_MONTHS,
    inherentScore, tierFor, effectiveness, residual, residualBand, severityFor,
    inScopeForTier, jsonOf,
};
