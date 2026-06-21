import { describe, expect, it, vi } from 'vitest';

import { MemoryHistory } from './memory.ts';
import type { HistoryUpdate } from './types.ts';

const updatesOf = (history: MemoryHistory): HistoryUpdate[] => {
	const updates: HistoryUpdate[] = [];
	history.listen((update) => {
		updates.push(update);
	});
	return updates;
};

describe('MemoryHistory', () => {
	it('starts at the initial entry', () => {
		expect(new MemoryHistory().location.pathname).toBe('/');
		expect(new MemoryHistory().location.index).toBe(0);
	});

	it('accepts custom initial entries and index', () => {
		const history = new MemoryHistory({ index: 1, initialEntries: ['/a', '/b', '/c'] });
		expect(history.location.pathname).toBe('/b');
		expect(history.location.index).toBe(1);
	});

	it('exposes the whole ledger, oldest first', () => {
		const history = new MemoryHistory({ initialEntries: ['/a', '/b'] });
		history.push('/c');

		expect(history.entries().map((entry) => entry.url)).toEqual(['/a', '/b', '/c']);
		expect(history.entries().map((entry) => entry.index)).toEqual([0, 1, 2]);
		expect(history.entries().every((entry) => entry.sameDocument)).toBe(true);
	});

	describe('writes', () => {
		it('push mints a new id and key, and reports it', () => {
			const history = new MemoryHistory();
			const updates = updatesOf(history);
			const before = history.location;

			history.push('/next');

			expect(history.location.pathname).toBe('/next');
			expect(history.location.index).toBe(1);
			expect(history.location.id).not.toBe(before.id);
			expect(history.location.key).not.toBe(before.key);
			expect(updates.map((update) => update.action)).toEqual(['push']);
		});

		it('replace keeps the slot key but mints a new id', () => {
			const history = new MemoryHistory();
			const before = history.location;

			history.replace('/replaced');

			expect(history.location.pathname).toBe('/replaced');
			expect(history.location.index).toBe(0);
			expect(history.location.key).toBe(before.key);
			expect(history.location.id).not.toBe(before.id);
		});

		it('hands a write`s info marker back to listeners, by reference', () => {
			const history = new MemoryHistory();
			const updates = updatesOf(history);
			const marker = Symbol('patch');

			history.replace('/?tab=2', { info: marker });

			expect(updates[0]?.action).toBe('replace');
			expect(updates[0]?.info).toBe(marker);
		});

		it('carries state onto the entry, and back out on a traverse', () => {
			const history = new MemoryHistory();
			history.push('/a', { state: { n: 1 } });
			history.push('/b');
			expect(history.location.state).toBe(null);

			history.back();

			expect(history.location.state).toEqual({ n: 1 });
		});

		it('resolves a relative destination against the current location', () => {
			const history = new MemoryHistory({ initialEntries: ['/profile/alice'] });

			history.replace('?tab=likes');
			expect(history.location.pathname).toBe('/profile/alice');
			expect(history.location.search).toBe('?tab=likes');

			history.push('bob');
			expect(history.location.pathname).toBe('/profile/bob');
		});

		it('truncates the forward entries on a push from a non-tip entry', () => {
			const history = new MemoryHistory();
			history.push('/a');
			history.push('/b');
			history.back();

			history.push('/c');

			expect(history.entries().map((entry) => entry.url)).toEqual(['/', '/a', '/c']);
			expect(history.location.index).toBe(2);
			expect(history.canGoForward).toBe(false);
		});
	});

	describe('traversals', () => {
		it('restores the original id and key of each entry', () => {
			const history = new MemoryHistory();
			history.push('/a');
			const atA = history.location;
			history.push('/b');
			const atB = history.location;

			history.back();
			expect(history.location.id).toBe(atA.id);
			expect(history.location.key).toBe(atA.key);

			history.forward();
			expect(history.location.id).toBe(atB.id);
			expect(history.location.key).toBe(atB.key);
		});

		it('traverseTo moves to an entry by key, leaving the forward entries standing', () => {
			const history = new MemoryHistory();
			history.push('/a');
			const keyOfA = history.location.key;
			history.push('/b');
			history.push('/c');

			history.traverseTo(keyOfA);

			expect(history.location.pathname).toBe('/a');
			expect(history.entries().map((entry) => entry.url)).toEqual(['/', '/a', '/b', '/c']);
			expect(history.canGoBack).toBe(true);
			expect(history.canGoForward).toBe(true);
		});

		it('traverseTo throws for a key that is not in the ledger', () => {
			expect(() => new MemoryHistory().traverseTo('nope')).toThrow(/no history entry with key/);
		});

		it('clamps an out-of-range traversal to a no-op', () => {
			const history = new MemoryHistory();
			const listener = vi.fn();
			history.listen(listener);

			history.back();
			history.go(5);

			expect(listener).not.toHaveBeenCalled();
			expect(history.location.index).toBe(0);
		});
	});

	it('stops notifying after dispose', () => {
		const history = new MemoryHistory();
		const listener = vi.fn();
		history.listen(listener);

		history.dispose();
		history.push('/a');

		expect(listener).not.toHaveBeenCalled();
	});
});
