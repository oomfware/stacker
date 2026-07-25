import { afterEach } from 'vitest';

import type { History, HistoryUpdate } from './history/types.ts';
import type { Matcher, RouteMatch } from './match.ts';

declare module './routes.ts' {
	interface RouteMeta {
		readonly navGroup?: string;
	}
}

export const PROBE = '/nav-probe.html';

export const Dummy = (): null => null;

export const matched = (matcher: Matcher, pathname: string, search = ''): RouteMatch => {
	const match = matcher.match(pathname, search);
	if (match === undefined) {
		throw new Error(`no match for ${pathname}${search}`);
	}
	return match;
};

interface Disposable {
	dispose(): void;
}

interface Subscribable {
	subscribe(listener: () => void): () => void;
}

const disposables: Disposable[] = [];
const frames: HTMLIFrameElement[] = [];

afterEach(() => {
	for (const disposable of disposables.splice(0)) {
		disposable.dispose();
	}
	for (const frame of frames.splice(0)) {
		frame.remove();
	}
});

export const disposed = <T extends Disposable>(value: T): T => {
	disposables.push(value);
	return value;
};

const windowOf = (frame: HTMLIFrameElement): Window => {
	const win = frame.contentWindow;
	if (win === null) {
		throw new Error('probe frame has no contentWindow');
	}
	return win;
};

const currentFrame = (): HTMLIFrameElement => {
	const frame = frames.at(-1);
	if (frame === undefined) {
		throw new Error('no probe frame open');
	}
	return frame;
};

/** opens an isolated session history without navigating the test runner. */
export const openProbe = async (): Promise<Window> => {
	const frame = document.createElement('iframe');
	frame.src = PROBE;
	frame.style.width = '400px';
	frame.style.height = '300px';
	document.body.append(frame);
	frames.push(frame);
	await probeLoad();
	return windowOf(frame);
};

/** the window of the probe frame currently open, for code that cannot be handed one. */
export const probeWindow = (): Window => windowOf(currentFrame());

export const probeLoad = async (): Promise<Window> => {
	const frame = currentFrame();
	await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
	return windowOf(frame);
};

export const reloadProbe = async (): Promise<Window> => {
	const loaded = probeLoad();
	windowOf(currentFrame()).location.reload();
	return loaded;
};

/** waits for a fire-and-forget history write to commit. */
export const written = (history: History, write: () => void): Promise<HistoryUpdate> => {
	const update = new Promise<HistoryUpdate>((resolve) => {
		const off = history.listen((committed) => {
			off();
			resolve(committed);
		});
	});
	write();
	return update;
};

export const settled = (router: Subscribable, write: () => void): Promise<void> => {
	const committed = new Promise<void>((resolve) => {
		const off = router.subscribe(() => {
			off();
			resolve();
		});
	});
	write();
	return committed;
};

/** polls for browser work that lands after an intercept handler settles. */
export const until = async (predicate: () => boolean, what: string): Promise<void> => {
	for (let i = 0; i < 100; i++) {
		if (predicate()) {
			return;
		}
		// oxlint-disable-next-line no-await-in-loop -- polling is the point; these cannot run in parallel
		await sleep(10);
	}
	throw new Error(`stacker: timed out waiting for ${what}`);
};

export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
