import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const PORT = 43764;

export default defineConfig({
	plugins: [react()],
	server: {
		port: PORT,
		strictPort: true,
	},
	preview: {
		port: PORT,
		strictPort: true,
	},
	build: {
		outDir: 'playground-dist',
	},
	optimizeDeps: {
		include: ['@mary-ext/simple-event-emitter'],
	},
	test: {
		browser: {
			enabled: true,
			headless: true,
			instances: [{ browser: 'chromium' }],
			provider: playwright(),
		},
		css: false,
		include: ['src/**/*.test.{ts,tsx}'],
		setupFiles: ['./vitest.setup.ts'],
		typecheck: {
			include: ['src/**/*.test-d.ts'],
			tsconfig: './tsconfig.lib.json',
		},
	},
});
