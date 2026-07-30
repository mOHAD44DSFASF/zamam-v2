import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['**/dist/**', '**/node_modules/**', '.npm-cache/**', '.firebase/**', 'coverage/**']),
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['packages/**/*.ts', 'services/**/*.ts', 'tests/**/*.ts', 'vitest.config.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      'apps/web/src/components/TaskCreationModal.tsx',
      'apps/web/src/components/UserCreationModal.tsx',
      'apps/web/src/components/UserEditModal.tsx',
      'apps/web/src/pages/AdminDashboard.tsx',
      'apps/web/src/pages/EmployeeWorkspace.tsx',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
