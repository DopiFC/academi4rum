import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const isUserSite = repositoryName?.endsWith('.github.io');
const configuredBase = process.env.VITE_BASE_PATH || undefined;

export default defineConfig({
  plugins: [react()],
  base: configuredBase ?? (process.env.GITHUB_ACTIONS === 'true' && repositoryName && !isUserSite
    ? `/${repositoryName}/`
    : '/'),
});
