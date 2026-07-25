import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { act, useCallback, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { optional, string } from '../codec.ts';
import { MemoryHistory } from '../history/memory.ts';
import { Router } from '../router.ts';
import { defineRoutes, layout, route } from '../routes.ts';

import { createRouterHooks, useFocusEffect, useRoute } from './hooks.ts';
import { Outlet } from './outlet.tsx';
import { RouterView } from './router-view.tsx';

const ActiveProbe = () => {
	const active = useRoute();
	return <p data-testid="active">{`${active.name} ${JSON.stringify(active.params)}`}</p>;
};

const Home = () => {
	const navigate = hooks.useNavigate();
	return (
		<button onClick={() => navigate({ actor: 'alice', name: 'Profile' })} type="button">
			go alice
		</button>
	);
};

const Profile = () => {
	const [{ actor, tab }, setParams] = hooks.useParams('Profile');
	return (
		<>
			<p>
				profile {actor} tab={tab ?? 'none'}
			</p>
			<button onClick={() => setParams({ tab: 'media' })} type="button">
				set media
			</button>
		</>
	);
};

const routes = defineRoutes({
	app: layout({
		children: {
			Home: route({ component: Home, path: '/', type: 'singleton' }),
			Profile: route({
				component: Profile,
				params: { actor: string() },
				path: '/profile/:actor',
				query: { tab: optional(string()) },
			}),
		},
		component: () => (
			<>
				<ActiveProbe />
				<Outlet />
			</>
		),
	}),
});

const hooks = createRouterHooks(routes);

const make = () => new Router({ history: new MemoryHistory({ initialEntries: ['/'] }), routes });

describe('typed hooks', () => {
	it('useNavigate navigates by route name with typed params', () => {
		const router = make();
		render(<RouterView router={router} />);

		act(() => screen.getByText('go alice').click());

		expect(screen.getByText(/profile alice/)).toBeInTheDocument();
		expect(router.location.pathname).toBe('/profile/alice');
	});

	it('useParams reports the patched query without a new history entry', () => {
		const router = make();
		render(<RouterView router={router} />);
		act(() => router.navigate({ actor: 'alice', name: 'Profile' }));
		const before = router.location;

		act(() => router.setParams({ tab: 'media' }));

		expect(screen.getByText(/tab=media/)).toBeInTheDocument();
		expect(router.location.key).toBe(before.key);
		expect(router.location.index).toBe(before.index);
		expect(router.canGoBack).toBe(true);
	});

	it('the useParams setter patches the active route query in place', () => {
		const router = make();
		render(<RouterView router={router} />);
		act(() => router.navigate({ actor: 'alice', name: 'Profile' }));
		const before = router.location;

		act(() => screen.getByText('set media').click());

		expect(screen.getByText(/tab=media/)).toBeInTheDocument();
		expect(router.location.key).toBe(before.key);
		expect(router.location.index).toBe(before.index);
		expect(router.canGoBack).toBe(true);
	});

	it('useRoute reports the active leaf to a layout, and tracks navigation', () => {
		const router = make();
		render(<RouterView router={router} />);
		expect(screen.getByTestId('active')).toHaveTextContent('Home {}');

		act(() => router.navigate({ actor: 'alice', name: 'Profile' }));
		expect(screen.getByTestId('active')).toHaveTextContent('Profile {"actor":"alice"}');

		act(() => router.setParams({ tab: 'media' }));
		expect(screen.getByTestId('active')).toHaveTextContent('Profile {"actor":"alice","tab":"media"}');
	});

	it('throws when the router in context was built from a different registry', () => {
		const Foreign = () => {
			hooks.useNavigate();
			return null;
		};
		const otherRoutes = defineRoutes({
			Home: route({ component: Foreign, path: '/', type: 'singleton' }),
		});
		const router = new Router({
			history: new MemoryHistory({ initialEntries: ['/'] }),
			routes: otherRoutes,
		});

		expect(() => render(<RouterView router={router} />)).toThrow(/different route registry/);
	});

	describe('useParams runtime guard', () => {
		const misassertedRoutes = defineRoutes({
			app: layout({
				children: {
					Home: route({ component: () => <Misasserted />, path: '/', type: 'singleton' }),
					Profile: route({ component: () => null, params: { actor: string() }, path: '/profile/:actor' }),
				},
				component: () => <Outlet />,
			}),
		});
		const misassertedHooks = createRouterHooks(misassertedRoutes);
		const Misasserted = () => {
			misassertedHooks.useParams('Profile');
			return null;
		};

		it('throws when the asserted route name does not match the rendered route', () => {
			const router = new Router({
				history: new MemoryHistory({ initialEntries: ['/'] }),
				routes: misassertedRoutes,
			});

			expect(() => render(<RouterView router={router} />)).toThrow(
				/useParams\('Profile'\) called under route 'Home'/,
			);
		});

		const collidingRoutes = defineRoutes({
			Profile: layout({
				children: {
					Profile: route({ component: () => null, params: { actor: string() }, path: '/profile/:actor' }),
				},
				component: () => <LayoutProbe />,
				params: { actor: string() },
			}),
		});
		const collidingHooks = createRouterHooks(collidingRoutes);
		const LayoutProbe = () => {
			collidingHooks.useParams('Profile');
			return null;
		};

		it('throws when a layout key collides with the asserted leaf route name', () => {
			const router = new Router({
				history: new MemoryHistory({ initialEntries: ['/profile/alice'] }),
				routes: collidingRoutes,
			});

			expect(() => render(<RouterView router={router} />)).toThrow(
				/useParams\('Profile'\) called under layout 'Profile'/,
			);
		});
	});
});

const focus = vi.fn();
const blur = vi.fn();

const FocusProbe = () => {
	const [tick, setTick] = useState(0);
	useFocusEffect(
		useCallback(() => {
			focus(tick);
			return () => blur(tick);
		}, [tick]),
	);
	return (
		<button onClick={() => setTick((value) => value + 1)} type="button">
			tick
		</button>
	);
};

describe('useFocusEffect', () => {
	const focusRoutes = defineRoutes({
		shell: layout({
			children: {
				Away: route({ component: () => <p>away</p>, path: '/away' }),
				Focus: route({ component: FocusProbe, path: '/', type: 'singleton' }),
			},
			component: () => <Outlet />,
		}),
	});

	const makeFocus = () => {
		focus.mockClear();
		blur.mockClear();
		return new Router({ history: new MemoryHistory({ initialEntries: ['/'] }), routes: focusRoutes });
	};

	it('re-runs while visible when the effect identity changes', () => {
		const router = makeFocus();
		render(<RouterView router={router} />);
		expect(focus.mock.calls).toEqual([[0]]);

		act(() => screen.getByText('tick').click());

		expect(blur.mock.calls).toEqual([[0]]);
		expect(focus.mock.calls).toEqual([[0], [1]]);
	});

	it('cleans up when the branch is hidden, and runs again on return', () => {
		const router = makeFocus();
		render(<RouterView router={router} />);

		act(() => router.navigate({ name: 'Away' }));

		expect(blur.mock.calls).toEqual([[0]]);
		expect(focus.mock.calls).toEqual([[0]]);

		act(() => router.back());

		expect(focus.mock.calls).toEqual([[0], [0]]);
	});
});

const Titled = ({ title }: { readonly title: string }) => {
	useFocusEffect(
		useCallback(() => {
			document.title = title;
		}, [title]),
	);
	return null;
};

describe('a title, built out of useFocusEffect', () => {
	const titledRoutes = defineRoutes({
		shell: layout({
			children: {
				Away: route({ component: () => <Titled title="away" />, path: '/away' }),
				Titled: route({ component: () => <Titled title="titled" />, path: '/', type: 'singleton' }),
			},
			component: () => <Outlet />,
		}),
	});

	it('lets the visible branch title the document, and never a warm one', () => {
		const router = new Router({
			history: new MemoryHistory({ initialEntries: ['/'] }),
			routes: titledRoutes,
		});
		render(<RouterView router={router} />);
		expect(document.title).toBe('titled');

		act(() => router.navigate({ name: 'Away' }));

		expect(document.title).toBe('away');

		act(() => router.back());

		expect(document.title).toBe('titled');
	});
});
