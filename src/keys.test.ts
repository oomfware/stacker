import { describe, expect, it } from 'vitest';

import { enumOf, optional, string } from './codec.ts';
import { instanceKey } from './keys.ts';
import { Matcher } from './match.ts';
import type { RouteMatch } from './match.ts';
import { defineRoutes, layout, route } from './routes.ts';
import { Dummy, matched } from './test-support.ts';

const registry = defineRoutes({
	app: layout({
		children: {
			Home: route({ component: Dummy, path: '/', type: 'singleton' }),
			Pair: route({
				component: Dummy,
				params: { a: string(), b: string() },
				path: '/pair/:a/:b',
				type: 'singleton',
			}),
			Profile: route({ component: Dummy, params: { actor: string() }, path: '/profile/:actor' }),
			Search: route({
				component: Dummy,
				path: '/search',
				query: { q: string(), type: optional(enumOf(['a', 'b'])) },
			}),
		},
		component: Dummy,
	}),
});

const matcher = new Matcher(registry);

const matchOf = (pathname: string, search = ''): RouteMatch => matched(matcher, pathname, search);
const leafOf = (match: RouteMatch) => match.chain[match.chain.length - 1]!;

describe('instanceKey', () => {
	it('keys a page leaf by entry id, so each navigation gets a fresh instance', () => {
		const m = matchOf('/profile/alice');
		expect(instanceKey(leafOf(m), 'i0')).not.toBe(instanceKey(leafOf(m), 'i1'));
		expect(instanceKey(leafOf(m), 'i0')).toBe(instanceKey(leafOf(m), 'i0'));
	});

	it('keys a singleton leaf by params, so it dedupes across entries', () => {
		const m = matchOf('/');
		expect(instanceKey(leafOf(m), 'i0')).toBe(instanceKey(leafOf(m), 'i9'));
	});

	it('gives a singleton a fresh instance per set of path params', () => {
		const a = matchOf('/pair/x/y');
		const b = matchOf('/pair/x/z');
		expect(instanceKey(leafOf(a), 'k')).not.toBe(instanceKey(leafOf(b), 'k'));
	});

	it('excludes query params from a singleton identity, so a query change keeps it warm', () => {
		const a = matchOf('/search', '?q=cats');
		const b = matchOf('/search', '?q=dogs&type=a');
		expect(a.params).not.toEqual(b.params);
		expect(instanceKey(leafOf(a), 'x')).toBe(instanceKey(leafOf(b), 'x'));
	});

	it('keys a pathless layout the same across entries', () => {
		const a = matchOf('/profile/alice');
		const b = matchOf('/');
		expect(instanceKey(a.chain[0]!, 'i0')).toBe(instanceKey(b.chain[0]!, 'i1'));
	});

	describe('param values that collide with the key encoding', () => {
		it('does not collide on & or =', () => {
			const a = matchOf(`/pair/${encodeURIComponent('x&b=y')}/z`);
			const b = matchOf(`/pair/x/${encodeURIComponent('y&b=z')}`);
			expect(a.params).toEqual({ a: 'x&b=y', b: 'z' });
			expect(b.params).toEqual({ a: 'x', b: 'y&b=z' });
			expect(instanceKey(leafOf(a), 'k')).not.toBe(instanceKey(leafOf(b), 'k'));
		});

		it('does not collide on NUL, the separator', () => {
			const a = matchOf(`/pair/${encodeURIComponent('x\u0000')}/y`);
			const b = matchOf(`/pair/x/${encodeURIComponent('\u0000y')}`);
			expect(instanceKey(leafOf(a), 'k')).not.toBe(instanceKey(leafOf(b), 'k'));
		});
	});
});
