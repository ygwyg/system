import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'app/**',
      'cloudflare-agent/**',
      '*.js',
    ],
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      // Allow unused vars prefixed with underscore
      '@typescript-eslint/no-unused-vars': ['error', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      // Allow explicit any in some cases (gradually tighten)
      '@typescript-eslint/no-explicit-any': 'warn',
      // Allow empty catch blocks with comment
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Enforce consistent type imports
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  }
);
