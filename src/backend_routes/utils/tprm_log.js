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
 * Pulls a one-time code out of a message when there is one, so a code that is
 * only queued - driver=outbox never actually sends - can still be read off the
 * terminal. This is how the sign-in code is read during development: the mail
 * is written to tprm_mail_outbox and never leaves the machine, but the block
 * above prints the six digits and when they expire.
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
    const { mailId, kind, from, fromName, to, cc, subject, attachment,
        providerId, error, driver, expires } = info;

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
    if (otp) {
        console.log('   ' + dim('code'.padEnd(8)) + bold(yellow('  ' + otp + '  '))
            + (expires ? dim('  expires ' + expires) : ''));
    }

    if (stage === 'queued' && driver !== 'sendgrid') {
        console.log(field('note', dim('driver=outbox - stored in tprm_mail_outbox, not sent')));
    }
    if (providerId) console.log(field('id', dim(providerId)));
    if (error) console.log(field('error', red(error)));
}

/**
 * The sign-in code, printed to the terminal.
 *
 * Only reached while OTP_MAIL_DISABLED is in force in TPRM_Login_server.js -
 * the code is not being emailed, so this is the only place it exists in a form
 * a person can read. It prints unconditionally for that reason: gating it on
 * NODE_ENV would lock everyone out of a production build rather than degrade.
 * The banner says loudly that mail is off, so this cannot be mistaken for
 * ordinary behaviour.
 */
function logSignInCode({ empId, email, code, seconds }) {
    console.log('');
    console.log(RULE);
    console.log('\u{1F510} ' + bold('sign-in code') + ' ' + dim(time())
        + '   ' + yellow('OTP_MAIL_DISABLED'));
    console.log(field('account', (email || '-') + (empId ? dim('  (' + empId + ')') : '')));
    console.log('   ' + dim('code'.padEnd(8)) + bold(yellow('  ' + code + '  '))
        + (seconds ? dim('  expires in ' + seconds + 's') : ''));
    console.log(field('note', dim('mail is switched off - this is the only copy of the code')));
    console.log(RULE);
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

module.exports = { logMail, logError, logSignInCode, findOtp };
