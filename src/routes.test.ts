import { describe, expect, it } from 'vitest';

import { enumOf, optional, string, withDefault } from './codec.ts';
import { defineRoutes, layout, route } from './routes.ts';
import { Dummy } from './test-support.ts';

const routes = defineRoutes({
	app: layout({
		children: {
			Home: route({ component: Dummy, path: '/', type: 'singleton' }),
			Profile: route({
				component: Dummy,
				params: { didOrHandle: string() },
				path: '/profile/:didOrHandle',
			}),
			Explore: route({ component: Dummy, path: '/search', when: ({ rawSearch }) => !rawSearch.has('q') }),
			Search: route({
				component: Dummy,
				path: '/search',
				query: { q: string(), type: optional(enumOf(['feed', 'profile', 'user'])) },
			}),
			PostThread: route({
				component: Dummy,
				params: { didOrHandle: string(), rkey: string() },
				path: '/profile/:didOrHandle/post/:rkey',
			}),
			messages: layout({
				children: {
					Messages: route({ component: Dummy, path: '/messages', type: 'singleton' }),
					MessagesConversation: route({
						component: Dummy,
						params: { convo: string() },
						path: '/messages/:convo',
					}),
				},
				component: Dummy,
				meta: { navGroup: 'messages' },
			}),
		},
		component: Dummy,
	}),
	StarterPackWizard: route({ component: Dummy, path: '/starter-pack/create' }),
});

describe('defineRoutes', () => {
	it('collects every navigable leaf by name', () => {
		expect([...routes.leaves.keys()].toSorted()).toEqual([
			'Explore',
			'Home',
			'Messages',
			'MessagesConversation',
			'PostThread',
			'Profile',
			'Search',
			'StarterPackWizard',
		]);
	});

	it('preserves declaration order of leaves, which is match precedence', () => {
		const order = [...routes.leaves.keys()];
		expect(order.indexOf('Explore')).toBeLessThan(order.indexOf('Search'));
	});

	it('resolves the full ancestor chain for a nested leaf, with stable dotted ids', () => {
		const convo = routes.leaves.get('MessagesConversation');
		expect(convo?.chain.map((n) => n.id)).toEqual([
			'app',
			'app.messages',
			'app.messages.MessagesConversation',
		]);
		expect(convo?.chain.map((n) => n.kind)).toEqual(['layout', 'layout', 'route']);
	});

	it('gives a shell-less route a one-node chain', () => {
		expect(routes.leaves.get('StarterPackWizard')?.chain.map((n) => n.id)).toEqual(['StarterPackWizard']);
	});

	it('carries layout meta on the resolved node', () => {
		const chain = routes.leaves.get('MessagesConversation')?.chain;
		expect(chain?.find((node) => node.id === 'app.messages')?.node.meta).toEqual({ navGroup: 'messages' });
	});

	describe('validation', () => {
		it('rejects a path param without a codec', () => {
			expect(() => defineRoutes({ X: route({ component: Dummy, path: '/x/:id' }) })).toThrow(/path params/);
		});

		it('rejects a declared param missing from the path', () => {
			expect(() =>
				defineRoutes({ X: route({ component: Dummy, params: { id: string() }, path: '/x' }) }),
			).toThrow(/path params/);
		});

		it('rejects a layout param absent from a descendant path', () => {
			expect(() =>
				defineRoutes({
					profile: layout({
						children: { Leaf: route({ component: Dummy, params: { other: string() }, path: '/x/:other' }) },
						component: Dummy,
						params: { actor: string() },
					}),
				}),
			).toThrow(/not present in route/);
		});

		it('rejects a name shared between a path param and a query param', () => {
			expect(() =>
				defineRoutes({
					X: route({ component: Dummy, params: { id: string() }, path: '/x/:id', query: { id: string() } }),
				}),
			).toThrow(/both a path and query/);
		});

		it('rejects a duplicate route name across the tree', () => {
			expect(() =>
				defineRoutes({
					a: layout({ children: { Dup: route({ component: Dummy, path: '/a' }) }, component: Dummy }),
					b: layout({ children: { Dup: route({ component: Dummy, path: '/b' }) }, component: Dummy }),
				}),
			).toThrow(/duplicate route name/);
		});

		it('rejects an optional() or withDefault() path param', () => {
			expect(() =>
				defineRoutes({ X: route({ component: Dummy, params: { id: optional(string()) }, path: '/x/:id' }) }),
			).toThrow(/must not be optional/);
			expect(() =>
				defineRoutes({
					X: route({ component: Dummy, params: { id: withDefault(string(), 'a') }, path: '/x/:id' }),
				}),
			).toThrow(/must not be optional/);
		});

		it('accepts a named trailing splat, treating it as a required path param', () => {
			expect(() =>
				defineRoutes({ X: route({ component: Dummy, params: { rest: string() }, path: '/docs/*rest' }) }),
			).not.toThrow();
			expect(() => defineRoutes({ X: route({ component: Dummy, path: '/docs/*rest' }) })).toThrow(
				/path params/,
			);
		});

		it('rejects a `*` that is not a named trailing splat, which would compile to a literal asterisk', () => {
			for (const path of ['/docs/*', '/docs/*rest/edit', '/a*b']) {
				expect(() => defineRoutes({ X: route({ component: Dummy, path }) })).toThrow(/trailing splat/);
			}
		});

		it('rejects a route path that is not absolute, which could never match a pathname', () => {
			expect(() => defineRoutes({ X: route({ component: Dummy, path: 'x' }) })).toThrow(/must start with/);
		});

		it('rejects a route key containing a dot, which would collide with nested node ids', () => {
			expect(() => defineRoutes({ 'a.b': route({ component: Dummy, path: '/x' }) })).toThrow(
				/must not contain/,
			);
		});
	});
});
