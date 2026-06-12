import nextConfig from "eslint-config-next";

export default [
  ...nextConfig,
  {
    // Pin the React version so eslint-plugin-react skips runtime version
    // detection. Under ESLint 10 the 'detect' path calls the removed
    // context.getFilename() and crashes the lint run.
    settings: { react: { version: "19.2" } },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    ignores: ["node_modules/", ".next/", "public/sw.js", "src/lib/vendor/"],
  },
];
