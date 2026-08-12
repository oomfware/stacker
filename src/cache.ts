export interface CacheEntryRef {
	readonly index: number;
	readonly key: string;
}

export interface CachePolicy {
	readonly max: number;
}

/** selects the active entry and recent backward entries for caching. */
export const computeCachedKeys = (
	entries: readonly CacheEntryRef[],
	activeKey: string,
	recency: readonly string[],
	policy: CachePolicy,
): Set<string> => {
	const cached = new Set<string>();

	const active = entries.find((entry) => entry.key === activeKey);
	if (active === undefined) {
		throw new Error(`stacker: no history entry with the active key '${activeKey}'`);
	}
	cached.add(active.key);

	const backward = new Map<string, CacheEntryRef>();
	for (const entry of entries) {
		if (entry.index < active.index) {
			backward.set(entry.key, entry);
		}
	}

	let kept = 0;
	const take = (key: string): void => {
		if (kept >= policy.max || cached.has(key) || !backward.has(key)) {
			return;
		}
		cached.add(key);
		kept += 1;
	};

	for (const key of recency) {
		take(key);
	}
	for (const entry of [...backward.values()].toSorted((a, b) => b.index - a.index)) {
		take(entry.key);
	}

	return cached;
};
