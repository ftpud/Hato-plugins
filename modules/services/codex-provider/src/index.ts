import { parseCodexStatus } from '@hato/sdk/usage-limits';
import type { AppModule } from '@hato/sdk/types';
export default {
  id: 'codex-provider', moduleApiVersion: 1,
  methods: {
    parseLimits: (_ctx, a) => ({ provider: 'codex', ...parseCodexStatus(a.text), updatedAt: Date.now(), source: 'probe', error: null }),
    sessionLimits: () => null,
  },
} satisfies AppModule;
