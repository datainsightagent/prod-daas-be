import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DAAS_AI_KB_ENABLED: "false",
      ONBOARDING_AI_SERVICE_ENABLED: "false",
      TENANT_DB_READ_WRITE_ENABLED: "false",
    },
  },
});
