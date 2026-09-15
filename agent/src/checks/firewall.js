// Check: Windows Firewall enabled on all profiles (Domain, Private, Public).
// Any disabled profile is a warning.

const { runPsJson, toArray } = require('../lib/powershell');

module.exports = {
  id: 'firewall',
  title: 'Windows Firewall',
  configKey: 'firewall',
  defaultEnabled: true,

  async run() {
    const script =
      'Get-NetFirewallProfile -ErrorAction SilentlyContinue | ' +
      'Select-Object Name, Enabled | ConvertTo-Json -Compress';
    const raw = await runPsJson(script, { fallback: null });
    const profiles = toArray(raw).filter((p) => p && p.Name);

    if (profiles.length === 0) {
      return { status: 'warn', detail: 'Could not read firewall profiles.', value: null };
    }

    // Enabled may serialise as boolean, 'True'/'False', or 1/0.
    const isOn = (v) => v === true || v === 1 || v === 'True' || v === '1';
    const disabled = profiles.filter((p) => !isOn(p.Enabled)).map((p) => p.Name);

    if (disabled.length > 0) {
      return {
        status: 'warn',
        detail: `Firewall disabled on: ${disabled.join(', ')}.`,
        value: profiles,
      };
    }
    return { status: 'pass', detail: 'Firewall enabled on all profiles.', value: profiles };
  },
};
