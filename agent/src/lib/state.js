// Small persisted state for the agent (currently just the last weekly check
// slot we ran). Stored as state.json next to config.json so it survives service
// restarts and reboots.

const fs = require('fs');
const path = require('path');
const { configDir } = require('../config');

function statePath() {
  return path.join(configDir(), 'state.json');
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2) + '\n', 'utf8');
  } catch {
    // Non-fatal: if we cannot persist, the worst case is a check runs again.
  }
}

module.exports = { readState, writeState, statePath };
