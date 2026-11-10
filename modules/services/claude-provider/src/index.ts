import { parseClaudeUsage, applyClaudeRateLimit } from '@hato/sdk/usage-limits';
import type { LimitsSnapshot } from '@hato/sdk/usage-limits';
import type { AppModule } from '@hato/sdk/types';
export default {
  id: 'claude-provider', moduleApiVersion: 1,
  methods: {
    parseLimits(_ctx, a) {
      const parsed = parseClaudeUsage(a.text);
      let result: LimitsSnapshot = { provider: 'claude', ...parsed, updatedAt: Date.now(), source: 'probe', error: null };
      const rate = a.updates?.map((u: any) => u?._meta?.['_claude/rateLimit']).filter(Boolean).pop();
      if (!result.windows.length && rate) result = { ...applyClaudeRateLimit(null, rate)!, source: 'probe' };
      return result;
    },
    sessionLimits(_ctx, a) {
      const rate = a.update?._meta?.['_claude/rateLimit'];
      return rate ? applyClaudeRateLimit(a.previous, rate) : null;
    },
  },
} satisfies AppModule;
