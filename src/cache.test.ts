import { describe, expect, it } from 'vitest';

import { computeCachedKeys } from './cache.ts';
import type { CacheEntryRef } from './cache.ts';

const entries: CacheEntryRef[] = [
	{ index: 0, key: 'a' },
	{ index: 1, key: 'b' },
	{ index: 2, key: 'c' },
	{ index: 3, key: 'd' },
];

describe('computeCachedKeys', () => {
	it('always keeps the active entry', () => {
		const cached = computeCachedKeys(entries, 3, ['d', 'c', 'b', 'a'], { max: 0 });
		expect([...cached]).toEqual(['d']);
	});

	it('drops entries ahead of the active one (forward-drop)', () => {
		const cached = computeCachedKeys(entries, 1, ['b', 'a', 'c', 'd'], { max: 5 });
		expect(cached.has('c')).toBe(false);
		expect(cached.has('d')).toBe(false);
		expect(cached.has('b')).toBe(true);
		expect(cached.has('a')).toBe(true);
	});

	it('keeps up to `max` backward entries by recency', () => {
		const cached = computeCachedKeys(entries, 3, ['d', 'a', 'b', 'c'], { max: 1 });
		expect(cached.has('d')).toBe(true);
		expect(cached.has('a')).toBe(true);
		expect(cached.has('b')).toBe(false);
		expect(cached.has('c')).toBe(false);
	});

	it('falls back to highest-index backward entries when recency is incomplete', () => {
		const cached = computeCachedKeys(entries, 3, [], { max: 2 });
		expect(cached.has('d')).toBe(true);
		expect(cached.has('c')).toBe(true);
		expect(cached.has('b')).toBe(true);
		expect(cached.has('a')).toBe(false);
	});

	it('never double-counts a repeated recency key', () => {
		const cached = computeCachedKeys(entries, 3, ['c', 'c', 'c', 'b'], { max: 2 });
		expect([...cached].toSorted()).toEqual(['b', 'c', 'd']);
	});

	it('throws when there is no entry at the active index', () => {
		expect(() => computeCachedKeys(entries, 9, [], { max: 2 })).toThrow(/no history entry at active index/);
	});
});
