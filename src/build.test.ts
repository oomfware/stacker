import { describe, expect, it } from 'vitest';

import { Builder } from './build.ts';
import { enumOf, integer, optional, string, withDefault } from './codec.ts';
import { Matcher } from './match.ts';
import { defineRoutes, layout, route } from './routes.ts';
import { Dummy } from './test-support.ts';

const registry = defineRoutes({
	app: layout({
		children: {
			Feed: route({
				component: Dummy,
				path: '/feed',
				query: { sort: withDefault(enumOf(['hot', 'new']), 'hot') },
			}),
			Home: route({ component: Dummy, path: '/', type: 'singleton' }),
			Post: route({
				component: Dummy,
				params: { actor: string(), n: integer() },
				path: '/profile/:actor/post/:n',
			}),
			Profile: route({ component: Dummy, params: { actor: string() }, path: '/profile/:actor' }),
			Search: route({
				component: Dummy,
				path: '/search',
				query: { q: string(), type: optional(enumOf(['feed', 'user'])) },
			}),
		},
		component: Dummy,
	}),
});

const builder = new Builder(registry);
const matcher = new Matcher(registry);

const parse = (url: string): { pathname: string; search: string } => {
	const i = url.indexOf('?');
	return i < 0 ? { pathname: url, search: '' } : { pathname: url.slice(0, i), search: url.slice(i) };
};

describe('Builder', () => {
	it('builds a static path', () => {
		expect(builder.build('Home')).toBe('/');
	});

	it('rejects a dot segment in a path param, which URL normalization would resolve away', () => {
		expect(() => builder.build('Profile', { actor: '..' })).toThrow(/cannot contain a '\.\.' segment/);
		expect(() => builder.build('Profile', { actor: '.' })).toThrow();
		expect(() => builder.build('Post', { actor: '..', n: 1 })).toThrow();
	});

	it('allows dots in a path param that do not form a whole segment', () => {
		expect(builder.build('Profile', { actor: '..x' })).toBe('/profile/..x');
		expect(builder.build('Profile', { actor: 'a.b' })).toBe('/profile/a.b');
		// the separator percent-encodes away, so this stays a single harmless segment.
		expect(builder.build('Profile', { actor: 'a/..' })).toBe('/profile/a%2F..');
	});

	it('substitutes and encodes path params', () => {
		expect(builder.build('Profile', { actor: 'alice' })).toBe('/profile/alice');
		expect(builder.build('Profile', { actor: 'al ice' })).toBe('/profile/al%20ice');
		expect(builder.build('Post', { actor: 'alice', n: 42 })).toBe('/profile/alice/post/42');
	});

	it('encodes a separator in a path param so it cannot escape its segment', () => {
		expect(builder.build('Profile', { actor: 'a/b' })).toBe('/profile/a%2Fb');
		expect(builder.build('Post', { actor: 'a/b', n: 1 })).toBe('/profile/a%2Fb/post/1');
	});

	it('appends present query params', () => {
		expect(builder.build('Search', { q: 'cats' })).toBe('/search?q=cats');
		expect(builder.build('Search', { q: 'cats', type: 'user' })).toBe('/search?q=cats&type=user');
	});

	it('omits absent optional and defaulted query params', () => {
		expect(builder.build('Feed')).toBe('/feed');
		expect(builder.build('Feed', { sort: 'new' })).toBe('/feed?sort=new');
	});

	it('throws on an unknown route', () => {
		// @ts-expect-error 'Nope' is not a route name.
		expect(() => builder.build('Nope')).toThrow(/unknown route/);
	});

	it('throws when a required path param is missing', () => {
		// @ts-expect-error the typed API requires `actor`.
		expect(() => builder.build('Profile', {})).toThrow(/missing path param/);
	});

	it('throws when a required query param is missing', () => {
		// @ts-expect-error the typed API requires `q`.
		expect(() => builder.build('Search', {})).toThrow(/missing required query param/);
	});

	describe('round trip with the matcher', () => {
		it('builds URLs that match back to the same route and params', () => {
			// erase the route generic for the heterogeneous table.
			const buildLoose = builder.build.bind(builder) as (
				name: string,
				params: Record<string, unknown>,
			) => string;
			const cases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
				['Feed', { sort: 'new' }],
				['Post', { actor: 'bob', n: 7 }],
				['Profile', { actor: 'a/b' }],
				['Profile', { actor: 'alice' }],
				['Search', { q: 'cats', type: 'feed' }],
			];

			for (const [name, params] of cases) {
				const { pathname, search } = parse(buildLoose(name, params));
				const matched = matcher.match(pathname, search);
				expect(matched?.name).toBe(name);
				expect(matched?.params).toEqual(params);
			}
		});

		it('omits a defaulted query, and the bare URL decodes back to the default', () => {
			const { pathname, search } = parse(builder.build('Feed', {}));
			expect(matcher.match(pathname, search)?.params).toEqual({ sort: 'hot' });
		});
	});

	describe('splats', () => {
		const splatRoutes = defineRoutes({
			Docs: route({ component: Dummy, params: { rest: string() }, path: '/docs/*rest' }),
			Scoped: route({
				component: Dummy,
				params: { actor: string(), rest: string() },
				path: '/u/:actor/tree/*rest',
			}),
		});
		const splatBuilder = new Builder(splatRoutes);
		const splatMatcher = new Matcher(splatRoutes);

		it('appends the remainder, encoding each segment but keeping separators', () => {
			expect(splatBuilder.build('Docs', { rest: 'a b/c' })).toBe('/docs/a%20b/c');
		});

		it('drops the trailing slash when the remainder is empty', () => {
			expect(splatBuilder.build('Docs', { rest: '' })).toBe('/docs');
		});

		it('round trips, so canonicalizing a match is a fixed point', () => {
			for (const rest of ['', 'a', 'a/b/c', 'a b/c']) {
				const built = splatBuilder.build('Docs', { rest });
				const matched = splatMatcher.match(built);
				expect(matched?.name).toBe('Docs');
				expect(matched?.params).toEqual({ rest });
				expect(splatBuilder.build('Docs', matched?.params as { rest: string })).toBe(built);
			}
		});

		it('rejects dot segments, which URL normalization would resolve into another route', () => {
			expect(() => splatBuilder.build('Docs', { rest: '../x' })).toThrow(/cannot contain a '\.\.' segment/);
			expect(() => splatBuilder.build('Docs', { rest: 'a/../x' })).toThrow();
			expect(() => splatBuilder.build('Docs', { rest: 'a/./x' })).toThrow();
			expect(() => splatBuilder.build('Docs', { rest: '..' })).toThrow();
			expect(() => splatBuilder.build('Docs', { rest: '.' })).toThrow();
		});

		it('allows dots that do not form a whole segment', () => {
			expect(splatBuilder.build('Docs', { rest: 'a../x' })).toBe('/docs/a../x');
			expect(splatBuilder.build('Docs', { rest: '.hidden/..x' })).toBe('/docs/.hidden/..x');
			expect(splatBuilder.build('Docs', { rest: 'index.ts' })).toBe('/docs/index.ts');
		});

		it('escapes a remainder that spells a dot segment percent-encoded', () => {
			// `%2E%2E` would normalize like `..`, so the encoded form must not decode back into one.
			const built = splatBuilder.build('Docs', { rest: '%2E%2E' });
			expect(built).toBe('/docs/%252E%252E');
			expect(splatMatcher.match(built)?.params).toEqual({ rest: '%2E%2E' });
		});

		it('round trips alongside preceding dynamic params', () => {
			const built = splatBuilder.build('Scoped', { actor: 'alice', rest: 'src/index.ts' });
			expect(built).toBe('/u/alice/tree/src/index.ts');
			expect(splatMatcher.match(built)?.params).toEqual({ actor: 'alice', rest: 'src/index.ts' });
		});
	});
});
