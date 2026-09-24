import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/', 'coverage/', 'node_modules/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Números em template strings são comuns em mensagens de debug e erros.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // src/ corre no browser: nada de APIs do Node (os tipos "node" estão no tsconfig por causa
    // de scripts/ e vite.config.ts).
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'process', 'Buffer', '__dirname', '__filename', 'require', 'global'],
      'no-restricted-imports': [
        'error',
        { patterns: [{ regex: '^node:', message: 'src/ corre no browser.' }] },
      ],
    },
  },
  {
    // Lógica pura, testável em Node (CLAUDE.md §5.1).
    files: ['src/core/**/*.ts', 'src/systems/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'phaser', message: 'core/ e systems/ são lógica pura, sem Phaser.' }],
          patterns: [{ regex: '^node:', message: 'src/ corre no browser.' }],
        },
      ],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
