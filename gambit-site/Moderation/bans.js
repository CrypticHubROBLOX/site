// =============================================
// GAMBIT.GG — BAN SYSTEM
// Moderation/bans.js
// Logs all bans to Moderation/bans.txt
// =============================================

const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'bans.txt');

// In-memory store: userId → ban record
const bans = {};

function parseDuration(dur) {
  if (!dur || dur === 'perm') return null;
  const map = { '1h':3600000,'6h':21600000,'24h':86400000,'7d':604800000,'30d':2592000000 };
  const ms = map[dur];
  return ms ? Date.now() + ms : null;
}

function timestamp() {
  return new Date().toISOString().replace('T',' ').slice(0,19);
}

function writeLine(line) {
  fs.appendFile(FILE, line + '\n', err => {
    if (err) console.error('[Bans] Failed to write log:', err.message);
    else console.log('[Bans] Log written to', FILE);
  });
}

// Add a ban and log it to bans.txt
function add(targetId, { username = '', bannedBy = '', reason = 'No reason provided', duration = 'perm' } = {}) {
  const tid    = String(targetId);
  const expiry = parseDuration(duration);
  const record = { userId: tid, username, bannedBy, reason, duration, expiry, bannedAt: Date.now() };
  bans[tid] = record;

  const durText  = duration === 'perm' ? 'Permanent' : duration;
  const expiryText = expiry ? new Date(expiry).toISOString().replace('T',' ').slice(0,19) + ' UTC' : 'Never';
  const line =
    '----------------------------------------\n' +
    'Action   : BAN\n' +
    'Time     : ' + timestamp() + ' UTC\n' +
    'User     : ' + username + ' (ID: ' + tid + ')\n' +
    'Banned By: ' + bannedBy + '\n' +
    'Reason   : ' + reason + '\n' +
    'Duration : ' + durText + '\n' +
    'Expires  : ' + expiryText + '\n' +
    '----------------------------------------';

  writeLine(line);
}

// Returns true if currently banned (auto-removes expired)
function check(userId) {
  const b = bans[String(userId)];
  if (!b) return false;
  if (b.expiry && Date.now() > b.expiry) {
    delete bans[String(userId)];
    return false;
  }
  return true;
}

function get(userId) {
  if (!check(userId)) return null;
  return bans[String(userId)] || null;
}

function remove(userId) {
  const tid = String(userId);
  if (bans[tid]) {
    const b = bans[tid];
    writeLine(
      '----------------------------------------\n' +
      'Action   : UNBAN\n' +
      'Time     : ' + timestamp() + ' UTC\n' +
      'User     : ' + b.username + ' (ID: ' + tid + ')\n' +
      '----------------------------------------'
    );
  }
  delete bans[tid];
}

function list() {
  const now = Date.now();
  const active = {};
  Object.keys(bans).forEach(id => {
    const b = bans[id];
    if (!b.expiry || now <= b.expiry) active[id] = b;
    else delete bans[id];
  });
  return active;
}

module.exports = { add, check, get, remove, list };
