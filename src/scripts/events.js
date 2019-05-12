import { remote } from 'electron';
import i18n from '../i18n';
import { aboutModal } from './aboutModal';
import { screenshareModal } from './screenshareModal';
import { updateModal } from './updateModal';
import { landing } from './landing';
import { preferences } from './preferences';
import { servers } from './servers';
import { sidebar } from './sidebar';
import { webviews } from './webviews';
const { app, dialog, getCurrentWindow, shell } = remote;
const {
	basicAuth,
	certificates,
	deepLinks,
	dock,
	menus,
	relaunch,
	touchBar,
	tray,
	updates,
} = remote.require('./main');


const setLoadingVisible = (visible) => {
	document.querySelector('.app-page').classList.toggle('app-page--loading', visible);
};

const updatePreferences = () => {
	const {
		hasTrayIcon,
		hasMenuBar,
		hasSidebar,
		showWindowOnUnreadChanged,
	} = preferences.getAll();

	menus.setState({
		showTrayIcon: hasTrayIcon,
		showWindowOnUnreadChanged,
		showMenuBar: hasMenuBar,
		showServerList: hasSidebar,
	});

	tray.setState({
		showIcon: hasTrayIcon,
	});

	dock.setState({
		hasTrayIcon,
	});

	sidebar.setState({
		visible: hasSidebar,
	});

	webviews.setState({
		hasSidebar,
	});

	getCurrentWindow().hasTrayIcon = hasTrayIcon;
};


const updateServers = () => {
	const allServers = servers.getAll();

	menus.setState({ servers: allServers });
	sidebar.setState({ servers: allServers });
	touchBar.setState({ servers: allServers });
	webviews.setState({ servers: allServers });

	const badges = allServers.map(({ badge }) => badge);
	const mentionCount = (
		badges
			.filter((badge) => Number.isInteger(badge))
			.reduce((sum, count) => sum + count, 0)
	);
	const globalBadge = mentionCount || (badges.some((badge) => !!badge) && '•') || null;

	tray.setState({ badge: globalBadge });
	dock.setState({ badge: globalBadge });
};

const updateWindowState = () => tray.setState({ isMainWindowVisible: getCurrentWindow().isVisible() });


const askWhenToInstallUpdate = () => new Promise((resolve) => {
	dialog.showMessageBox(getCurrentWindow(), {
		type: 'question',
		title: i18n.__('dialog.updateReady.title'),
		message: i18n.__('dialog.updateReady.message'),
		buttons: [
			i18n.__('dialog.updateReady.installLater'),
			i18n.__('dialog.updateReady.installNow'),
		],
		defaultId: 1,
		cancelId: 0,
	}, (response) => resolve(response === 0 ? 'later' : 'now'));
});


const warnDelayedUpdateInstall = () => new Promise ((resolve) => {
	dialog.showMessageBox(getCurrentWindow(), {
		type: 'info',
		title: i18n.__('dialog.updateInstallLater.title'),
		message: i18n.__('dialog.updateInstallLater.message'),
		buttons: [i18n.__('dialog.updateInstallLater.ok')],
		defaultId: 0,
	}, () => resolve());
});


const warnCertificateError = ({ requestUrl, error, certificate: { issuerName }, replace }) => new Promise((resolve) => {
	const detail = `URL: ${ requestUrl }\nError: ${ error }`;

	dialog.showMessageBox(getCurrentWindow(), {
		title: i18n.__('dialog.certificateError.title'),
		message: i18n.__('dialog.certificateError.message', { issuerName }),
		detail: replace ? i18n.__('error.differentCertificate', { detail }) : detail,
		type: 'warning',
		buttons: [
			i18n.__('dialog.certificateError.yes'),
			i18n.__('dialog.certificateError.no'),
		],
		defaultId: 1,
		cancelId: 1,
	}, (response) => resolve(response === 0));
});


const confirmServerAddition = ({ serverUrl }) => new Promise((resolve) => {
	dialog.showMessageBox(getCurrentWindow(), {
		title: i18n.__('dialog.addServer.title'),
		message: i18n.__('dialog.addServer.message', { host: serverUrl }),
		type: 'question',
		buttons: [
			i18n.__('dialog.addServer.add'),
			i18n.__('dialog.addServer.cancel'),
		],
		defaultId: 0,
		cancelId: 1,
	}, (response) => resolve(response === 0));
});


const confirmAppDataReset = () => new Promise((resolve) => {
	dialog.showMessageBox({
		title: i18n.__('dialog.resetAppData.title'),
		message: i18n.__('dialog.resetAppData.message'),
		type: 'question',
		buttons: [
			i18n.__('dialog.resetAppData.yes'),
			i18n.__('dialog.resetAppData.cancel'),
		],
		defaultId: 1,
		cancelId: 1,
	}, (response) => resolve(response === 0));
});


const destroyAll = () => {
	try {
		menus.unmount();
		tray.unmount();
		dock.unmount();
		updates.removeAllListeners();
		getCurrentWindow().removeAllListeners();
	} catch (error) {
		remote.getGlobal('console').error(error.stack || error);
	}
};

const handleConnectionStatus = () => {
	document.body.classList.toggle('offline', !navigator.onLine);
};

const queryEditFlags = () => ({
	canUndo: document.queryCommandEnabled('undo'),
	canRedo: document.queryCommandEnabled('redo'),
	canCut: document.queryCommandEnabled('cut'),
	canCopy: document.queryCommandEnabled('copy'),
	canPaste: document.queryCommandEnabled('paste'),
	canSelectAll: document.queryCommandEnabled('selectAll'),
});

const handleSelectionChangeEventListener = () => {
	menus.setState({
		...queryEditFlags(),
		canGoBack: false,
		canGoForward: false,
	});
};

const getFocusedWebContents = () => (
	(webviews.getFocused() && webviews.getFocused().getWebContents()) || getCurrentWindow().webContents
);

export default async () => {
	await i18n.initialize();

	window.addEventListener('online', handleConnectionStatus);
	window.addEventListener('offline', handleConnectionStatus);
	handleConnectionStatus();

	window.addEventListener('beforeunload', destroyAll);

	document.addEventListener('selectionchange', handleSelectionChangeEventListener);

	aboutModal.on('check-for-updates', () => updates.checkForUpdates());
	aboutModal.on('set-check-for-updates-on-start', (checked) => updates.setAutoUpdate(checked));

	basicAuth.on('login-requested', ({ request: { url }, callback }) => {
		const { username, password } = servers.fromUrl(url) || {};
		callback((username && password) ? [username, password] : null);
	});

	certificates.on('ask-for-trust', async ({ requestUrl, error, certificate, replace, callback }) => {
		const isTrusted = await warnCertificateError({ requestUrl, error, certificate, replace });
		callback(isTrusted);
	});

	deepLinks.on('auth', async ({ serverUrl }) => {
		getCurrentWindow().forceFocus();

		if (servers.has(serverUrl)) {
			servers.setActive(serverUrl);
			return;
		}

		const shouldAdd = await confirmServerAddition({ serverUrl });
		if (!shouldAdd) {
			return;
		}

		try {
			await servers.validate(serverUrl);
			servers.add(serverUrl);
			servers.setActive(serverUrl);
		} catch (error) {
			dialog.showErrorBox(
				i18n.__('dialog.addServerError.title'),
				i18n.__('dialog.addServerError.message', { host: serverUrl })
			);
		}
	});

	landing.on('add-server', (serverUrl) => {
		servers.add(serverUrl);
		servers.setActive(serverUrl);
	});

	landing.on('validate', async (serverUrl, callback) => {
		callback(await servers.validate(serverUrl));
	});

	menus.on('quit', () => app.quit());
	menus.on('about', () => aboutModal.setState({ visible: true }));
	menus.on('open-url', (url) => shell.openExternal(url));

	menus.on('undo', () => getFocusedWebContents().undo());
	menus.on('redo', () => getFocusedWebContents().redo());
	menus.on('cut', () => getFocusedWebContents().cut());
	menus.on('copy', () => getFocusedWebContents().copy());
	menus.on('paste', () => getFocusedWebContents().paste());
	menus.on('select-all', () => getFocusedWebContents().selectAll());

	menus.on('reset-zoom', () => webviews.getActive().setZoomLevel(0));
	menus.on('zoom-in', () => webviews.getActive().setZoomLevel(webviews.getActive().getZoomLevel() + 1));
	menus.on('zoom-out', () => webviews.getActive().setZoomLevel(webviews.getActive().getZoomLevel() - 1));

	menus.on('add-new-server', () => {
		getCurrentWindow().show();
		servers.setActive(null);
		setLoadingVisible(false);
		landing.setState({ visible: true });
	});

	menus.on('select-server', ({ url }) => {
		getCurrentWindow().show();
		servers.setActive(url);
	});

	menus.on('reload-server', ({ ignoringCache = false, clearCertificates = false } = {}) => {
		if (clearCertificates) {
			certificates.clear();
		}

		const webview = webviews.getActive();
		webview && (ignoringCache ? webview.reloadIgnoringCache() : webview.reload());
	});

	menus.on('open-devtools-for-server', () => {
		const webview = webviews.getActive();
		webview && webview.openDevTools();
	});

	menus.on('go-back', () => {
		const webview = webviews.getActive();
		webview && webview.goBack();
	});

	menus.on('go-forward', () => {
		const webview = webviews.getActive();
		webview.goForward();
	});

	menus.on('reload-app', () => getCurrentWindow().reload());

	menus.on('toggle-devtools', () => getCurrentWindow().toggleDevTools());

	menus.on('reset-app-data', async () => {
		const shouldReset = await confirmAppDataReset();

		if (shouldReset) {
			relaunch('--reset-app-data');
		}
	});

	menus.on('toggle', (property) => {
		switch (property) {
			case 'showTrayIcon': {
				preferences.set('hasTrayIcon', !preferences.get('hasTrayIcon'));
				break;
			}

			case 'showMenuBar': {
				preferences.set('hasMenuBar', !preferences.get('hasMenuBar'));
				break;
			}

			case 'showServerList': {
				preferences.set('hasSidebar', !preferences.get('hasSidebar'));
				break;
			}

			case 'showWindowOnUnreadChanged': {
				preferences.set('showWindowOnUnreadChanged', !preferences.get('showWindowOnUnreadChanged'));
				break;
			}
		}

		updatePreferences();
	});

	preferences.on('set', () => {
		updatePreferences();
	});

	screenshareModal.on('select-source', ({ id, url }) => {
		screenshareModal.setState({ visible: false });
		const webview = webviews.get(url);
		webview.executeJavaScript(`window.parent.postMessage({ sourceId: '${ id }' }, '*');`);
	});

	servers.on('loaded', (entries, fromDefaults) => {
		if (fromDefaults) {
			if (Object.keys(entries).length <= 1) {
				preferences.set('hasSidebar', false);
			}
		}
		setLoadingVisible(false);
		updateServers();
	});

	servers.on('added', (/* entry */) => {
		updateServers();
	});

	servers.on('removed', (/* entry */) => {
		setLoadingVisible(false);
		landing.setState({ visible: true });
		updateServers();
	});

	servers.on('updated', (/* entry */) => {
		updateServers();
	});

	servers.on('sorted', () => {
		updateServers();
	});

	servers.on('active-setted', (/* entry */) => {
		landing.setState({ visible: false });
		updateServers();
	});

	servers.on('active-cleared', () => {
		landing.setState({ visible: true });
		updateServers();
	});

	servers.on('title-setted', () => {
		updateServers();
	});

	sidebar.on('select-server', (serverUrl) => {
		servers.setActive(serverUrl);
	});

	sidebar.on('reload-server', (serverUrl) => {
		const webview = webviews.get(serverUrl);
		webview && webview.reload();
	});

	sidebar.on('remove-server', (serverUrl) => {
		servers.remove(serverUrl);
	});

	sidebar.on('open-devtools-for-server', (serverUrl) => {
		const webview = webviews.get(serverUrl);
		webview.openDevTools();
	});

	sidebar.on('add-server', () => {
		servers.setActive(null);
		setLoadingVisible(false);
		landing.setState({ visible: true });
	});

	sidebar.on('servers-sorted', (urls) => {
		servers.sort(urls);
	});

	getCurrentWindow().on('hide', updateWindowState);
	getCurrentWindow().on('show', updateWindowState);

	touchBar.on('format', (buttonId) => {
		const legacyButtonIconClass = {
			bold: 'bold',
			italic: 'italic',
			strike: 'strike',
			inline_code: 'code',
			multi_line: 'multi-line',
		}[buttonId];

		const webview = webviews.getActive();

		webview && webview.executeJavaScript(`((buttonId, legacyButtonIconClass) => {
			let button = document.querySelector(\`.js-format[data-id="${ buttonId }"]\`);
			if (!button) {
				const svg = document.querySelector(\`.js-md svg[class$="${ legacyButtonIconClass }"]\`);
				button = svg && svg.parentNode;
			}
			button && button.click();
		})('${ legacyButtonIconClass }', '${ buttonId }')`);
	});

	touchBar.on('select-server', (serverUrl) => {
		servers.setActive(serverUrl);
	});

	tray.on('set-main-window-visibility', (visible) =>
		(visible ? getCurrentWindow().show() : getCurrentWindow().hide()));
	tray.on('quit', () => app.quit());

	updateModal.on('skip', (newVersion) => {
		dialog.showMessageBox(getCurrentWindow(), {
			type: 'warning',
			title: i18n.__('dialog.updateSkip.title'),
			message: i18n.__('dialog.updateSkip.message'),
			buttons: [i18n.__('dialog.updateSkip.ok')],
			defaultId: 0,
		}, () => {
			updates.skipVersion(newVersion);
			updateModal.setState({ visible: false });
		});
	});
	updateModal.on('remind-later', () => {
		updateModal.setState({ visible: false });
	});
	updateModal.on('install', () => {
		dialog.showMessageBox(getCurrentWindow(), {
			type: 'info',
			title: i18n.__('dialog.updateDownloading.title'),
			message: i18n.__('dialog.updateDownloading.message'),
			buttons: [i18n.__('dialog.updateDownloading.ok')],
			defaultId: 0,
		}, () => {
			updates.downloadUpdate();
			updateModal.setState({ visible: false });
		});
	});

	updates.on('configuration-set', ({ canUpdate, canAutoUpdate, canSetAutoUpdate }) => {
		aboutModal.setState({ canUpdate, canAutoUpdate, canSetAutoUpdate });
	});
	updates.on('error', () => aboutModal.showUpdateError());
	updates.on('checking-for-update', () => aboutModal.setState({ checking: true }));
	updates.on('update-available', ({ version }) => {
		aboutModal.setState({
			visible: false,
			checking: false,
			checkingMessage: null,
		});
		updateModal.setState({
			visible: true,
			newVersion: version,
		});
	});
	updates.on('update-not-available', () => aboutModal.showNoUpdateAvailable());
	// updates.on('download-progress', ({ bytesPerSecond, percent, total, transferred }) => console.log(percent));
	updates.on('update-downloaded', async () => {
		const whenInstall = await askWhenToInstallUpdate();

		if (whenInstall === 'later') {
			await warnDelayedUpdateInstall();
			return;
		}

		destroyAll();
		updates.quitAndInstall();
	});

	webviews.on('ipc-message-unread-changed', (webview, { url: serverUrl }, badge) => {
		if (typeof badge === 'number' && preferences.get('showWindowOnUnreadChanged')) {
			const mainWindow = remote.getCurrentWindow();
			mainWindow.showInactive();
		}

		servers.set(serverUrl, { badge });
	});

	webviews.on('ipc-message-title-changed', (webview, { url: serverUrl }, title) => {
		servers.set(serverUrl, { title });
	});

	webviews.on('ipc-message-focus', (webview, { url: serverUrl }) => {
		servers.setActive(serverUrl);
	});

	webviews.on('ipc-message-sidebar-style', (webview, { url: serverUrl }, style) => {
		servers.set(serverUrl, { style });
	});

	webviews.on('ipc-message-get-sourceId', (webview, { url: serverUrl }) => {
		screenshareModal.setState({ visible: false, url: serverUrl });
	});

	webviews.on('ipc-message-reload-server', (webview, { url: serverUrl }) => {
		webview.loadURL(serverUrl);
	});

	webviews.on('ipc-message-edit-flags-changed', (webview, server, editFlags) => {
		menus.setState({
			...editFlags,
			canGoBack: webview.canGoBack(),
			canGoForward: webview.canGoForward(),
		});
	});

	webviews.on('did-navigate', ({ serverUrl, url }) => {
		servers.set(serverUrl, { lastPath: url });
	});

	sidebar.mount();
	landing.mount();
	webviews.mount();
	touchBar.mount();
	aboutModal.mount();
	screenshareModal.mount();
	updateModal.mount();

	await servers.initialize();
	await preferences.initialize();

	updatePreferences();
	updateServers();
	updateWindowState();
};
