import { usageMeter } from '@hato/sdk/usage-meter';

// Native OpenCode Go plan usage. The shared ACP service invokes the provider's
// module-backed probe and publishes acp.limits for the Assistant rail gauges.
export default usageMeter('opencode-usage', 'opencode', 'OpenCode', {
  command: 'opencode api experimental.usage.limits',
  liveHint: 'Model-free workspace API probe; no ACP session or model request.',
});
