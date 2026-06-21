import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MemoryHistory } from '../history/memory.ts';
import { Router } from '../router.ts';
import { defineRoutes, layout, route } from '../routes.ts';

import { Link } from './link.tsx';
import { Outlet } from './outlet.tsx';
import { RouterView } from './router-view.tsx';

const Nav = () => (
	<nav>
		<Link to="/page">page</Link>
		<Link replace to="/page">
			page (replace)
		</Link>
		<Link to="https://example.com/page">absolute</Link>
		<Link to="//example.com/page">protocol-relative</Link>
		<Link to="mailto:someone@example.com">mail</Link>
		<Outlet />
	</nav>
);

const routes = defineRoutes({
	app: layout({
		children: {
			Home: route({ component: () => null, path: '/', type: 'singleton' }),
			Page: route({ component: () => null, path: '/page' }),
		},
		component: Nav,
	}),
});

const make = () => new Router({ history: new MemoryHistory({ initialEntries: ['/'] }), routes });

// keep unhandled anchors from navigating the test runner.
const swallow = (event: Event): void => event.preventDefault();

beforeEach(() => document.addEventListener('click', swallow));
afterEach(() => document.removeEventListener('click', swallow));

const click = (name: string): void =>
	act(() => {
		screen.getByText(name).click();
	});

describe('Link', () => {
	it('routes a same-origin destination in-app', () => {
		const router = make();
		render(<RouterView router={router} />);

		click('page');

		expect(router.location.pathname).toBe('/page');
		expect(router.canGoBack).toBe(true);
	});

	it('replaces rather than pushes when asked', () => {
		const router = make();
		render(<RouterView router={router} />);

		click('page (replace)');

		expect(router.location.pathname).toBe('/page');
		expect(router.canGoBack).toBe(false);
	});

	it.each(['absolute', 'protocol-relative', 'mail'])('leaves the %s destination to the browser', (label) => {
		const router = make();
		render(<RouterView router={router} />);

		click(label);

		expect(router.location.pathname).toBe('/');
	});
});
