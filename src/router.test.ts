import { describe, expect, it } from 'vitest';

import type { Codec } from './codec.ts';
import { enumOf, nonEmpty, optional, string, withDefault } from './codec.ts';
import { MemoryHistory } from './history/memory.ts';
import { NavigationHistory } from './history/navigation.ts';
import type { HistoryListener } from './history/types.ts';
import { Router } from './router.ts';
import { defineRoutes, layout, route } from './routes.ts';
import { disposed, Dummy, openProbe, PROBE, reloadProbe, settled, until } from './test-support.ts';

const csv = (): Codec<string[]> => ({
	decode: (raw) => raw.split(','),
	encode: (value) => value.join(','),
});

const routes = defineRoutes({
	app: layout({
		children: {
			Feed: route({
				component: Dummy,
				path: '/feed',
				query: { q: optional(string()), sort: withDefault(enumOf(['hot', 'new']), 'hot') },
			}),
			Home: route({ component: Dummy, path: '/', type: 'singleton' }),
			Page: route({ component: Dummy, path: '/page' }),
			Profile: route({
				component: Dummy,
				params: { actor: string() },
				path: '/profile/:actor',
				type: 'singleton',
			}),
			Search: route({ component: Dummy, path: '/search', query: { q: string() }, type: 'singleton' }),
			Tab: route({ component: Dummy, path: '/tab', query: { q: optional(string()) }, type: 'singleton' }),
			Tags: route({ component: Dummy, path: '/tags', query: { tags: csv() } }),
		},
		component: Dummy,
	}),
});

const make = (initialEntries: string[] = ['/'], pins?: string[]) =>
	new Router({ history: new MemoryHistory({ initialEntries }), pins, routes });

const activeLeaf = (router: Router<typeof routes>): string | undefined => router.view.activePath.at(-1);

describe('Router', () => {
	describe('view', () => {
		it('exposes the active chain for the initial location', () => {
			const router = make(['/']);
			expect(router.location.pathname).toBe('/');
			expect(router.view.roots).toHaveLength(1);
			expect(router.view.activePath).toHaveLength(2);
		});

		it('recomputes a fresh view object on navigation, and notifies subscribers', () => {
			const router = make(['/']);
			let notified = 0;
			router.subscribe(() => {
				notified += 1;
			});
			const before = router.view;

			router.navigate({ to: '/page' });

			expect(notified).toBe(1);
			expect(router.view).not.toBe(before);
			expect(router.location.pathname).toBe('/page');
			expect(router.canGoBack).toBe(true);
		});

		it('falls back to a notFound match for an unmatched URL', () => {
			const router = make(['/totally/unknown']);
			expect(activeLeaf(router)).toContain('notFound');
		});
	});

	describe('pins', () => {
		it('keeps a pinned singleton in the pool when navigated away', () => {
			const router = make(['/'], ['Home']);

			router.navigate({ to: '/page' });

			const childIds = router.view.roots[0]!.children.map((child) => child.node.id);
			expect(childIds).toContain('app.Home');
			expect(childIds).toContain('app.Page');
		});

		it('stays dormant until the pinned route is first visited', () => {
			const router = make(['/page'], ['Home']);

			expect(router.view.roots[0]!.children.map((child) => child.node.id)).not.toContain('app.Home');

			router.navigate({ to: '/' });
			router.navigate({ to: '/tab' });

			expect(router.view.roots[0]!.children.map((child) => child.node.id)).toContain('app.Home');
		});

		it('shares one instance between a query-bearing pin and its live visit', () => {
			const router = make(['/tab?q=cats'], ['Tab']);

			const tabs = router.view.roots[0]!.children.filter((child) => child.node.id === 'app.Tab');

			expect(tabs).toHaveLength(1);
			expect(tabs[0]!.params).toEqual({ q: 'cats' });
		});

		it('accepts a paramless singleton', () => {
			expect(() => make(['/'], ['Home'])).not.toThrow();
		});

		it('accepts a singleton whose only params are optional query params', () => {
			expect(() => make(['/'], ['Tab'])).not.toThrow();
		});

		it('rejects a singleton with a required query param', () => {
			expect(() => make(['/'], ['Search'])).toThrow(/did not match/);
		});

		it('rejects a singleton with path params', () => {
			expect(() => make(['/'], ['Profile'])).toThrow(/no path params/);
		});

		it('rejects a page route, which would never dedupe with its live entry', () => {
			expect(() => make(['/'], ['Page'])).toThrow(/must be a singleton/);
		});

		it('rejects an unknown route', () => {
			expect(() => make(['/'], ['Nope'])).toThrow(/not in the registry/);
		});
	});

	describe('route and target', () => {
		it('reports the active route as a target, decoding path and query params', () => {
			const router = make(['/feed?q=cats']);

			expect(router.target).toEqual({ name: 'Feed', q: 'cats', sort: 'hot' });
		});

		it('hands out one target identity per entry, so a store subscription settles', () => {
			const router = make(['/feed']);
			const before = router.target;

			expect(router.target).toBe(before);

			router.navigate({ to: '/page' });

			expect(router.target).not.toBe(before);
			expect(router.target).toEqual({ name: 'Page' });
		});

		it('exposes the matched chain on the active route, so meta resolves off it', () => {
			const router = make(['/profile/alice']);

			expect(router.route.chain.map((matched) => matched.node.id)).toEqual(['app', 'app.Profile']);
		});
	});

	describe('match', () => {
		it('resolves a URL to a target, decoding path and query params', () => {
			const router = make(['/']);

			expect(router.match('/feed?q=cats')).toEqual({ name: 'Feed', q: 'cats', sort: 'hot' });
		});

		it('leaves the router where it was, notifying nobody', () => {
			const router = make(['/']);
			let notified = 0;
			router.subscribe(() => {
				notified += 1;
			});
			const before = router.view;

			router.match('/page');

			expect(notified).toBe(0);
			expect(router.view).toBe(before);
			expect(router.location.pathname).toBe('/');
			expect(router.canGoBack).toBe(false);
		});

		it('reports an unroutable URL rather than falling back to notFound', () => {
			const router = make(['/']);

			expect(router.match('/totally/unknown')).toBeUndefined();
		});

		it('rejects a URL missing a required query param', () => {
			const router = make(['/']);

			expect(router.match('/search')).toBeUndefined();
			expect(router.match('/search?q=cats')?.name).toBe('Search');
		});

		it('resolves a relative URL against the active location, as a push would', () => {
			const router = make(['/profile/alice']);

			expect(router.match('bob')).toEqual({ name: 'Profile', actor: 'bob' });
			expect(router.match('?tab=likes')?.name).toBe('Profile');
		});

		it('yields a target that navigating back to it accepts', () => {
			const router = make(['/']);
			const target = router.match('/feed?q=cats');

			router.navigate({ to: target! });

			expect(router.location.pathname + router.location.search).toBe('/feed?q=cats&sort=hot');
		});
	});

	describe('replace', () => {
		it('patches a query param without materializing defaults or dropping the hash', () => {
			const router = make(['/feed#section']);

			router.replace('Feed', { q: 'cats' });

			expect(router.location.search).toBe('?q=cats');
			expect(router.location.hash).toBe('#section');
		});

		it('removes a query param when set to undefined', () => {
			const router = make(['/feed?q=cats']);

			router.replace('Feed', { q: undefined });

			expect(router.location.search).toBe('');
		});

		it('ignores keys that are not query params of the active route', () => {
			const router = make(['/feed']);

			// @ts-expect-error the typed API rejects a key the route does not declare.
			router.replace('Feed', { notARealParam: 'x' });

			expect(router.location.search).toBe('');
		});

		it('throws when the named route is not the active one', () => {
			const router = make(['/feed']);

			expect(() => router.replace('Search', { q: 'cats' })).toThrow(
				/replace\('Search'\) called under route 'Feed'/,
			);
			expect(router.location.search).toBe('');
		});

		it('patches in place, adding no entry to press Back through', () => {
			const router = make(['/feed?q=cats']);
			const before = router.location;

			router.replace('Feed', { q: 'dogs' });

			expect(router.location.key).toBe(before.key);
			expect(router.location.index).toBe(before.index);
			expect(router.canGoBack).toBe(false);
		});

		it('preserves the entry state, which a bare replace would drop', () => {
			const history = new MemoryHistory({ initialEntries: ['/feed'] });
			history.replace('/feed', { state: { scrollAnchor: 42 } });
			const router = new Router({ history, routes });

			router.replace('Feed', { q: 'cats' });

			expect(router.location.state).toEqual({ scrollAnchor: 42 });
		});

		it('keeps a singleton warm across a patch', () => {
			const router = make(['/search?q=cats']);
			const before = activeLeaf(router);

			router.replace('Search', { q: 'dogs' });

			expect(router.location.search).toBe('?q=dogs');
			expect(activeLeaf(router)).toBe(before);
		});

		it('keeps a page leaf warm across both a patch and an ordinary replace', () => {
			const patched = make(['/feed?q=cats']);
			const beforePatch = activeLeaf(patched);
			patched.replace('Feed', { q: 'dogs' });
			expect(activeLeaf(patched)).toBe(beforePatch);

			const replaced = make(['/feed?q=cats']);
			const beforeReplace = activeLeaf(replaced);
			replaced.navigate({ replace: true, to: '/feed?q=dogs' });
			expect(activeLeaf(replaced)).toBe(beforeReplace);
		});

		it('gives a push a fresh screen, even back onto the same route', () => {
			const router = make(['/feed?q=cats']);
			const before = activeLeaf(router);

			router.navigate({ to: '/feed?q=dogs' });

			expect(activeLeaf(router)).not.toBe(before);
		});

		it('remounts when a replace lands on a different route', () => {
			const router = make(['/feed?q=cats']);
			const before = activeLeaf(router);

			router.navigate({ replace: true, to: '/page' });

			expect(activeLeaf(router)).not.toBe(before);
		});
	});

	describe('navigate', () => {
		it('pushes by default, and replaces on request', () => {
			const router = make(['/']);

			router.navigate({ to: { name: 'Profile', actor: 'alice' } });

			expect(router.location.pathname).toBe('/profile/alice');
			expect(router.location.index).toBe(1);

			router.navigate({ replace: true, to: { name: 'Page' } });

			expect(router.location.pathname).toBe('/page');
			expect(router.location.index).toBe(1);
		});

		it('takes a URL for a destination a target cannot spell', () => {
			const router = make(['/profile/alice']);

			router.navigate({ to: '?tab=likes' });

			expect(router.location.pathname).toBe('/profile/alice');
			expect(router.location.search).toBe('?tab=likes');
		});

		it('passes entry state through to history', () => {
			const router = make(['/']);

			router.navigate({ state: { anchor: 42 }, to: { name: 'Page' } });

			expect(router.location.state).toEqual({ anchor: 42 });
		});
	});

	describe('popTo', () => {
		it('traverses back to the nearest matching entry instead of pushing a duplicate', () => {
			const router = make(['/']);
			router.navigate({ to: '/page' });
			router.navigate({ to: '/profile/alice' });

			router.popTo({ name: 'Page' });

			expect(router.location.pathname).toBe('/page');
			expect(router.location.index).toBe(1);
			expect(router.canGoForward).toBe(true);
		});

		it('matches the nearest entry, not the oldest', () => {
			const router = make(['/profile/alice']);
			router.navigate({ to: '/page' });
			router.navigate({ to: '/profile/bob' });
			router.navigate({ to: '/search?q=x' });

			router.popTo({ name: 'Profile', actor: 'bob' });

			expect(router.location.pathname).toBe('/profile/bob');
			expect(router.location.index).toBe(2);
		});

		it('stays put when already on the target, rather than stacking a duplicate', () => {
			const router = make(['/']);
			router.navigate({ to: '/page' });

			router.popTo({ name: 'Page' });

			expect(router.location.pathname).toBe('/page');
			expect(router.location.index).toBe(1);
			expect(router.canGoForward).toBe(false);
		});

		it('pushes when no entry behind us matches', () => {
			const router = make(['/']);
			router.navigate({ to: '/profile/alice' });

			router.popTo({ name: 'Page' });

			expect(router.location.pathname).toBe('/page');
			expect(router.location.index).toBe(2);
			expect(router.canGoForward).toBe(false);
		});

		it('matches on route state, so params must agree', () => {
			const router = make(['/profile/alice']);
			router.navigate({ to: '/page' });

			router.popTo({ name: 'Profile', actor: 'bob' });

			expect(router.location.pathname).toBe('/profile/bob');
			expect(router.location.index).toBe(2);
		});

		it('matches across query encodings and ordering, since it reads route state, not URL text', () => {
			const router = make(['/feed?sort=new&q=a%20b']);
			router.navigate({ to: '/page' });

			router.popTo({ name: 'Feed', q: 'a b', sort: 'new' });

			expect(router.location.pathname).toBe('/feed');
			expect(router.location.index).toBe(0);
		});

		it('matches an entry whose params decode to objects', () => {
			const router = make(['/tags?tags=a,b']);
			router.navigate({ to: '/page' });

			router.popTo({ name: 'Tags', tags: ['a', 'b'] });

			expect(router.location.pathname).toBe('/tags');
			expect(router.location.index).toBe(0);
		});

		it('pushes when an object-decoding param genuinely differs', () => {
			const router = make(['/tags?tags=a,b']);
			router.navigate({ to: '/page' });

			router.popTo({ name: 'Tags', tags: ['a', 'c'] });

			expect(router.location.pathname).toBe('/tags');
			expect(router.location.index).toBe(2);
		});
	});

	describe('subscribe identity', () => {
		it('hands out one stable subscribe function for the router`s lifetime', () => {
			const router = make();
			expect(router.subscribe).toBe(router.subscribe);
		});

		it('stays bound when detached from the instance', () => {
			const router = make();
			const { subscribe } = router;
			let seen = 0;

			const off = subscribe(() => {
				seen += 1;
			});
			router.navigate({ to: '/page' });
			off();
			router.navigate({ to: '/feed' });

			expect(seen).toBe(1);
		});
	});

	describe('dispose', () => {
		// capture listener promises that MemoryHistory normally discards.
		class AwaitingHistory extends MemoryHistory {
			readonly pending: Promise<void>[] = [];

			override listen(listener: HistoryListener): () => void {
				return super.listen((update) => {
					const result = listener(update);
					if (result instanceof Promise) {
						this.pending.push(result);
					}
					return result;
				});
			}
		}

		const settles = async (promise: Promise<void>): Promise<'pending' | 'settled'> =>
			Promise.race([
				promise.then(() => 'settled' as const),
				new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 50)),
			]);

		it('releases a navigation parked on a commit that will never arrive', async () => {
			const history = new AwaitingHistory({ initialEntries: ['/'] });
			const router = new Router({ history, routes });
			router.attachView();

			router.navigate({ to: '/page' });
			expect(history.pending).toHaveLength(1);

			router.dispose();

			expect(await settles(history.pending[0]!)).toBe('settled');
		});
	});
});

describe('Router splat navigation', () => {
	// exercised through a real history so that WHATWG URL normalization is in play; calling Matcher
	// directly bypasses the `new URL()` resolution that makes dot segments dangerous.
	const splatRoutes = defineRoutes({
		app: layout({
			children: {
				Admin: route({ component: Dummy, path: '/admin' }),
				Docs: route({ component: Dummy, params: { rest: nonEmpty() }, path: '/docs/*rest' }),
				DocsIndex: route({ component: Dummy, path: '/docs' }),
			},
			component: Dummy,
		}),
	});

	const open = (initialEntries: string[] = ['/']) =>
		new Router({ history: new MemoryHistory({ initialEntries }), routes: splatRoutes });

	// activePath holds instance keys, so anchor to the leaf's node id to keep `Docs` from matching `DocsIndex`.
	const leafIs = (router: Router<typeof splatRoutes>, leaf: string): boolean =>
		router.view.activePath.at(-1)?.startsWith(`app.${leaf}\0`) ?? false;

	it('round trips a built splat URL through navigation', () => {
		const router = open();
		const built = router.href({ name: 'Docs', rest: 'guide/intro' });
		expect(built).toBe('/docs/guide/intro');

		router.navigate({ to: built });
		expect(router.location.pathname).toBe('/docs/guide/intro');
		expect(leafIs(router, 'Docs')).toBe(true);
	});

	it('cannot build a URL that navigation would redirect into a sibling route', () => {
		const router = open();
		expect(() => router.href({ name: 'Docs', rest: '../admin' })).toThrow();

		// the escape it forecloses: had the build succeeded, this is where the URL would have landed.
		router.navigate({ to: '/docs/../admin' });
		expect(router.location.pathname).toBe('/admin');
		expect(leafIs(router, 'Admin')).toBe(true);
	});

	it('falls through to the bare parent route when the remainder is empty', () => {
		const router = open();
		router.navigate({ to: '/docs' });
		expect(leafIs(router, 'DocsIndex')).toBe(true);
	});
});

describe('Router on the navigation API', () => {
	const probeRoutes = defineRoutes({
		app: layout({
			children: {
				Other: route({ component: Dummy, path: '/other' }),
				Probe: route({ component: Dummy, path: PROBE, query: { q: optional(string()) } }),
			},
			component: Dummy,
		}),
	});

	// the router reads and writes scroll on its own window, so it has to be pointed at the probe frame too.
	const openOn = (win: Window): Router<typeof probeRoutes> =>
		disposed(
			new Router({ history: new NavigationHistory({ window: win }), routes: probeRoutes, window: win }),
		);

	const open = async (): Promise<Router<typeof probeRoutes>> => openOn(await openProbe());

	const reload = async (): Promise<Router<typeof probeRoutes>> => openOn(await reloadProbe());

	const leafOf = (router: Router<typeof probeRoutes>): string | undefined => router.view.activePath.at(-1);

	it('boots on the browser`s current entry', async () => {
		const router = await open();
		expect(router.location.pathname).toBe(PROBE);
		expect(router.route.name).toBe('Probe');
		expect(router.canGoBack).toBe(false);
	});

	it('mounts a fresh screen on a push', async () => {
		const router = await open();
		const before = leafOf(router);

		await settled(router, () => router.navigate({ to: `${PROBE}?q=a` }));

		expect(router.location.search).toBe('?q=a');
		expect(router.canGoBack).toBe(true);
		expect(leafOf(router)).not.toBe(before);
	});

	it('restores the entry`s warm screen on a back', async () => {
		const router = await open();
		const atRoot = leafOf(router);
		await settled(router, () => router.navigate({ to: `${PROBE}?q=a` }));
		const atA = leafOf(router);

		await settled(router, () => router.back());

		expect(router.location.search).toBe('');
		expect(leafOf(router)).toBe(atRoot);
		expect(leafOf(router)).not.toBe(atA);
		expect(router.canGoForward).toBe(true);
	});

	// with no view there is no commit to ride, so the router applies the offset itself.
	it('restores the entry`s scroll with no view attached', async () => {
		const win = await openProbe();
		win.document.body.style.height = '3000px';
		const router = openOn(win);
		win.scrollTo(0, 400);
		expect(win.scrollY).toBe(400);

		await settled(router, () => router.navigate({ to: '/other' }));
		await until(() => win.scrollY === 0, 'a push to reset scroll to the top');

		await settled(router, () => router.back());
		await until(() => win.scrollY === 400, 'a traversal to restore the previous entry`s scroll');
	});

	it('keeps a page leaf warm across both a patch and an ordinary replace', async () => {
		const patched = await open();
		const beforePatch = leafOf(patched);
		await settled(patched, () => patched.replace('Probe', { q: 'patched' }));
		expect(patched.location.search).toBe('?q=patched');
		expect(leafOf(patched)).toBe(beforePatch);

		const replaced = await open();
		const beforeReplace = leafOf(replaced);
		await settled(replaced, () => replaced.navigate({ replace: true, to: `${PROBE}?q=replaced` }));
		expect(replaced.location.search).toBe('?q=replaced');
		expect(leafOf(replaced)).toBe(beforeReplace);
	});

	it('patches in place, adding no entry to press Back through', async () => {
		const router = await open();
		const before = router.location;

		await settled(router, () => router.replace('Probe', { q: 'x' }));

		expect(router.location.key).toBe(before.key);
		expect(router.location.index).toBe(before.index);
		expect(router.canGoBack).toBe(false);
	});

	it('popTo traverses back to an existing entry instead of pushing a duplicate', async () => {
		const router = await open();
		await settled(router, () => router.navigate({ to: '/other' }));
		await settled(router, () => router.navigate({ to: `${PROBE}?q=z` }));
		expect(router.location.index).toBe(2);

		await settled(router, () => router.popTo({ name: 'Other' }));

		expect(router.route.name).toBe('Other');
		expect(router.location.index).toBe(1);
		expect(router.canGoForward).toBe(true);
	});

	it('popTo reaches an entry pushed before a reload', async () => {
		const stale = await open();
		await settled(stale, () => stale.navigate({ to: '/other' }));
		await settled(stale, () => stale.navigate({ to: `${PROBE}?q=z` }));

		const router = await reload();
		expect(router.location.index).toBe(2);

		await settled(router, () => router.popTo({ name: 'Other' }));

		expect(router.route.name).toBe('Other');
		expect(router.location.index).toBe(1);
	});

	it('follows the browser when a push from a non-tip entry truncates the forward entries', async () => {
		const router = await open();
		await settled(router, () => router.navigate({ to: `${PROBE}?q=a` }));
		await settled(router, () => router.navigate({ to: `${PROBE}?q=b` }));
		await settled(router, () => router.back());

		await settled(router, () => router.navigate({ to: '/other' }));

		expect(router.canGoForward).toBe(false);
		expect(router.route.name).toBe('Other');
		expect(router.location.index).toBe(2);
	});
});
