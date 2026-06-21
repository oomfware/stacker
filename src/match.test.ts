import { describe, expect, it } from 'vitest';

import type { Codec } from './codec.ts';
import { enumOf, optional, string, withDefault } from './codec.ts';
import { Matcher, resolveMeta } from './match.ts';
import { defineRoutes, layout, route } from './routes.ts';
import { Dummy, matched } from './test-support.ts';

const code = (): Codec<string> => ({
	decode: (s) => (/^[a-z]{3}$/.test(s) ? s : undefined),
	encode: (s) => s,
});

const registry = defineRoutes({
	app: layout({
		children: {
			Home: route({ component: Dummy, path: '/', type: 'singleton' }),
			Explore: route({ component: Dummy, path: '/search', when: ({ rawSearch }) => !rawSearch.has('q') }),
			Search: route({
				component: Dummy,
				path: '/search',
				query: { q: string(), type: optional(enumOf(['feed', 'user'])) },
			}),
			Profile: route({ component: Dummy, params: { actor: string() }, path: '/profile/:actor' }),
			Post: route({
				component: Dummy,
				params: { actor: string(), code: code() },
				path: '/profile/:actor/post/:code',
			}),
			Feed: route({
				component: Dummy,
				path: '/feed',
				query: { sort: withDefault(enumOf(['hot', 'new']), 'hot') },
			}),
			messages: layout({
				children: {
					Convo: route({ component: Dummy, params: { convo: string() }, path: '/messages/:convo' }),
					Messages: route({ component: Dummy, path: '/messages', type: 'singleton' }),
				},
				component: Dummy,
			}),
		},
		component: Dummy,
	}),
});

const matcher = new Matcher(registry);

describe('Matcher', () => {
	describe('paths', () => {
		it('matches a static root path but not a double slash', () => {
			expect(matcher.match('/')?.name).toBe('Home');
			expect(matcher.match('//')).toBeUndefined();
		});

		it('returns undefined for an unmatched path', () => {
			expect(matcher.match('/nope')).toBeUndefined();
		});

		it('matches with an optional trailing slash', () => {
			expect(matcher.match('/profile/alice/')?.name).toBe('Profile');
		});

		it('matches the longer overlapping path, not the prefix', () => {
			expect(matcher.match('/profile/alice/post/abc')?.name).toBe('Post');
		});

		it('decodes a path param, percent-encoding and all', () => {
			expect(matcher.match('/profile/alice')?.params).toEqual({ actor: 'alice' });
			expect(matcher.match('/profile/al%20ice')?.params).toEqual({ actor: 'al ice' });
		});

		it('skips a route when a path codec rejects the segment', () => {
			expect(matcher.match('/profile/alice/post/abc')?.name).toBe('Post');
			expect(matcher.match('/profile/alice/post/AB')).toBeUndefined();
		});

		it('skips the whole candidate when an ancestor layout codec rejects the value', () => {
			const strict = defineRoutes({
				group: layout({
					children: { Item: route({ component: Dummy, params: { actor: string() }, path: '/g/:actor' }) },
					component: Dummy,
					params: { actor: enumOf(['alice']) },
				}),
			});
			const strictMatcher = new Matcher(strict);

			expect(strictMatcher.match('/g/alice')?.name).toBe('Item');
			expect(strictMatcher.match('/g/bob')).toBeUndefined();
		});
	});

	describe('queries', () => {
		it('decodes query params, including optional', () => {
			expect(matcher.match('/search', '?q=cats')?.params).toEqual({ q: 'cats' });
			expect(matcher.match('/search', '?q=cats&type=user')?.params).toEqual({ q: 'cats', type: 'user' });
		});

		it('skips a route when a present query value is invalid', () => {
			expect(matcher.match('/search', '?q=cats&type=bogus')).toBeUndefined();
		});

		it('applies a withDefault query when absent', () => {
			expect(matcher.match('/feed')?.params).toEqual({ sort: 'hot' });
			expect(matcher.match('/feed', '?sort=new')?.params).toEqual({ sort: 'new' });
		});

		it('disambiguates same-path routes by `when`', () => {
			expect(matcher.match('/search')?.name).toBe('Explore');
			expect(matcher.match('/search', '?q=cats')?.name).toBe('Search');
		});
	});

	it('resolves the matched chain with per-node params', () => {
		const m = matcher.match('/messages/xyz');
		expect(m?.name).toBe('Convo');
		expect(m?.chain.map((c) => c.node.id)).toEqual(['app', 'app.messages', 'app.messages.Convo']);
		expect(m?.chain.map((c) => c.params)).toEqual([{}, {}, { convo: 'xyz' }]);
	});
});

describe('resolveMeta', () => {
	const metaRoutes = defineRoutes({
		app: layout({
			children: {
				Convo: route({
					component: Dummy,
					meta: { navGroup: 'convo' },
					params: { id: string() },
					path: '/messages/:id',
				}),
				Messages: route({ component: Dummy, path: '/messages' }),
			},
			component: Dummy,
			meta: { navGroup: 'app' },
		}),
	});
	const metaMatcher = new Matcher(metaRoutes);

	it('reads the leaf`s own meta', () => {
		expect(resolveMeta(matched(metaMatcher, '/messages/abc'), 'navGroup')).toBe('convo');
	});

	it('falls back to the nearest ancestor that sets it', () => {
		expect(resolveMeta(matched(metaMatcher, '/messages'), 'navGroup')).toBe('app');
	});

	it('is undefined when no node on the chain sets it', () => {
		const bare = defineRoutes({
			app: layout({ children: { Bare: route({ component: Dummy, path: '/bare' }) }, component: Dummy }),
		});

		expect(resolveMeta(matched(new Matcher(bare), '/bare'), 'navGroup')).toBeUndefined();
	});
});
