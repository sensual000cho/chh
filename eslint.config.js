import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "release/**", "node_modules/**", "저장보드/**", "src/excalidraw-dark.css"] },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // JSX 안에서만 쓰이는 컴포넌트를 미사용으로 오인하지 않도록 대문자 시작 이름은 뺀다
      "no-unused-vars": ["error", { varsIgnorePattern: "^[A-Z_]", argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["electron/**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.{js,mjs}", "*.config.js"],
    languageOptions: { sourceType: "module", globals: { ...globals.node } },
    rules: { "no-empty": ["error", { allowEmptyCatch: true }] },
  },
];
