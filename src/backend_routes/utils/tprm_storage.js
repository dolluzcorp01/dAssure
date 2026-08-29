// Evidence and generated workbooks on local disk, under TPRM_STORAGE_DIR.
// Keys are relative paths, so moving to DigitalOcean Spaces later means
// swapping the three functions at the bottom and nothing else.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_DIR = process.env.TPRM_STORAGE_DIR
    || path.join(__dirname, '..', '..', '..', 'TPRM_file_uploads');

/** Date-bucketed, randomised, filename-sanitised key. Prevents collisions and
 *  stops a supplier-supplied filename from escaping the storage folder. */
function keyFor(scope, filename) {
    const stamp = new Date().toISOString().slice(0, 10);
    const rand = crypto.randomBytes(6).toString('hex');
    const safe = String(filename || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    return `${scope}/${stamp}/${rand}_${safe}`;
}

function fullPath(key) {
    const full = path.resolve(STORAGE_DIR, key);
    // Defence in depth: never let a key traverse out of the storage root.
    if (!full.startsWith(path.resolve(STORAGE_DIR))) {
        throw new Error('Refusing to touch a path outside the storage directory');
    }
    return full;
}

function put(key, buffer) {
    const full = fullPath(key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
    return {
        key,
        bytes: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    };
}

function get(key) {
    const full = fullPath(key);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full);
}

function remove(key) {
    const full = fullPath(key);
    if (fs.existsSync(full)) fs.unlinkSync(full);
}

module.exports = { keyFor, put, get, remove, STORAGE_DIR };
