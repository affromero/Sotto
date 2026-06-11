import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Flat config for ESLint v9. Intentionally lenient: the mobile app is a thin
// client validated primarily by `tsc --noEmit`. This catches unused symbols and
// obvious mistakes without forcing a large retro-lint of never-linted screens.
export default tseslint.config(
  {
    ignores: [
      'ios/**',
      'android/**',
      '.expo/**',
      'node_modules/**',
      'modules/**/build/**',
      'expo-env.d.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'no-console': 'off',
    },
  },
);
