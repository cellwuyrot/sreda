import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Изолированная проверка VPN: не требует рабочего сервера или базы данных.
const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "vpn-node",
          environment: "node",
          clearMocks: true,
          include: ["src/lib/{connectionUsage,vpn,wgKeys,premium,vpnPlan}.test.ts", "src/app/api/vpn/me/route.test.ts", "src/app/api/servers/report/route.test.ts", "../desktop/src/shared/*.test.ts", "../desktop/src/main/winTunnel.test.ts"],
        },
      },
      {
        resolve: { alias },
        esbuild: { jsx: "automatic" },
        test: {
          name: "vpn-ui",
          environment: "jsdom",
          globals: true,
          clearMocks: true,
          setupFiles: ["./src/test/setupDom.ts"],
          include: ["src/components/connect/overlays/PremiumInfoModal.test.tsx"],
        },
      },
    ],
  },
});
