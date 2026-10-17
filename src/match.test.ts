import { describe, expect, it } from 'vitest';

import type { Codec } from './codec.ts';
import { enumOf, nonEmpty, optional, string, withDefault } from './codec.ts';
import { Matcher, resolveMeta } from './match.ts';
import { defineRoutes, layout, route } from './routes.ts';
import { Dummy, matched } from './test-support.ts';

const code = (): Codec<string> => ({
	decode: (s) => (/^[a-z]{3}$/.test(s) ? s : undefined),
	encode: (s) => s,
});

const registry = defineRoutes({
	app: layout({
		component: Dummy,
		children: {
			Home: route({ path: '/', type: 'singleton', component: Dummy }),
			Explore: route({ path: '/search', when: ({ rawSearch }) => !rawSearch.has('q'), component: Dummy }),
			Search: route({
				path: '/search',
				query: { q: string(), type: optional(enumOf(['feed', 'user'])) },
				component: Dummy,
			}),
			Profile: route({ path: '/profile/:actor', params: { actor: string() }, component: Dummy }),
			Post: route({
				path: '/profile/:actor/post/:code',
				params: { actor: string(), code: code() },
				component: Dummy,
			}),
			Feed: route({
				path: '/feed',
				query: { sort: withDefault(enumOf(['hot', 'new']), 'hot') },
				component: Dummy,
			}),
			messages: layout({
				component: Dummy,
				children: {
					Convo: route({ path: '/messages/:convo', params: { convo: string() }, component: Dummy }),
					Messages: route({ path: '/messages', type: 'singleton', component: Dummy }),
				},
			}),
		},
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
					params: { actor: enumOf(['alice']) },
					component: Dummy,
					children: { Item: route({ path: '/g/:actor', params: { actor: string() }, component: Dummy }) },
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

	describe('splats', () => {
		const splatRoutes = defineRoutes({
			Docs: route({ path: '/docs/*rest', params: { rest: string() }, component: Dummy }),
			Files: route({ path: '/files/*rest', params: { rest: nonEmpty() }, component: Dummy }),
			Scoped: route({
				path: '/u/:actor/tree/*rest',
				params: { actor: string(), rest: string() },
				component: Dummy,
			}),
			Catchall: route({ path: '/*rest', params: { rest: string() }, component: Dummy }),
		});
		const splatMatcher = new Matcher(splatRoutes);

		it('captures the remainder across separators', () => {
			expect(splatMatcher.match('/docs/a/b/c')?.params).toEqual({ rest: 'a/b/c' });
		});

		it('matches the bare parent path with an empty remainder', () => {
			expect(splatMatcher.match('/docs')?.name).toBe('Docs');
			expect(splatMatcher.match('/docs')?.params).toEqual({ rest: '' });
		});

		it('treats a trailing slash as an empty remainder', () => {
			expect(splatMatcher.match('/docs/')?.params).toEqual({ rest: '' });
		});

		it('lets a codec reject the empty remainder to demand a trailing segment', () => {
			expect(splatMatcher.match('/files/a/b')?.params).toEqual({ rest: 'a/b' });
			expect(splatMatcher.match('/files')?.name).toBe('Catchall');
		});

		it('combines a splat with preceding dynamic params', () => {
			expect(splatMatcher.match('/u/alice/tree/src/index.ts')?.params).toEqual({
				actor: 'alice',
				rest: 'src/index.ts',
			});
		});

		it('decodes the remainder per segment, leaving separators intact', () => {
			expect(splatMatcher.match('/docs/a%20b/c')?.params).toEqual({ rest: 'a b/c' });
		});

		it('matches the root path from a root-level splat', () => {
			expect(splatMatcher.match('/')?.params).toEqual({ rest: '' });
		});

		it('is shadowed by an earlier sibling, since matching follows declaration order', () => {
			const ordered = defineRoutes({
				Wild: route({ path: '/docs/*rest', params: { rest: string() }, component: Dummy }),
				Settings: route({ path: '/docs/settings', component: Dummy }),
			});

			expect(new Matcher(ordered).match('/docs/settings')?.name).toBe('Wild');
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
			component: Dummy,
			meta: { navGroup: 'app' },
			children: {
				Convo: route({
					path: '/messages/:id',
					params: { id: string() },
					component: Dummy,
					meta: { navGroup: 'convo' },
				}),
				Messages: route({ path: '/messages', component: Dummy }),
			},
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
			app: layout({ component: Dummy, children: { Bare: route({ path: '/bare', component: Dummy }) } }),
		});

		expect(resolveMeta(matched(new Matcher(bare), '/bare'), 'navGroup')).toBeUndefined();
	});
});
