import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { isPreloadable, lazy } from './lazy.ts';
import { Dummy, sleep } from './test-support.ts';

const Loaded = (): ReactElement => <p>loaded</p>;

/** a controllable module factory, standing in for a dynamic import. */
const deferred = () => {
	const { promise, resolve } = Promise.withResolvers<{ default: typeof Loaded }>();
	return { init: () => promise, resolve: () => resolve({ default: Loaded }) };
};

describe('lazy', () => {
	it('reports preloadable components', () => {
		expect(isPreloadable(lazy(async () => ({ default: Loaded })))).toBe(true);
		expect(isPreloadable(Dummy)).toBe(false);
	});

	it('resolves once the module loads', async () => {
		const { init, resolve } = deferred();
		const Component = lazy(init);

		let settled = false;
		const preloaded = Component.preload().then(() => {
			settled = true;
		});

		await sleep(0);
		expect(settled).toBe(false);

		resolve();
		await preloaded;
		expect(settled).toBe(true);
	});

	it('renders without suspending once preloaded', async () => {
		const { init, resolve } = deferred();
		const Component = lazy(init);

		resolve();
		await Component.preload();

		render(
			<Suspense fallback={<p>pending</p>}>
				<Component />
			</Suspense>,
		);

		// synchronously present: a suspending render would have shown the fallback for at least one paint.
		expect(screen.queryByText('pending')).toBeNull();
		expect(screen.getByText('loaded')).toBeInTheDocument();
	});

	it('settles rather than rejecting when the module fails to load', async () => {
		const Component = lazy(() => Promise.reject(new Error('boom')));

		await expect(Component.preload()).resolves.toBeUndefined();
	});

	it('settles when the factory throws synchronously', async () => {
		const Component = lazy((): Promise<{ default: typeof Loaded }> => {
			throw new Error('boom');
		});

		await expect(Component.preload()).resolves.toBeUndefined();
	});
});
