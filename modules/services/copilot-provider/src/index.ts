import type { AppModule } from '@hato/sdk/types';

// Copilot CLI implements ACP directly. Hato's shared services own workspace routing,
// process setup, sessions, MCP, model discovery and trusted permission handling.
export default { id: 'copilot-provider', moduleApiVersion: 1 } satisfies AppModule;
