import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        // Node.js
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        console: "readonly",
        // Browser (frontend)
        window: "readonly",
        document: "readonly",
        location: "readonly",
        fetch: "readonly",
        WebSocket: "readonly",
        btoa: "readonly",
        atob: "readonly",
        URLSearchParams: "readonly",
        URL: "readonly",
        AbortController: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        // Dashboard globals
        Dashboard: "readonly",
        CSS: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-prototype-builtins": "off",
      "no-case-declarations": "warn",
      "no-undef": "error",
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-irregular-whitespace": "error",
      "no-unreachable": "warn",
      "no-unsafe-negation": "error",
      "no-unsafe-optional-chaining": "error",
      "valid-typeof": "error",
    },
  },
  {
    ignores: [
      "node_modules/**",
      "backend/node_modules/**",
      "frontend/public/dashboard.js",
      "**/*.min.js",
      "**/test-*.js",
    ],
  },
];
