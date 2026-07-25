import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { act, use, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { optional, string } from '../codec.ts';
import { MemoryHistory } from '../history/memory.ts';
import { NavigationHistory } from '../history/navigation.ts';
import { Router } from '../router.ts';
import { defineRoutes, layout, route } from '../routes.ts';
import type { RouteRegistry } from '../routes.ts';
import { disposed, openProbe, PROBE, probeWindow, settled, sleep, until } from '../test-support.ts';

import { useIsFocused, useParams } from './hooks.ts';
import { Outlet } from './outlet.tsx';
import { RouterView } from './router-view.tsx';

// #region memory-driven

const Shell = () => (
	<div>
		<h1>shell</h1>
		<Outlet />
	</div>
);
const Home = () => <p>home page</p>;
const Profile = () => {
	const { actor } = useParams();
	return <p>profile {String(actor)}</p>;
};
const NotFound = () => <p>not found</p>;

const neverLoads = new Promise<null>(() => {});
const Suspending = () => use(neverLoads);

const routes = defineRoutes({
	app: layout({
		children: {
			Home: route({ component: Home, path: '/', type: 'singleton' }),
			Profile: route({ component: Profile, params: { actor: string() }, path: '/profile/:actor' }),
		},
		component: Shell,
	}),
});

const make = (initialEntries: string[]) =>
	new Router({ history: new MemoryHistory({ initialEntries }), notFound: NotFound, routes });

// suspended renders must settle inside an asynchronous act.
const renderSuspending = async (
	suspendingRoutes: RouteRegistry<unknown>,
	defaultFallback?: ReactNode,
): Promise<void> => {
	const router = new Router({
		defaultFallback,
		history: new MemoryHistory({ initialEntries: ['/'] }),
		routes: suspendingRoutes,
	});
	await act(async () => {
		render(<RouterView router={router} />);
	});
};

describe('RouterView', () => {
	it('renders the layout shell and the active leaf, with decoded params', () => {
		render(<RouterView router={make(['/profile/alice'])} />);
		expect(screen.getByText('shell')).toBeInTheDocument();
		expect(screen.getByText('profile alice')).toBeInTheDocument();
	});

	it('renders the active leaf after a navigation, keeping the shared shell', () => {
		const router = make(['/']);
		render(<RouterView router={router} />);
		expect(screen.getByText('home page')).toBeInTheDocument();

		act(() => router.navigate({ to: '/profile/bob' }));

		expect(screen.getByText('profile bob')).toBeInTheDocument();
		expect(screen.getByText('shell')).toBeInTheDocument();
	});

	it('renders the notFound component for an unmatched URL', () => {
		render(<RouterView router={make(['/nope'])} />);
		expect(screen.getByText('not found')).toBeInTheDocument();
	});

	describe('suspense fallbacks', () => {
		it('renders a suspending layout`s own fallback, not a blank branch', async () => {
			await renderSuspending(
				defineRoutes({
					app: layout({
						children: { Home: route({ component: Home, path: '/', type: 'singleton' }) },
						component: Suspending,
						fallback: <p>layout loading</p>,
					}),
				}),
			);

			expect(screen.getByText('layout loading')).toBeInTheDocument();
		});

		it('falls back to defaultFallback for a node with none of its own', async () => {
			await renderSuspending(
				defineRoutes({
					app: layout({
						children: { Home: route({ component: Suspending, path: '/', type: 'singleton' }) },
						component: Shell,
					}),
				}),
				<p>default loading</p>,
			);

			expect(screen.getByText('default loading')).toBeInTheDocument();
			expect(screen.getByText('shell')).toBeInTheDocument();
		});

		it('prefers a node`s own fallback over defaultFallback', async () => {
			await renderSuspending(
				defineRoutes({
					app: layout({
						children: {
							Home: route({
								component: Suspending,
								fallback: <p>route loading</p>,
								path: '/',
								type: 'singleton',
							}),
						},
						component: Shell,
					}),
				}),
				<p>default loading</p>,
			);

			expect(screen.getByText('route loading')).toBeInTheDocument();
			expect(screen.queryByText('default loading')).not.toBeInTheDocument();
		});
	});
});

// #endregion

// #region navigation API

/** viewport offset each screen measured as it came on screen. */
const focusScrolls: number[] = [];

const Screen = ({ label }: { readonly label: string }) => {
	const focused = useIsFocused();

	// a layout effect on reveal is where a stale offset would bite.
	useLayoutEffect(() => {
		if (focused) {
			focusScrolls.push(probeWindow().scrollY);
		}
	}, [focused]);

	return (
		<div style={{ height: '3000px' }}>
			<p data-testid="screen">{label}</p>
		</div>
	);
};

const probeRoutes = defineRoutes({
	app: layout({
		children: {
			Other: route({ component: () => <Screen label="other" />, path: '/other' }),
			Probe: route({
				component: () => <Screen label="probe" />,
				path: PROBE,
				query: { q: optional(string()) },
			}),
		},
		component: () => <Outlet />,
	}),
});

interface Mounted {
	readonly router: Router<typeof probeRoutes>;
	readonly win: Window;
}

const roots: Root[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		act(() => root.unmount());
	}
	focusScrolls.splice(0);
});

const mount = async (max?: number): Promise<Mounted> => {
	const win = await openProbe();
	const router = disposed(
		new Router({
			history: new NavigationHistory({ window: win }),
			max,
			routes: probeRoutes,
			window: win,
		}),
	);

	const root = createRoot(win.document.body);
	roots.push(root);
	await act(async () => {
		root.render(<RouterView router={router} />);
	});
	return { router, win };
};

const visibleScreen = (win: Window): string | null => {
	const screens = [...win.document.querySelectorAll<HTMLElement>('[data-testid="screen"]')];
	return screens.find((el) => el.checkVisibility())?.textContent ?? null;
};

const committed = (router: Router<typeof probeRoutes>, write: () => void): Promise<void> =>
	act(async () => settled(router, write));

describe('RouterView on the navigation API', () => {
	it('renders the active screen for the document it booted on', async () => {
		const { win } = await mount();
		expect(visibleScreen(win)).toBe('probe');
	});

	it('renders the new screen after a navigation', async () => {
		const { router, win } = await mount();

		await committed(router, () => router.navigate({ to: '/other' }));

		expect(visibleScreen(win)).toBe('other');
		expect(router.canGoBack).toBe(true);
	});

	it('restores the entry`s scroll before the incoming screen measures anything', async () => {
		const { router, win } = await mount();
		win.scrollTo(0, 400);
		expect(win.scrollY).toBe(400);

		await committed(router, () => router.navigate({ to: '/other' }));
		await until(() => win.scrollY === 0, 'a push to reset scroll to the top');
		expect(visibleScreen(win)).toBe('other');

		await committed(router, () => router.back());
		await until(() => win.scrollY === 400, 'a traversal to restore the previous entry`s scroll');
		expect(visibleScreen(win)).toBe('probe');

		// the mount, then one per navigation: each screen measured its own offset, never the outgoing one.
		expect(focusScrolls).toEqual([0, 0, 400]);
	});

	// offsets live on the warm entry, so an eviction takes the entry's saved offset with it.
	it('opens an evicted entry at the top instead of its saved scroll', async () => {
		const { router, win } = await mount(0);
		win.scrollTo(0, 400);

		await committed(router, () => router.navigate({ to: '/other' }));
		await until(() => win.scrollY === 0, 'a push to reset scroll to the top');

		await committed(router, () => router.back());
		await sleep(100);

		expect(visibleScreen(win)).toBe('probe');
		expect(win.scrollY).toBe(0);
	});

	it('does not disturb scroll on a replace patch', async () => {
		const { router, win } = await mount();
		win.scrollTo(0, 400);

		await committed(router, () => router.replace('Probe', { q: 'patched' }));
		await sleep(100);

		expect(router.location.search).toBe('?q=patched');
		expect(win.scrollY).toBe(400);
	});
});

// #endregion
