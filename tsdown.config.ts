import { defineConfig } from 'tsdown';

export default defineConfig({
	dts: true,
	entry: {
		index: 'src/index.ts',
		testing: 'src/testing.ts',
	},
	tsconfig: 'tsconfig.lib.json',
});
