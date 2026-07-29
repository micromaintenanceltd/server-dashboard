// MML Server Agent: single CLI entry point.
//
// This is the entry compiled into mml-agent.exe. One executable does everything
// via subcommands:
//
//   mml-agent.exe enroll --company "Acme" --api-url <url> --enroll-token <tok>
//       Self-register this server and write config.json. (Run by the installer.)
//
//   mml-agent.exe run
//       Start the reporting loop. (Run by the Windows service.)
//
//   mml-agent.exe once [--send]
//       Collect one report and print it; with --send also POST it. (Diagnostics.)
//
//   mml-agent.exe version | help

const log = require('./logger');

const AGENT_VERSION = require('../package.json').version;

function usage() {
  console.log(
    [
      `MML Server Agent v${AGENT_VERSION}`,
      '',
      'Usage:',
      '  mml-agent enroll --company "<name>" --api-url <url> --enroll-token <token> [--location "<loc>"] [--interval <min>]',
      '  mml-agent run',
      '  mml-agent once [--send]',
      '  mml-agent version',
      '',
    ].join('\n')
  );
}

async function main() {
  const [, , cmd, ...rest] = process.argv;

  switch ((cmd || '').toLowerCase()) {
    case 'enroll': {
      const { enroll } = require('./commands/enroll');
      await enroll(rest);
      break;
    }
    case 'run': {
      require('./commands/run').run();
      break;
    }
    case 'once': {
      const { once } = require('./commands/once');
      await once({ send: rest.includes('--send') });
      break;
    }
    case 'version':
    case '--version':
    case '-v':
      console.log(AGENT_VERSION);
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
    case '':
      usage();
      break;
    default:
      log.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(2);
  }
}

main().catch((err) => {
  log.error('Fatal:', err && err.message ? err.message : err);
  process.exit(1);
});
