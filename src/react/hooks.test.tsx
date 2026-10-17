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

const TargetProbe = () => {
	const target = hooks.useTarget();
	const router = hooks.useRouter();
	return (
		<>
			<p data-testid="target">{JSON.stringify(target)}</p>
			<a data-testid="href" href={router.href({ name: 'Profile', actor: 'bob' })}>
				bob
			</a>
		</>
	);
};

const Home = () => {
	const router = hooks.useRouter();
	return (
		<button onClick={() => router.navigate({ to: { name: 'Profile', actor: 'alice' } })} type="button">
			go alice
		</button>
	);
};

const Profile = () => {
	const [{ actor, tab }, replace] = hooks.useParams('Profile');
	return (
		<>
			<p>
				profile {actor} tab={tab ?? 'none'}
			</p>
			<button onClick={() => replace({ tab: 'media' })} type="button">
				set media
			</button>
		</>
	);
};

const routes = defineRoutes({
	app: layout({
		component: () => (
			<>
				<ActiveProbe />
				<TargetProbe />
				<Outlet />
			</>
		),
		children: {
			Home: route({ path: '/', type: 'singleton', component: Home }),
			Profile: route({
				path: '/profile/:actor',
				params: { actor: string() },
				query: { tab: optional(string()) },
				component: Profile,
			}),
		},
	}),
});

const hooks = createRouterHooks(routes);

const make = () => new Router({ routes, history: new MemoryHistory({ initialEntries: ['/'] }) });

describe('typed hooks', () => {
	it('the typed router navigates by route name with typed params', () => {
		const router = make();
		render(<RouterView router={router} />);

		act(() => screen.getByText('go alice').click());

		expect(screen.getByText(/profile alice/)).toBeInTheDocument();
		expect(router.location.pathname).toBe('/profile/alice');
	});

	it('useParams reports the patched query without a new history entry', () => {
		const router = make();
		render(<RouterView router={router} />);
		act(() => router.navigate({ to: { name: 'Profile', actor: 'alice' } }));
		const before = router.location;

		act(() => router.replace('Profile', { tab: 'media' }));

		expect(screen.getByText(/tab=media/)).toBeInTheDocument();
		expect(router.location.key).toBe(before.key);
		expect(router.location.index).toBe(before.index);
		expect(router.canGoBack).toBe(true);
	});

	it('the useParams setter patches the active route query in place', () => {
		const router = make();
		render(<RouterView router={router} />);
		act(() => router.navigate({ to: { name: 'Profile', actor: 'alice' } }));
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

		act(() => router.navigate({ to: { name: 'Profile', actor: 'alice' } }));
		expect(screen.getByTestId('active')).toHaveTextContent('Profile {"actor":"alice"}');

		act(() => router.replace('Profile', { tab: 'media' }));
		expect(screen.getByTestId('active')).toHaveTextContent('Profile {"actor":"alice","tab":"media"}');
	});

	it('useTarget reports the active route as a target, and tracks navigation', () => {
		const router = make();
		render(<RouterView router={router} />);
		expect(screen.getByTestId('target')).toHaveTextContent('{"name":"Home"}');

		act(() => router.navigate({ to: { name: 'Profile', actor: 'alice' } }));

		expect(screen.getByTestId('target')).toHaveTextContent('{"actor":"alice","name":"Profile"}');
	});

	it('the typed router builds a URL for a target', () => {
		const router = make();
		render(<RouterView router={router} />);

		expect(screen.getByTestId('href')).toHaveAttribute('href', '/profile/bob');
	});

	it('throws when the router in context was built from a different registry', () => {
		const Foreign = () => {
			hooks.useRouter();
			return null;
		};
		const otherRoutes = defineRoutes({
			Home: route({ path: '/', type: 'singleton', component: Foreign }),
		});
		const router = new Router({
			routes: otherRoutes,
			history: new MemoryHistory({ initialEntries: ['/'] }),
		});

		expect(() => render(<RouterView router={router} />)).toThrow(/different route registry/);
	});

	describe('useParams runtime guard', () => {
		const misassertedRoutes = defineRoutes({
			app: layout({
				component: () => <Outlet />,
				children: {
					Home: route({ path: '/', type: 'singleton', component: () => <Misasserted /> }),
					Profile: route({ path: '/profile/:actor', params: { actor: string() }, component: () => null }),
				},
			}),
		});
		const misassertedHooks = createRouterHooks(misassertedRoutes);
		const Misasserted = () => {
			misassertedHooks.useParams('Profile');
			return null;
		};

		it('throws when the asserted route name does not match the rendered route', () => {
			const router = new Router({
				routes: misassertedRoutes,
				history: new MemoryHistory({ initialEntries: ['/'] }),
			});

			expect(() => render(<RouterView router={router} />)).toThrow(
				/useParams\('Profile'\) called under route 'Home'/,
			);
		});

		const collidingRoutes = defineRoutes({
			Profile: layout({
				params: { actor: string() },
				component: () => <LayoutProbe />,
				children: {
					Profile: route({ path: '/profile/:actor', params: { actor: string() }, component: () => null }),
				},
			}),
		});
		const collidingHooks = createRouterHooks(collidingRoutes);
		const LayoutProbe = () => {
			collidingHooks.useParams('Profile');
			return null;
		};

		it('throws when a layout key collides with the asserted leaf route name', () => {
			const router = new Router({
				routes: collidingRoutes,
				history: new MemoryHistory({ initialEntries: ['/profile/alice'] }),
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
			component: () => <Outlet />,
			children: {
				Away: route({ path: '/away', component: () => <p>away</p> }),
				Focus: route({ path: '/', type: 'singleton', component: FocusProbe }),
			},
		}),
	});

	const makeFocus = () => {
		focus.mockClear();
		blur.mockClear();
		return new Router({ routes: focusRoutes, history: new MemoryHistory({ initialEntries: ['/'] }) });
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

		act(() => router.navigate({ to: { name: 'Away' } }));

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
			component: () => <Outlet />,
			children: {
				Away: route({ path: '/away', component: () => <Titled title="away" /> }),
				Titled: route({ path: '/', type: 'singleton', component: () => <Titled title="titled" /> }),
			},
		}),
	});

	it('lets the visible branch title the document, and never a warm one', () => {
		const router = new Router({
			routes: titledRoutes,
			history: new MemoryHistory({ initialEntries: ['/'] }),
		});
		render(<RouterView router={router} />);
		expect(document.title).toBe('titled');

		act(() => router.navigate({ to: { name: 'Away' } }));

		expect(document.title).toBe('away');

		act(() => router.back());

		expect(document.title).toBe('titled');
	});
});
