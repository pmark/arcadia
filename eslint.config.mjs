import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

const typeCheckedFiles = ["**/*.{ts,tsx,mts,cts}"];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "apps/dashboard/.next/**",
      "apps/dashboard/next-env.d.ts",
      "config/**",
      "database/**",
      "artifacts/**",
      "mission_logs/**",
      "projects/**",
      "tmp/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Type-checked rules need a TypeScript program, so they are scoped to TS
  // files. JS/MJS/CJS files (scripts, Next configs, fixtures) are linted
  // without type information instead of failing to parse.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: typeCheckedFiles
  })),
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    }
  },
  {
    files: typeCheckedFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "with-single-extends" }
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],

      // `require-await` fires on async functions that exist to satisfy an async
      // interface (artifact stores, route handlers, test doubles) rather than
      // to await anything. That is a shape, not a bug, so it stays off.
      "@typescript-eslint/require-await": "off",

      // The `no-unsafe-*` family and `no-base-to-string` fire on every value
      // flowing through an intentional `any` (JSON.parse, untyped boundaries).
      // They stay off until those call sites are typed; the bug-catching rules
      // in `recommended-type-checked` remain on.
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-enum-comparison": "off",
      "@typescript-eslint/no-base-to-string": "off"
    }
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked
  },
  {
    files: ["apps/dashboard/**/*.{ts,tsx}"],
    // The dashboard consumes `@pmark/arcadia` through its published `dist/`
    // types. A fresh checkout has no `dist/` yet, which made those imports
    // resolve to `any` and tripped type-aware rules before any build. This
    // lint-only tsconfig maps the subpaths at their TypeScript sources, the
    // same build-order independence `vitest.config.ts` already sets up.
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ["./apps/dashboard/tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      "react-hooks": reactHooks,
      "@next/next": nextPlugin
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      // The React Compiler rules flag the dashboard's existing
      // fetch-in-effect pattern in 30+ places. Adopting them is a
      // modernization pass of its own, so the classic hook rules stay on and
      // the compiler rules wait for that pass.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "react-hooks/purity": "off",
      "react-hooks/exhaustive-deps": "error",
      // Async event handlers on JSX attributes are the dashboard's normal
      // pattern. `conditionals` and `spreads` stay checked so a promise used
      // as a condition is still an error.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } }
      ],
      // The dashboard is App Router only; there is no `pages/` directory for
      // this rule to inspect, and it warns to stderr on every run without it.
      "@next/next/no-html-link-for-pages": "off"
    }
  },
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off"
    }
  },
  {
    files: ["tests/e2e/**/*.spec.ts"],
    rules: {
      "no-empty-pattern": "off"
    }
  }
);
