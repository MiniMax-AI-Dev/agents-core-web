import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

import { loadProxyBearerAuth } from "./vite-auth.ts";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, repositoryRoot, "");
  const target = env.AGENTS_API_PROXY_TARGET ?? "http://127.0.0.1:8091";
  const proxyAuth = command === "serve" && mode !== "test"
    ? loadProxyBearerAuth({
        token: env.AGENTS_API_PROXY_TOKEN,
        tokenFile: env.AGENTS_API_PROXY_TOKEN_FILE,
        rootDir: repositoryRoot,
      })
    : undefined;

  return {
    define: {
      __AGENTS_CORE_WEB_DEV_PROXY_AUTH__: JSON.stringify(Boolean(proxyAuth)),
    },
    envDir: repositoryRoot,
    plugins: [react()],
    server: {
      proxy: {
        "/v1": {
          target,
          changeOrigin: true,
          configure(proxy) {
            if (!proxyAuth) return;
            proxy.on("proxyReq", (proxyRequest) => {
              proxyRequest.setHeader("authorization", `Bearer ${proxyAuth.token}`);
            });
          },
        },
      },
    },
  };
});
