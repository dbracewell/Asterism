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
      validator: true,
      operations: {
        strategy: "single",
        containerName: "ApiClient",
      },
    },
  ],
});
