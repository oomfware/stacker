import { describe, expect, it } from 'vitest';

import { createPath, decodeRemainder, encodeRemainder, parsePath, resolvePath } from './url.ts';

describe('parsePath', () => {
	it('splits pathname, search, and hash', () => {
		expect(parsePath('/profile/alice?tab=feeds#top')).toEqual({
			pathname: '/profile/alice',
			search: '?tab=feeds',
			hash: '#top',
		});
	});

	it('handles a bare path', () => {
		expect(parsePath('/')).toEqual({ pathname: '/', search: '', hash: '' });
	});

	it('handles a hash with no search', () => {
		expect(parsePath('/x#y')).toEqual({ pathname: '/x', search: '', hash: '#y' });
	});
});

describe('createPath', () => {
	it('joins parts back into a relative URL', () => {
		expect(createPath({ pathname: '/profile/alice', search: '?tab=feeds', hash: '#top' })).toBe(
			'/profile/alice?tab=feeds#top',
		);
	});

	it('round-trips with parsePath', () => {
		for (const url of ['/', '/x', '/x?a=1', '/x#h', '/x?a=1&b=2#h', '/profile/al%20ice']) {
			expect(createPath(parsePath(url))).toBe(url);
		}
	});
});

describe('resolvePath', () => {
	const base = { pathname: '/profile/alice', search: '?tab=feeds', hash: '' };

	it('keeps the base pathname for a search-only destination', () => {
		expect(resolvePath('?tab=likes', base)).toEqual({
			pathname: '/profile/alice',
			search: '?tab=likes',
			hash: '',
		});
	});

	it('keeps the base pathname and search for a hash-only destination', () => {
		expect(resolvePath('#top', base)).toEqual({
			pathname: '/profile/alice',
			search: '?tab=feeds',
			hash: '#top',
		});
	});

	it('replaces everything for an absolute destination', () => {
		expect(resolvePath('/messages/x', base)).toEqual({ pathname: '/messages/x', search: '', hash: '' });
	});

	it('resolves a bare relative reference against the base directory', () => {
		expect(resolvePath('bob', base).pathname).toBe('/profile/bob');
	});
});

describe('remainder encoding', () => {
	it('encodes each segment while leaving separators intact', () => {
		expect(encodeRemainder('a b/c')).toBe('a%20b/c');
		expect(encodeRemainder('')).toBe('');
	});

	it('round trips a remainder through encode and decode', () => {
		for (const value of ['', 'a', 'a/b/c', 'a b/c', 'π/ü']) {
			expect(decodeRemainder(encodeRemainder(value))).toBe(value);
		}
	});

	it('decodes an encoded separator into one indistinguishable from a real separator', () => {
		expect(decodeRemainder('a%2Fb')).toBe('a/b');
		expect(decodeRemainder('a/b')).toBe('a/b');
	});
});
