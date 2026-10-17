import { describe, expect, it } from 'vitest';

import { enumOf, optional, string, withDefault } from './codec.ts';
import { defineRoutes, layout, route } from './routes.ts';
import { Dummy } from './test-support.ts';

const routes = defineRoutes({
	app: layout({
		component: Dummy,
		children: {
			Home: route({ path: '/', type: 'singleton', component: Dummy }),
			Profile: route({
				path: '/profile/:didOrHandle',
				params: { didOrHandle: string() },
				component: Dummy,
			}),
			Explore: route({ path: '/search', when: ({ rawSearch }) => !rawSearch.has('q'), component: Dummy }),
			Search: route({
				path: '/search',
				query: { q: string(), type: optional(enumOf(['feed', 'profile', 'user'])) },
				component: Dummy,
			}),
			PostThread: route({
				path: '/profile/:didOrHandle/post/:rkey',
				params: { didOrHandle: string(), rkey: string() },
				component: Dummy,
			}),
			messages: layout({
				component: Dummy,
				meta: { navGroup: 'messages' },
				children: {
					Messages: route({ path: '/messages', type: 'singleton', component: Dummy }),
					MessagesConversation: route({
						path: '/messages/:convo',
						params: { convo: string() },
						component: Dummy,
					}),
				},
			}),
		},
	}),
	StarterPackWizard: route({ path: '/starter-pack/create', component: Dummy }),
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
			expect(() => defineRoutes({ X: route({ path: '/x/:id', component: Dummy }) })).toThrow(/path params/);
		});

		it('rejects a declared param missing from the path', () => {
			expect(() =>
				defineRoutes({ X: route({ path: '/x', params: { id: string() }, component: Dummy }) }),
			).toThrow(/path params/);
		});

		it('rejects a layout param absent from a descendant path', () => {
			expect(() =>
				defineRoutes({
					profile: layout({
						params: { actor: string() },
						component: Dummy,
						children: { Leaf: route({ path: '/x/:other', params: { other: string() }, component: Dummy }) },
					}),
				}),
			).toThrow(/not present in route/);
		});

		it('rejects a name shared between a path param and a query param', () => {
			expect(() =>
				defineRoutes({
					X: route({ path: '/x/:id', params: { id: string() }, query: { id: string() }, component: Dummy }),
				}),
			).toThrow(/both a path and query/);
		});

		it('rejects a param called `name`, which a route target has no room for', () => {
			expect(() =>
				defineRoutes({
					X: route({ path: '/x/:name', params: { name: string() }, component: Dummy }),
				}),
			).toThrow(/must not declare a param named 'name'/);
			expect(() =>
				defineRoutes({ X: route({ path: '/x', query: { name: string() }, component: Dummy }) }),
			).toThrow(/must not declare a param named 'name'/);
		});

		it('rejects a duplicate route name across the tree', () => {
			expect(() =>
				defineRoutes({
					a: layout({ component: Dummy, children: { Dup: route({ path: '/a', component: Dummy }) } }),
					b: layout({ component: Dummy, children: { Dup: route({ path: '/b', component: Dummy }) } }),
				}),
			).toThrow(/duplicate route name/);
		});

		it('rejects an optional() or withDefault() path param', () => {
			expect(() =>
				defineRoutes({ X: route({ path: '/x/:id', params: { id: optional(string()) }, component: Dummy }) }),
			).toThrow(/must not be optional/);
			expect(() =>
				defineRoutes({
					X: route({ path: '/x/:id', params: { id: withDefault(string(), 'a') }, component: Dummy }),
				}),
			).toThrow(/must not be optional/);
		});

		it('accepts a named trailing splat, treating it as a required path param', () => {
			expect(() =>
				defineRoutes({ X: route({ path: '/docs/*rest', params: { rest: string() }, component: Dummy }) }),
			).not.toThrow();
			expect(() => defineRoutes({ X: route({ path: '/docs/*rest', component: Dummy }) })).toThrow(
				/path params/,
			);
		});

		it('rejects a `*` that is not a named trailing splat, which would compile to a literal asterisk', () => {
			for (const path of ['/docs/*', '/docs/*rest/edit', '/a*b']) {
				expect(() => defineRoutes({ X: route({ path, component: Dummy }) })).toThrow(/trailing splat/);
			}
		});

		it('rejects a route path that is not absolute, which could never match a pathname', () => {
			expect(() => defineRoutes({ X: route({ path: 'x', component: Dummy }) })).toThrow(/must start with/);
		});

		it('rejects a route key containing a dot, which would collide with nested node ids', () => {
			expect(() => defineRoutes({ 'a.b': route({ path: '/x', component: Dummy }) })).toThrow(
				/must not contain/,
			);
		});
	});
});
