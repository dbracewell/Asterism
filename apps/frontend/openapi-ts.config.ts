import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "http://localhost:8000/api/py/openapi.json",
  output: "src/lib/client",
  plugins: [
    "@hey-api/typescript",
    "@hey-api/client-fetch",
    "@tanstack/react-query",
    {
      name: "zod",
      dates: {
        local: true,
      },
    },
    {
      name: "@hey-api/sdk",
      // FastAPI emits upload parts as `contentMediaType`; the Zod generator
      // currently validates those as strings even though the generated TypeScript
      // type correctly uses File | Blob. Keep generated schemas for app forms,
      // but do not attach them as SDK transport validators.
      validator: false,
      operations: {
        strategy: "single",
        containerName: "ApiClient",
      },
    },
  ],
});
