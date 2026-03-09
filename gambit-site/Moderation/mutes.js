// =============================================
// GAMBIT.GG — MUTE SYSTEM
// Moderation/mutes.js
// Logs all mutes to Moderation/mutes.txt
// =============================================

const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'mutes.txt');

// In-memory store: userId → mute record
const mutes = {};

function parseDuration(dur) {
  if (!dur || dur === 'perm') return null;
  const map = { '5m':300000,'1h':3600000,'6h':21600000,'24h':86400000,'7d':604800000,'30d':2592000000 };
  const ms = map[dur];
  return ms ? Date.now() + ms : null;
}

function timestamp() {
  return new Date().toISOString().replace('T',' ').slice(0,19);
}

function writeLine(line) {
  fs.appendFile(FILE, line + '\n', err => {
    if (err) console.error('[Mutes] Failed to write log:', err.message);
    else console.log('[Mutes] Log written to', FILE);
  });
}

// Add a mute and log it to mutes.txt
function add(targetId, { username = '', mutedBy = '', duration = '1h' } = {}) {
  const tid    = String(targetId);
  const expiry = parseDuration(duration);
  const record = { userId: tid, username, mutedBy, duration, expiry, mutedAt: Date.now() };
  mutes[tid] = record;

  const durText    = duration === 'perm' ? 'Permanent' : duration;
  const expiryText = expiry ? new Date(expiry).toISOString().replace('T',' ').slice(0,19) + ' UTC' : 'Never';
  const line =
    '----------------------------------------\n' +
    'Action   : MUTE\n' +
    'Time     : ' + timestamp() + ' UTC\n' +
    'User     : ' + username + ' (ID: ' + tid + ')\n' +
    'Muted By : ' + mutedBy + '\n' +
    'Duration : ' + durText + '\n' +
    'Expires  : ' + expiryText + '\n' +
    '----------------------------------------';

  writeLine(line);
}

// Returns true if currently muted (auto-removes expired)
function check(userId) {
  const m = mutes[String(userId)];
  if (!m) return false;
  if (m.expiry && Date.now() > m.expiry) {
    delete mutes[String(userId)];
    return false;
  }
  return true;
}

function get(userId) {
  if (!check(userId)) return null;
  return mutes[String(userId)] || null;
}

function remove(userId) {
  const tid = String(userId);
  if (mutes[tid]) {
    const m = mutes[tid];
    writeLine(
      '----------------------------------------\n' +
      'Action   : UNMUTE\n' +
      'Time     : ' + timestamp() + ' UTC\n' +
      'User     : ' + m.username + ' (ID: ' + tid + ')\n' +
      '----------------------------------------'
    );
  }
  delete mutes[tid];
}

function list() {
  const now = Date.now();
  const active = {};
  Object.keys(mutes).forEach(id => {
    const m = mutes[id];
    if (!m.expiry || now <= m.expiry) active[id] = m;
    else delete mutes[id];
  });
  return active;
}

module.exports = { add, check, get, remove, list };
