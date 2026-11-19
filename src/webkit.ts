// Chromium's UA includes AppleWebKit; Chrome on iOS uses CriOS.
export const isWebKit = (userAgent: string): boolean =>
	/AppleWebKit\//.test(userAgent) && !/(?:Chrome|Chromium)\//.test(userAgent);
