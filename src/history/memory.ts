import { SimpleEventEmitter } from '@mary-ext/simple-event-emitter';

import { createPath, resolvePath } from '../url.ts';
import type { PathParts } from '../url.ts';

import type {
	History,
	HistoryEntry,
	HistoryListener,
	HistoryLocation,
	HistoryNavigateOptions,
	HistoryUpdate,
} from './types.ts';

const ROOT: PathParts = { pathname: '/', search: '', hash: '' };

/** options for the memory history constructor. */
export interface MemoryHistoryOptions {
	/** initial entry relative URLs. */
	readonly initialEntries?: readonly string[];
	/** initially active entry index. */
	readonly index?: number;
}

/**
 * in-memory history manager for testing.
 *
 * replicates browser navigation ledger semantics, including history replacement, entry stack pruning, and
 * state traversal.
 */
export class MemoryHistory implements History {
	#entries: HistoryLocation[];
	#index: number;
	#idSeq = 0;
	#keySeq = 0;
	#updates = new SimpleEventEmitter<[update: HistoryUpdate]>();

	constructor(options: MemoryHistoryOptions = {}) {
		const initialEntries = options.initialEntries ?? ['/'];
		this.#entries = initialEntries.map((to, i) =>
			this.#make(to, ROOT, this.#nextId(), this.#nextKey(), i, null),
		);
		this.#index = Math.max(0, Math.min(options.index ?? this.#entries.length - 1, this.#entries.length - 1));
	}

	get location(): HistoryLocation {
		return this.#current();
	}

	get canGoBack(): boolean {
		return this.#index > 0;
	}

	get canGoForward(): boolean {
		return this.#index < this.#entries.length - 1;
	}

	entries(): readonly HistoryEntry[] {
		return this.#entries.map((location) => ({
			key: location.key,
			id: location.id,
			index: location.index,
			url: createPath(location),
			sameDocument: true,
			state: location.state,
		}));
	}

	push(to: string, options: HistoryNavigateOptions = {}): void {
		const base = this.#current();
		this.#index += 1;
		const location = this.#make(
			to,
			base,
			this.#nextId(),
			this.#nextKey(),
			this.#index,
			options.state ?? null,
		);
		this.#entries = [...this.#entries.slice(0, this.#index), location];
		this.#emit({ action: 'push', location, scroll: options.scroll ?? 'auto', info: options.info });
	}

	replace(to: string, options: HistoryNavigateOptions = {}): void {
		const current = this.#current();
		const location = this.#make(to, current, this.#nextId(), current.key, this.#index, options.state ?? null);
		this.#entries = this.#entries.with(this.#index, location);
		this.#emit({ action: 'replace', location, scroll: options.scroll ?? 'auto', info: options.info });
	}

	updateState(state: unknown): void {
		const location: HistoryLocation = { ...this.#current(), state: structuredClone(state) };
		this.#entries = this.#entries.with(this.#index, location);
		this.#emit({ action: 'update', location, scroll: 'preserve', info: undefined });
	}

	traverseTo(key: string): Promise<void> {
		const index = this.#entries.findIndex((entry) => entry.key === key);
		if (index === -1) {
			return Promise.reject(new Error(`stacker: no history entry with key '${key}'`));
		}

		this.go(index - this.#index);
		return Promise.resolve();
	}

	go(delta: number): void {
		const next = Math.max(0, Math.min(this.#index + delta, this.#entries.length - 1));
		if (next === this.#index) {
			return;
		}
		this.#index = next;
		this.#emit({ action: 'traverse', location: this.#current(), scroll: 'auto', info: undefined });
	}

	back(): void {
		this.go(-1);
	}

	forward(): void {
		this.go(1);
	}

	listen(listener: HistoryListener): () => void {
		return this.#updates.subscribe(listener);
	}

	dispose(): void {
		this.#updates = new SimpleEventEmitter();
	}

	#nextId(): string {
		return `i${this.#idSeq++}`;
	}

	#nextKey(): string {
		return `k${this.#keySeq++}`;
	}

	#make(
		to: string,
		base: PathParts,
		id: string,
		key: string,
		index: number,
		state: unknown,
	): HistoryLocation {
		const { pathname, search, hash } = resolvePath(to, base);
		// the browser stores a structured clone, so a caller that keeps mutating the object it passed does not
		// reach back into the ledger. cloning here also rejects the same values a real entry would.
		return { key, id, index, pathname, search, hash, state: structuredClone(state) };
	}

	#current(): HistoryLocation {
		const location = this.#entries[this.#index];
		if (location === undefined) {
			throw new Error('stacker: memory history has no active entry');
		}
		return location;
	}

	#emit(update: HistoryUpdate): void {
		this.#updates.emit(update);
	}
}
