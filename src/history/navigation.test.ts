import { describe, expect, it } from 'vitest';

import { disposed, openProbe, probeLoad, PROBE, sleep, until, written } from '../test-support.ts';

import { NavigationHistory } from './navigation.ts';
import type { NavigationHistoryOptions } from './navigation.ts';
import type { History, HistoryUpdate } from './types.ts';

interface Probe {
	readonly history: NavigationHistory;
	readonly win: Window & { sentinel?: string };
}

const open = async (options: Omit<NavigationHistoryOptions, 'window'> = {}): Promise<Probe> => {
	const win = await openProbe();
	return { history: disposed(new NavigationHistory({ ...options, window: win })), win };
};

const urls = (history: History): (string | null)[] => history.entries().map((entry) => entry.url);

const reported = (history: History): HistoryUpdate[] => {
	const updates: HistoryUpdate[] = [];
	history.listen((update) => {
		updates.push(update);
	});
	return updates;
};

describe('NavigationHistory', () => {
	it('starts on the document it was constructed against', async () => {
		const { history } = await open();
		expect(history.location.pathname).toBe(PROBE);
		expect(history.location.index).toBe(0);
		expect(history.canGoBack).toBe(false);
		expect(history.canGoForward).toBe(false);
	});

	it('stops reporting after dispose', async () => {
		const { history } = await open();
		const updates = reported(history);

		history.dispose();
		history.push(`${PROBE}?n=after`);
		await sleep(50);

		expect(updates).toEqual([]);
	});

	describe('writes', () => {
		it('push adds an entry with a new key and id', async () => {
			const { history } = await open();
			const before = history.location;

			const update = await written(history, () => history.push(`${PROBE}?n=a`));

			expect(update.action).toBe('push');
			expect(history.location.search).toBe('?n=a');
			expect(history.location.index).toBe(before.index + 1);
			expect(history.location.key).not.toBe(before.key);
			expect(history.location.id).not.toBe(before.id);
			expect(history.canGoBack).toBe(true);
		});

		// stacker's slot identity depends on the browser preserving keys across replacements.
		it('replace keeps the slot key, mints a new id, and adds no entry', async () => {
			const { history } = await open();
			await written(history, () => history.push(`${PROBE}?n=a`));
			const before = history.location;

			const update = await written(history, () => history.replace(`${PROBE}?n=b`));

			expect(update.action).toBe('replace');
			expect(history.location.key).toBe(before.key);
			expect(history.location.id).not.toBe(before.id);
			expect(history.location.index).toBe(before.index);
			expect(history.entries()).toHaveLength(2);
		});

		it('hands a write`s info marker back to listeners, by reference', async () => {
			const { history } = await open();
			const marker = Symbol('patch');

			const update = await written(history, () => history.replace(`${PROBE}?n=patched`, { info: marker }));

			expect(update.info).toBe(marker);
		});

		it('carries per-entry state, and restores it on a traverse', async () => {
			const { history } = await open();
			await written(history, () => history.push(`${PROBE}?n=a`, { state: { n: 'a' } }));
			await written(history, () => history.push(`${PROBE}?n=b`, { state: { n: 'b' } }));
			expect(history.location.state).toEqual({ n: 'b' });

			const update = await written(history, () => history.back());

			expect(update.action).toBe('traverse');
			expect(history.location.state).toEqual({ n: 'a' });
		});

		it('updateState rewrites the active entry in place, adding no entry or revision', async () => {
			const { history } = await open();
			await written(history, () => history.push(`${PROBE}?n=a`, { state: { n: 'a' } }));
			const before = history.location;
			const updates = reported(history);

			history.updateState({ n: 'patched' });

			expect(history.location.state).toEqual({ n: 'patched' });
			expect(history.location.id).toBe(before.id);
			expect(history.location.key).toBe(before.key);
			expect(history.location.index).toBe(before.index);
			expect(history.entries()).toHaveLength(2);
			expect(updates.map((update) => update.action)).toEqual(['update']);
			expect(updates[0]?.scroll).toBe('preserve');
		});

		it('updateState survives a traverse away and back', async () => {
			const { history } = await open();
			await written(history, () => history.push(`${PROBE}?n=a`));
			history.updateState({ n: 'patched' });

			await written(history, () => history.back());
			await written(history, () => history.forward());

			expect(history.location.state).toEqual({ n: 'patched' });
		});

		it('updateState throws on state the browser cannot serialize', async () => {
			const { history } = await open();
			await written(history, () => history.push(`${PROBE}?n=a`, { state: { n: 'a' } }));

			expect(() => history.updateState(() => 'nope')).toThrow();
			expect(history.location.state).toEqual({ n: 'a' });
		});

		it('truncates the forward entries on a push from a non-tip entry', async () => {
			const { history } = await open();
			await written(history, () => history.push(`${PROBE}?n=a`));
			const keyOfA = history.location.key;
			await written(history, () => history.push(`${PROBE}?n=b`));
			await written(history, () => history.traverseTo(keyOfA));

			await written(history, () => history.push(`${PROBE}?n=c`));

			expect(urls(history)).toEqual([PROBE, `${PROBE}?n=a`, `${PROBE}?n=c`]);
			expect(history.canGoForward).toBe(false);
		});

		it('traverseTo moves by key, leaving the forward entries standing', async () => {
			const { history } = await open();
			await written(history, () => history.push(`${PROBE}?n=a`));
			const keyOfA = history.location.key;
			await written(history, () => history.push(`${PROBE}?n=b`));
			await written(history, () => history.push(`${PROBE}?n=c`));

			const update = await written(history, () => history.traverseTo(keyOfA));

			expect(update.action).toBe('traverse');
			expect(history.location.search).toBe('?n=a');
			expect(urls(history)).toEqual([PROBE, `${PROBE}?n=a`, `${PROBE}?n=b`, `${PROBE}?n=c`]);
			expect(history.canGoForward).toBe(true);
		});
	});

	describe('navigations it did not initiate', () => {
		it('reports one the page made itself', async () => {
			const { history, win } = await open();

			const update = await written(history, () => {
				win.navigation.navigate(`${PROBE}?n=elsewhere`, { history: 'push' });
			});

			expect(update.action).toBe('push');
			expect(history.location.search).toBe('?n=elsewhere');
		});

		it('reports a state write the page made itself, keeping its cached location in step', async () => {
			const { history, win } = await open();
			const updates = reported(history);

			win.navigation.updateCurrentEntry({ state: { n: 'outside' } });

			expect(updates.map((update) => update.action)).toEqual(['update']);
			expect(history.location.state).toEqual({ n: 'outside' });
		});

		// `currententrychange` fires for navigations too, which the intercept handler already reports.
		it('reports a navigation once, not twice', async () => {
			const { history } = await open();
			const updates = reported(history);

			await written(history, () => history.push(`${PROBE}?n=a`));
			await written(history, () => history.replace(`${PROBE}?n=b`));
			await written(history, () => history.back());
			await sleep(50);

			expect(updates.map((update) => update.action)).toEqual(['push', 'replace', 'traverse']);
		});

		it('leaves a download to the browser, and reports nothing', async () => {
			const { history, win } = await open();
			win.sentinel = 'alive';
			const updates = reported(history);

			const anchor = win.document.createElement('a');
			anchor.href = '/robots.txt';
			anchor.setAttribute('download', '');
			win.document.body.append(anchor);
			anchor.click();
			await sleep(100);

			expect(updates).toEqual([]);
			expect(win.sentinel).toBe('alive');
		});
	});

	describe('scroll and focus', () => {
		const focusedInput = (win: Window): HTMLInputElement => {
			const input = win.document.createElement('input');
			win.document.body.append(input);
			input.focus();
			if (win.document.activeElement !== input) {
				throw new Error('the probe input did not take focus');
			}
			return input;
		};

		it('turns off the browser`s own scroll restoration, which the router replaces', async () => {
			const { win } = await open();
			expect(win.history.scrollRestoration).toBe('manual');
		});

		it('leaves the viewport where it is, reporting the behavior for the router to act on', async () => {
			const { history, win } = await open();
			win.document.body.style.height = '3000px';
			win.scrollTo(0, 500);
			expect(win.scrollY).toBe(500);

			const pushed = await written(history, () => history.push(`${PROBE}?n=a`));
			await sleep(100);
			expect(pushed.scroll).toBe('auto');
			expect(win.scrollY).toBe(500);

			const traversed = await written(history, () => history.back());
			await sleep(100);
			expect(traversed.scroll).toBe('auto');
			expect(win.scrollY).toBe(500);
		});

		it('reports a preserved write, so the router knows to leave the viewport alone', async () => {
			const { history } = await open();

			const update = await written(history, () => history.replace(`${PROBE}?q=ab`, { scroll: 'preserve' }));

			expect(update.scroll).toBe('preserve');
		});

		it('lets the browser move focus off the old content on an ordinary write', async () => {
			const { history, win } = await open();
			const input = focusedInput(win);

			await written(history, () => history.push(`${PROBE}?n=a`));

			await until(() => win.document.activeElement !== input, 'the browser to reset focus after a push');
		});

		it('holds focus on a preserved write, so a param patch cannot blur the input being typed into', async () => {
			const { history, win } = await open();
			const input = focusedInput(win);

			await written(history, () => history.replace(`${PROBE}?q=ab`, { scroll: 'preserve' }));
			await sleep(100);

			expect(win.document.activeElement).toBe(input);
		});
	});

	describe('failures', () => {
		const caught = async (): Promise<{ errors: unknown[]; history: NavigationHistory }> => {
			const errors: unknown[] = [];
			const { history } = await open({
				onError: (error) => {
					errors.push(error);
				},
			});
			return { errors, history };
		};

		it('reports an in-app render that threw, instead of leaving a silent no-op', async () => {
			const { errors, history } = await caught();
			history.listen(() => {
				throw new Error('the render blew up');
			});

			history.push(`${PROBE}?n=a`);
			await until(() => errors.length > 0, 'the failed render to be reported');

			expect((errors[0] as Error).message).toBe('the render blew up');
		});

		it('hands a traversal the browser refuses to its caller, who has a fallback', async () => {
			const { errors, history } = await caught();

			await expect(history.traverseTo('not-a-key')).rejects.toThrow();
			await sleep(50);

			expect(errors).toEqual([]);
		});

		it('stays quiet when one navigation cuts another short', async () => {
			const { errors, history } = await caught();

			history.push(`${PROBE}?n=a`);
			history.push(`${PROBE}?n=b`);
			await until(() => history.location.search === '?n=b', 'the second push to land');
			await sleep(50);

			expect(errors).toEqual([]);
		});
	});

	describe('ignore', () => {
		it('hands an ignored push to the browser as a real page load, and reports nothing', async () => {
			const { history, win } = await open({ ignore: (url) => url.searchParams.has('server') });
			// a page load replaces the document behind the stable WindowProxy.
			win.sentinel = 'alive';
			const updates = reported(history);

			const loaded = probeLoad();
			history.push(`${PROBE}?server=1`);
			const reloaded: typeof win = await loaded;

			expect(reloaded.sentinel).toBeUndefined();
			expect(updates).toEqual([]);
		});

		it('never consults ignore for a traversal, which would strand the router on an unrendered entry', async () => {
			let armed = false;
			const { history } = await open({ ignore: () => armed });
			await written(history, () => history.push(`${PROBE}?n=a`));
			await written(history, () => history.push(`${PROBE}?n=b`));

			// arm after creating the entries so only the traversal exercises the carve-out.
			armed = true;

			const update = await written(history, () => history.back());

			expect(update.action).toBe('traverse');
			expect(history.location.search).toBe('?n=a');
		});
	});
});
