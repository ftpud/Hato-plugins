// cloud-activity: runs inside the workspace daemon. The Cloud connector (`hato cloud connect`)
// polls `snapshot` over the local daemon socket and forwards it to Hato Cloud with the host
// credential, which never enters this module.
//
// Privacy rule: export only allowlisted metadata (ids, names, coarse state, timestamps, provider
// label). Never prompts, transcripts, tool input/output, errors' free text, paths or env.
import type { AppModule } from "@hato/sdk/types";
import { activityItems, type RunnerSession, type Remembered } from "./map";

const remembered = new Map<string, Remembered>();

const mod: AppModule = {
  id: "cloud-activity",
  moduleApiVersion: 1,
  async activate() {},
  methods: {
    /** `{ items }` — current agent sessions plus recently finished ones (bounded). */
    async snapshot(ctx) {
      const sessions = await ctx.modules.call<RunnerSession[]>("agent-runner", "list", {}, { timeoutMs: 10000 });
      return { items: activityItems(sessions, remembered, new Date().toISOString()) };
    },
  },
};
export default mod;
