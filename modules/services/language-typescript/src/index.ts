import type { AppModule } from "@hato/sdk/types";
import { detectJsRuns, jsRunTypes } from "./run-configs";
export default {
  id: "language-typescript", moduleApiVersion: 1,
  methods: {
    "runConfigurations.types": () => jsRunTypes,
    "runConfigurations.detect": (_ctx, files) => detectJsRuns(files),
  },
} satisfies AppModule;
