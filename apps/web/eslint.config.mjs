import nextConfig from "eslint-config-next";

export default [
  ...nextConfig,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      // React Hooks 6 / Next 16 currently reports ordinary async data loading
      // effects (fetch callback updates state) as set-state-in-effect. The app
      // intentionally uses effects to synchronize API data, sockets and browser
      // state; rewriting every screen around this experimental advisory rule
      // would add indirection without changing runtime behaviour.
      "react-hooks/set-state-in-effect": "off",
      // The purity advisory also flags stable one-time visual seeds and current
      // timestamps used by decorative UI. Keep real TypeScript/ESLint errors
      // blocking CI while treating these migration advisories separately.
      "react-hooks/purity": "off",
    },
  },
  {
    ignores: [".next/", "node_modules/", "public/"],
  },
];
