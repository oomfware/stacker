import { isWebKit } from '../webkit.ts';

import type {
	History,
	HistoryAction,
	HistoryEntry,
	HistoryListener,
	HistoryLocation,
	HistoryNavigateOptions,
	HistoryScrollBehavior,
	HistoryUpdate,
} from './types.ts';

/** options for navigation-api history. */
export interface NavigationHistoryOptions {
	/** window instance to bind to; defaults to global window. */
	readonly window?: Window;
	/**
	 * same-origin destinations the server owns, which the browser should load as a real page rather than the
	 * router rendering in-app — an OAuth entry point, a server-rendered admin area, a static file. without this
	 * every same-origin URL is handled in-app, since the browser offers to intercept a navigation whenever the
	 * origin matches, whatever the destination is.
	 *
	 * consulted for pushes and replaces only. a traversal is always handled: declining one loads nothing, it
	 * just moves the browser to an entry this document never rendered.
	 *
	 * @param url destination URL
	 * @returns true to leave the navigation to the browser
	 */
	readonly ignore?: (url: URL) => boolean;
	/**
	 * handles navigation and render failures. defaults to `Window.reportError`.
	 *
	 * @param error failure reason
	 */
	readonly onError?: (error: unknown) => void;
}

const ENVELOPE = Symbol('stacker.historyInfo');

interface Envelope {
	readonly [ENVELOPE]: true;
	readonly scroll: HistoryScrollBehavior;
	readonly info: unknown;
}

const isEnvelope = (value: unknown): value is Envelope =>
	typeof value === 'object' && value !== null && ENVELOPE in value;

const toAction = (type: NavigationType): HistoryAction | undefined => {
	switch (type) {
		case 'push':
		case 'replace':
		case 'traverse': {
			return type;
		}
		default: {
			return undefined;
		}
	}
};

// errors can come from a different realm, so compare their names.
const isAbort = (error: unknown): boolean =>
	typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';

/**
 * history implementation backed by the web navigation API.
 *
 * intercepting same-document navigations converts standard page loads into in-app renders. per-revision
 * metadata and indices are managed natively by the browser.
 */
export class NavigationHistory implements History {
	readonly #ignore: ((url: URL) => boolean) | undefined;
	readonly #listeners = new Set<HistoryListener>();
	readonly #nav: Navigation;
	readonly #onError: (error: unknown) => void;
	readonly #win: Window;
	#disposed = false;
	#location: HistoryLocation;

	// WebKit gets two traversal workarounds:
	// - it delays dismissing the swipe-back snapshot when a traversal is intercepted with a wheel listener
	//   attached (https://bugs.webkit.org/show_bug.cgi?id=319414), so traversals render through
	//   `currententrychange` instead of being intercepted.
	// - in a tab Safari restored from a previous session, navigation API traversals are queued and never run
	//   until some other traversal flushes them, while `history.go()` still goes through, so traversals are
	//   made through the legacy history API.
	readonly #webkit: boolean;

	constructor(options: NavigationHistoryOptions = {}) {
		this.#win = options.window ?? window;
		this.#nav = this.#win.navigation;
		this.#ignore = options.ignore;
		this.#webkit = isWebKit(this.#win.navigator.userAgent);
		this.#onError =
			options.onError ??
			((error: unknown) => {
				this.#win.reportError(error);
			});
		this.#location = this.#read();
		this.#nav.addEventListener('currententrychange', this.#onCurrentEntryChange);
		this.#nav.addEventListener('navigate', this.#onNavigate);
		this.#nav.addEventListener('navigateerror', this.#onNavigateError);
		if (this.#webkit) {
			this.#win.addEventListener('popstate', this.#onPopState);
		}

		this.#win.addEventListener('beforeunload', this.#suspendScrollRestoration);
		this.#win.addEventListener('pagehide', this.#suspendScrollRestoration);
		this.#win.addEventListener('pageshow', this.#onPageShow);
	}

	get location(): HistoryLocation {
		return this.#location;
	}

	get canGoBack(): boolean {
		return this.#nav.canGoBack;
	}

	get canGoForward(): boolean {
		return this.#nav.canGoForward;
	}

	entries(): readonly HistoryEntry[] {
		return this.#nav.entries().map((entry) => ({
			key: entry.key,
			id: entry.id,
			index: entry.index,
			url: toRelative(entry.url),
			sameDocument: entry.sameDocument,
			state: entry.getState(),
		}));
	}

	push(to: string, options: HistoryNavigateOptions = {}): void {
		this.#navigate(to, 'push', options);
	}

	replace(to: string, options: HistoryNavigateOptions = {}): void {
		this.#navigate(to, 'replace', options);
	}

	updateState(state: unknown): void {
		this.#nav.updateCurrentEntry({ state });
	}

	traverseTo(key: string): Promise<void> {
		if (this.#webkit) {
			return this.#traverseLegacy(key);
		}
		return this.#track(this.#nav.traverseTo(key));
	}

	go(delta: number): void {
		const entries = this.#nav.entries();
		const target = entries[Math.max(0, Math.min(this.#location.index + delta, entries.length - 1))];
		if (target === undefined || target.key === this.#location.key) {
			return;
		}
		this.#report(this.traverseTo(target.key));
	}

	back(): void {
		if (!this.#nav.canGoBack) {
			return;
		}
		if (this.#webkit) {
			this.#win.history.back();
			return;
		}
		this.#report(this.#track(this.#nav.back()));
	}

	forward(): void {
		if (!this.#nav.canGoForward) {
			return;
		}
		if (this.#webkit) {
			this.#win.history.forward();
			return;
		}
		this.#report(this.#track(this.#nav.forward()));
	}

	listen(listener: HistoryListener): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	dispose(): void {
		this.#disposed = true;
		this.#nav.removeEventListener('currententrychange', this.#onCurrentEntryChange);
		this.#nav.removeEventListener('navigate', this.#onNavigate);
		this.#nav.removeEventListener('navigateerror', this.#onNavigateError);
		this.#win.removeEventListener('popstate', this.#onPopState);
		this.#win.removeEventListener('beforeunload', this.#suspendScrollRestoration);
		this.#win.removeEventListener('pagehide', this.#suspendScrollRestoration);
		this.#win.removeEventListener('pageshow', this.#onPageShow);
		this.#listeners.clear();
	}

	async #traverseLegacy(key: string): Promise<void> {
		const target = this.#nav.entries().find((entry) => entry.key === key);
		if (target === undefined) {
			throw new DOMException(`no history entry with the key '${key}'`, 'InvalidStateError');
		}
		const delta = target.index - this.#location.index;
		// `history.go(0)` reloads the page.
		if (delta !== 0) {
			this.#win.history.go(delta);
		}
	}

	// same-document entries stay on 'auto', as iOS WebKit drops a 'manual' entry's swipe-back snapshot
	// unless the scroll offset still matches it. the router positions the viewport either way.
	//
	// the entry turns 'manual' as the document is left, so a reload or cross-document return starts at the
	// top. Firefox records the mode before `pagehide`, hence `beforeunload`; iOS Safari only fires
	// `pagehide`. a loaded document keeps 'manual' until it navigates, as iOS WebKit reads the mode after load
	// to decide whether to restore a reloaded entry's offset; only a bfcache return resumes right away.
	readonly #suspendScrollRestoration = (): void => {
		this.#win.history.scrollRestoration = 'manual';
	};

	readonly #resumeScrollRestoration = (): void => {
		this.#win.history.scrollRestoration = 'auto';
	};

	readonly #onPageShow = (event: PageTransitionEvent): void => {
		if (event.persisted) {
			this.#resumeScrollRestoration();
		}
	};

	// traversing into an entry Safari restored from a previous session fires only `popstate`, leaving the
	// navigation API without a current entry and the view on the page we left. nothing recovers the
	// navigation API in this document, so load the destination afresh.
	//
	// an ordinary traversal fires `currententrychange` first, and `#traverseUnintercepted` updates `#location`
	// before its first await, so a matching key here means the traversal was already handled.
	readonly #onPopState = (): void => {
		const entry = this.#nav.currentEntry;
		if (entry !== null && entry.key === this.#location.key) {
			return;
		}
		this.dispose();
		this.#win.location.reload();
	};

	// render failures also reach `navigateerror`.
	#track(result: NavigationResult): Promise<void> {
		result.finished?.catch(() => {});
		return result.committed?.then(() => undefined) ?? Promise.resolve();
	}

	#fail(error: unknown): void {
		if (this.#disposed || isAbort(error)) {
			return;
		}
		this.#onError(error);
	}

	async #notify(update: HistoryUpdate): Promise<void> {
		await Promise.all([...this.#listeners].map(async (listener) => listener(update)));
	}

	// takes both commits and listener notifications, since a failure in either reaches the app the same way.
	#report(work: Promise<void>): void {
		work.catch((error: unknown) => {
			this.#fail(error);
		});
	}

	#navigate(to: string, history: NavigationHistoryBehavior, options: HistoryNavigateOptions): void {
		// resolve against the live document URL so a cross-origin destination keeps its origin and reaches
		// the browser as a real navigation, rather than being flattened onto this origin's path.
		const url = new URL(to, this.#win.location.href).href;
		const envelope: Envelope = {
			[ENVELOPE]: true,
			scroll: options.scroll ?? 'auto',
			info: options.info,
		};
		this.#report(
			this.#track(this.#nav.navigate(url, { state: options.state ?? null, info: envelope, history })),
		);
	}

	#read(): HistoryLocation {
		const entry = this.#nav.currentEntry;
		if (entry === null) {
			throw new Error('stacker: the navigation API has no current entry (an opaque origin?)');
		}
		const { pathname, search, hash } = new URL(entry.url ?? this.#win.location.href);
		return {
			key: entry.key,
			id: entry.id,
			index: entry.index,
			pathname,
			search,
			hash,
			state: entry.getState(),
		};
	}

	readonly #onCurrentEntryChange = (event: NavigationCurrentEntryChangeEvent): void => {
		if (event.navigationType === 'traverse' && this.#webkit) {
			this.#report(this.#traverseUnintercepted());
			return;
		}
		if (event.navigationType !== null) {
			return;
		}
		this.#location = this.#read();

		this.#report(
			this.#notify({
				action: 'update',
				location: this.#location,
				scroll: 'preserve',
				info: undefined,
			}),
		);
	};

	async #traverseUnintercepted(): Promise<void> {
		const doc = this.#win.document;
		const focused = doc.activeElement;

		this.#location = this.#read();
		await this.#notify({ action: 'traverse', location: this.#location, scroll: 'auto', info: undefined });

		// preserve focus set during rendering.
		if (doc.activeElement !== focused) {
			return;
		}

		// focus the body to reset the sequential focus navigation starting point; blur alone does not.
		const body = doc.body;
		const hadTabIndex = body.hasAttribute('tabindex');
		if (!hadTabIndex) {
			body.tabIndex = -1;
		}

		body.focus({ preventScroll: true });
		if (!hadTabIndex) {
			body.removeAttribute('tabindex');
		}
	}

	readonly #onNavigate = (event: NavigateEvent): void => {
		const action = toAction(event.navigationType);
		if (action === undefined || !event.canIntercept) {
			return;
		}
		if (event.downloadRequest !== null || event.formData !== null) {
			return;
		}
		// ignored writes load a new document, while an ignored traversal would only desynchronize this one.
		if (action !== 'traverse' && this.#ignore?.(new URL(event.destination.url))) {
			return;
		}

		// leaves the 'manual' of a fresh load or a cancelled `beforeunload` prompt.
		this.#resumeScrollRestoration();

		if (action === 'traverse' && this.#webkit) {
			return;
		}

		const envelope: Envelope | undefined = isEnvelope(event.info) ? event.info : undefined;
		const info = envelope === undefined ? event.info : envelope.info;
		const scroll = envelope?.scroll ?? 'auto';

		// preserving an in-place update also prevents the platform from resetting the active element.
		const preserve = scroll === 'preserve';
		event.intercept({
			focusReset: preserve ? 'manual' : 'after-transition',
			scroll: 'manual',
			handler: async () => {
				this.#location = this.#read();
				await this.#notify({ action, location: this.#location, scroll, info });
			},
		});
	};

	readonly #onNavigateError = (event: ErrorEvent): void => {
		const error: unknown = event.error;
		this.#fail(error);
	};
}

const toRelative = (url: string | null): string | null => {
	if (url === null) {
		return null;
	}
	const { pathname, search, hash } = new URL(url);
	return `${pathname}${search}${hash}`;
};
