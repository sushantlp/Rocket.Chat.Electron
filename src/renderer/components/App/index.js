import { remote } from 'electron';
import React, { useEffect } from 'react';
import { Shell } from '../Shell';
import { LoadingSplash } from '../LoadingSplash';
import { Dock } from '../Dock';
import { StoreProvider } from './StoreProvider';
import { SagaMiddlewareProvider } from './SagaMiddlewareProvider';
const { dock, menus, touchBar, tray } = remote.require('./main');


export function App() {
	useEffect(() => {
		dock.mount();
		menus.mount();
		touchBar.mount();
		tray.mount();

		return () => {
			dock.unmount();
			menus.unmount();
			touchBar.unmount();
			tray.unmount();
		};
	}, []);

	return (
		<React.Suspense fallback={<LoadingSplash visible />}>
			<StoreProvider>
				<SagaMiddlewareProvider>
					<Shell />
					<Dock />
				</SagaMiddlewareProvider>
			</StoreProvider>
		</React.Suspense>
	);
}
