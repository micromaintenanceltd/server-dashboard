// Thin wrapper kept for the `npm run once` dev script. Real logic in
// commands/once.js, shared with the packaged exe (mml-agent.exe once).
require('./commands/once').once({ send: process.argv.includes('--send') });
