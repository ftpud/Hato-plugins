import { usageMeter } from "@hato/sdk/usage-meter";
// Claude plan usage meter for the top/bottom bar. Presentation lives in sdk/usage-meter.ts.
export default usageMeter("claude-usage", "claude", "Claude", { command: "/usage", liveHint: "Live Claude chats also update the meter." });
