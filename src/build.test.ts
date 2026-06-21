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

	it('substitutes and encodes path params', () => {
		expect(builder.build('Profile', { actor: 'alice' })).toBe('/profile/alice');
		expect(builder.build('Profile', { actor: 'al ice' })).toBe('/profile/al%20ice');
		expect(builder.build('Post', { actor: 'alice', n: 42 })).toBe('/profile/alice/post/42');
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
});
