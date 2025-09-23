import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierPlugin from "eslint-plugin-prettier";
import prettierConfig from "eslint-config-prettier";
import unusedImportsPlugin from "eslint-plugin-unused-imports"

export default [
  // Global ignores
  {
    ignores: ["node_modules/**", "dist/**"],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    plugins: {
      prettier: prettierPlugin,
      "unused-imports": unusedImportsPlugin,
    },
    rules: {
      "prettier/prettier": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
  {
    // Apply TypeScript rules only to TypeScript files
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: true,
      },
    },
  },
  {
    // Ignore dist directory and config files
    ignores: ["dist/**", "*.config.js", "drizzle.config.ts"]
  }
]
