// Thin wrapper kept for the `npm start` dev script. The real loop lives in
// commands/run.js and is shared with the packaged exe (mml-agent.exe run).
require('./commands/run').run();
