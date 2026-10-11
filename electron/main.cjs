/**
 * Desktop app: shows the built game (dist/) in its own window and lets it
 * read the ARENA folder the player picks. Nothing else on disk is reachable
 * from the game, and the folder is only ever read.
 */
const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const ORIGIN = 'app://arena';
// How many folder levels below the picked one to list; src/data/files.ts looks for GLOBAL.BSA in them.
const MAX_DEPTH = 4;
// Stops a scan of a huge folder (say, the whole home folder) from running for minutes.
const MAX_FILES = 20000;
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
].join('; ');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/** The folder the game may read from: the one the player picked, or the one remembered from last time. */
let root;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

async function loadSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

async function saveSettings(settings) {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 2));
}

/** Lists files below `dir` as forward-slash paths relative to it. */
async function listFiles(dir) {
  const files = [];
  const walk = async (d, prefix, depth) => {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) return;
      if (entry.name.startsWith('.')) continue;
      if (entry.isFile()) files.push(prefix + entry.name);
      else if (entry.isDirectory() && depth < MAX_DEPTH) {
        // Unreadable sub-folders are skipped; only the picked folder itself must be readable.
        await walk(path.join(d, entry.name), `${prefix}${entry.name}/`, depth + 1).catch(() => {});
      }
    }
  };
  await walk(dir, '', 0);
  return files;
}

async function openFolder(dir) {
  const files = await listFiles(dir);
  root = dir;
  return { name: path.basename(dir), path: dir, files };
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Only the game's own page may use the folder. */
function fromGame(event) {
  return event.senderFrame?.url.startsWith(`${ORIGIN}/`) ?? false;
}

ipcMain.handle('arena:choose-folder', async (event) => {
  if (!fromGame(event)) return null;
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Choose your ARENA folder',
    buttonLabel: 'Choose',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return openFolder(result.filePaths[0]);
});

ipcMain.handle('arena:reopen-folder', async (event) => {
  if (!fromGame(event)) return null;
  const { folder } = await loadSettings();
  if (typeof folder !== 'string') return null;
  try {
    return await openFolder(folder);
  } catch {
    return null; // moved, deleted or no longer readable
  }
});

ipcMain.handle('arena:remember-folder', async (event) => {
  if (!fromGame(event) || !root) return;
  await saveSettings({ ...(await loadSettings()), folder: root });
});

ipcMain.handle('arena:read-file', async (event, relPath) => {
  if (!fromGame(event) || !root || typeof relPath !== 'string') throw new Error('No ARENA folder is open');
  const file = path.resolve(root, relPath);
  if (!isInside(root, file)) throw new Error(`${relPath} is outside the ARENA folder`);
  return fs.readFile(file);
});

/** Serves dist/ as app://arena/, which gives the game a proper origin instead of file://. */
async function serveGame(request) {
  const file = path.join(DIST, path.normalize(decodeURIComponent(new URL(request.url).pathname)));
  if (!isInside(DIST, file)) return new Response('Not found', { status: 404 });
  const response = await net.fetch(pathToFileURL(file).toString());
  if (!file.endsWith('.html')) return response;
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', CSP);
  return new Response(response.body, { status: response.status, headers });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    title: 'ES Arena',
    backgroundColor: '#0b0a08',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  // Links open in the player's browser; the window itself never leaves the game.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });
  void win.loadURL(`${ORIGIN}/index.html`);
}

app.whenReady().then(() => {
  protocol.handle('app', serveGame);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
