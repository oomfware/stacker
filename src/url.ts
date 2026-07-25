export interface PathParts {
	hash: string;
	pathname: string;
	search: string;
}

export const parsePath = (to: string): PathParts => {
	let pathname = to;
	let search = '';
	let hash = '';

	const hashIndex = pathname.indexOf('#');
	if (hashIndex >= 0) {
		hash = pathname.slice(hashIndex);
		pathname = pathname.slice(0, hashIndex);
	}

	const searchIndex = pathname.indexOf('?');
	if (searchIndex >= 0) {
		search = pathname.slice(searchIndex);
		pathname = pathname.slice(0, searchIndex);
	}

	return { hash, pathname, search };
};

export const resolvePath = (to: string, base: PathParts): PathParts => {
	const resolved = new URL(to, `http://_${createPath(base)}`);
	return { hash: resolved.hash, pathname: resolved.pathname, search: resolved.search };
};

// a path segment can hold pchar characters as-is (RFC 3986): unreserved, sub-delims, ':' and '@'.
// `encodeURIComponent` escapes most of them anyway, which only makes URLs harder to read.
const OUTSIDE_PCHAR = /[^\w!$&'()*+,\-.:;=@~]+/gu;

/**
 * percent-encodes a value so that it stays inside one path segment.
 *
 * @param value the raw value
 * @returns the encoded segment
 */
export const encodeSegment = (value: string): string => {
	return value.replaceAll(OUTSIDE_PCHAR, (chunk) => encodeURIComponent(chunk));
};

/**
 * decodes a splat remainder one segment at a time, so that separators survive decoding.
 *
 * an encoded `%2F` therefore decodes to a literal `/` and is indistinguishable from a real separator.
 */
export const decodeRemainder = (raw: string): string => raw.split('/').map(decodeURIComponent).join('/');

/** encodes a splat remainder one segment at a time, the inverse of {@link decodeRemainder}. */
export const encodeRemainder = (value: string): string => {
	return value
		.split('/')
		.map((segment) => encodeSegment(segment))
		.join('/');
};

export const createPath = ({ hash, pathname, search }: PathParts): string => {
	let out = pathname || '/';
	if (search && search !== '?') {
		out += search.startsWith('?') ? search : `?${search}`;
	}
	if (hash && hash !== '#') {
		out += hash.startsWith('#') ? hash : `#${hash}`;
	}
	return out;
};
