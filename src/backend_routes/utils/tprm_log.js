// Terminal output for the two things you actually watch a server log for:
// what mail went out, and what broke.
//
// Both are printed as a small labelled block rather than a dumped object. A
// mysql2 error object stringifies to forty lines of connection internals and
// buries the one line that matters, so we pull out the code, the message and
// the offending SQL and show those.

const ESC = String.fromCharCode(27);
// Colour only when a human is watching. Piping to a file, or NO_COLOR, or a
// CI runner all get plain text.
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (COLOR ? ESC + '[' + code + 'm' + s + ESC + '[0m' : String(s));
const dim = s => c('90', s);
const red = s => c('31', s);
const yellow = s => c('33', s);
const cyan = s => c('36', s);
const green = s => c('32', s);
const bold = s => c('1', s);

const RULE = dim('-'.repeat(72));
const time = () => new Date().toTimeString().slice(0, 8);

/** Aligns the label column so the values line up under each other. */
const field = (label, value) => '   ' + dim(label.padEnd(8)) + value;

/** A mail address list can be an array, a comma string, or nothing. */
const list = v => {
    if (!v) return dim('-');
    return (Array.isArray(v) ? v : String(v).split(',')).map(x => x.trim()).filter(Boolean).join(', ') || dim('-');
};

/**
 * Pulls a one-time code out of a message when there is one. dTprm has no OTP
 * flow today - login is password only - so this never fires yet. It is here so
 * that the moment an OTP mail is added, the code shows up in the terminal
 * instead of having to be read out of the database.
 */
function findOtp({ kind, subject, body }) {
    const text = [subject, body].filter(Boolean).join(' ');
    const mentionsCode = /\b(otp|one[\s-]?time|verification\s+code|security\s+code|passcode|auth(entication)?\s+code)\b/i;
    if (!/otp|verify|verification/i.test(String(kind || '')) && !mentionsCode.test(text)) return null;
    const m = text.match(/\b(\d{4,8})\b/);
    return m ? m[1] : null;
}

/**
 * One block per mail, at each state change.
 *   stage: 'queued' | 'sent' | 'failed'
 */
function logMail(stage, info) {
    const { mailId, kind, from, fromName, to, cc, subject, attachment, providerId, error, driver } = info;

    const tag = stage === 'sent' ? green('sent  ')
        : stage === 'failed' ? red('failed')
            : yellow('queued');
    const id = mailId ? dim('#' + mailId) : '';

    console.log('');
    console.log(`📧 ${bold('mail')} ${tag} ${id} ${kind ? dim('[') + cyan(kind) + dim(']') : ''} ${dim(time())}`);
    console.log(field('from', fromName ? `${fromName} <${from}>` : String(from)));
    console.log(field('to', list(to)));
    if (cc) console.log(field('cc', list(cc)));
    console.log(field('subject', subject || dim('-')));
    if (attachment) console.log(field('attach', attachment));

    const otp = findOtp(info);
    if (otp) console.log('   ' + dim('code'.padEnd(8)) + bold(yellow('  ' + otp + '  ')));

    if (stage === 'queued' && driver !== 'sendgrid') {
        console.log(field('note', dim('driver=outbox - stored in tprm_mail_outbox, not sent')));
    }
    if (providerId) console.log(field('id', dim(providerId)));
    if (error) console.log(field('error', red(error)));
}

/**
 * One block per backend error. `req` is optional - pass it wherever it is in
 * scope so the log says which call failed and who made it.
 */
function logError(label, err, req) {
    const e = err || {};
    console.log('');
    console.log(RULE);
    console.log(`❌ ${bold(red('error'))} ${bold(label)} ${dim(time())}`);

    if (req && req.method) {
        console.log(field('route', `${req.method} ${req.originalUrl || req.url}`));
        if (req.emp_id) console.log(field('user', String(req.emp_id)));
        if (req.tenantId) console.log(field('client', String(req.tenantId)));
    }

    // mysql2 puts the useful part in code/errno/sqlMessage, not in .message
    if (e.code) console.log(field('code', red(e.code) + (e.errno ? dim(' (' + e.errno + ')') : '')));
    console.log(field('message', e.sqlMessage || e.message || String(e)));
    if (e.sql) console.log(field('sql', dim(String(e.sql).replace(/\s+/g, ' ').slice(0, 220))));

    // Only our own frames. node_internals and node_modules are never the bug.
    const frames = String(e.stack || '').split('\n').slice(1)
        .filter(l => l.includes(process.cwd()) && !l.includes('node_modules'))
        .slice(0, 4)
        .map(l => l.trim().replace(process.cwd(), '').replace(/^at\s+/, ''));
    frames.forEach((f, i) => console.log(field(i === 0 ? 'at' : '', f)));

    console.log(RULE);
}

module.exports = { logMail, logError, findOtp };
