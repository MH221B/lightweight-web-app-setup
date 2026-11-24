import js from "@eslint/js";
import angular from "angular-eslint";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", ".angular/**", "variants/**"],
  },
  {
    files: ["**/*.ts"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    processor: angular.createProcessor(),
    rules: {
      "@angular-eslint/component-selector": [
        "error",
        { type: "element", prefix: "app", style: "kebab-case" },
      ],
      "@angular-eslint/directive-selector": [
        "error",
        { type: "attribute", prefix: "app", style: "camelCase" },
      ],
    },
  },
  {
    files: ["**/*.html"],
    extends: [...angular.configs.templateRecommended],
    rules: {},
  },
);
