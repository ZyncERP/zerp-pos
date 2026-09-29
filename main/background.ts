import { app, BrowserWindow, shell, utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import path from 'path';
import http from 'http';
import fs from 'fs';

const LOG_FILE = path.join(require('os').homedir(), 'mabizpos-debug.log');
function flog(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFileSync(LOG_FILE, line);
}

flog('MODULE_INIT');

const isDev = process.env.NODE_ENV === 'development';

const BE_PORT = Number(process.env.MABIZPOS_BE_PORT ?? 4060);
const ADMIN_PORT = Number(process.env.MABIZPOS_ADMIN_PORT ?? 3060);
const MONGO_URL = process.env.MABIZPOS_MONGO_URL ?? 'mongodb://127.0.0.1:27017/pos_desktop';
const TENANT_KEY = process.env.MABIZPOS_TENANT_KEY ?? 'desktop';

function resourcePath(name: string): string {
  if (isDev) return path.resolve(__dirname, '..', 'resources', name);
  return path.join(process.resourcesPath, name);
}

const BE_ENTRY = resourcePath('be/dist/main.js');
const ADMIN_ENTRY = resourcePath('admin/server.js');

let beProc: UtilityProcess | null = null;
let adminProc: UtilityProcess | null = null;
let mainWindow: BrowserWindow | null = null;

function spawnService(name: string, entry: string, cwd: string, env: Record<string, string>): UtilityProcess {
  flog(`[${name}] fork ${entry} cwd=${cwd}`);
  try {
    const child = utilityProcess.fork(entry, [], {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'pipe',
    });
    flog(`[${name}] forked pid=${child.pid}`);
    child.stdout?.on('data', (d: Buffer) => flog(`[${name}] ${d.toString().trim()}`));
    child.stderr?.on('data', (d: Buffer) => flog(`[${name}:err] ${d.toString().trim()}`));
    child.on('exit', (code: number) => flog(`[${name}] exit ${code}`));
    return child;
  } catch (e) {
    flog(`[${name}] fork FAILED: ${e}`);
    throw e;
  }
}

function startBackend() {
  beProc = spawnService('be', BE_ENTRY, path.dirname(path.dirname(BE_ENTRY)), {
    port: String(BE_PORT),
    mongodb_url: MONGO_URL,
    tenant_key: TENANT_KEY,
    app_env: 'production',
  });
}

function startAdmin() {
  adminProc = spawnService('admin', ADMIN_ENTRY, path.dirname(ADMIN_ENTRY), {
    PORT: String(ADMIN_PORT),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
  });
}

async function waitForPort(port: number, probePath = '/', timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: probePath }, (res) => {
        resolve((res.statusCode ?? 500) < 500);
        res.resume();
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1500, () => { req.destroy(); resolve(false); });
    });
    if (ok) return;
  }
  throw new Error(`Timed out waiting for 127.0.0.1:${port}`);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  mainWindow.setMenuBarVisibility(false);
  await mainWindow.loadURL(`http://127.0.0.1:${ADMIN_PORT}`);
  mainWindow.show();
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  flog('--- MabizPOS startup ---');
  flog(`BE_PORT=${BE_PORT} ADMIN_PORT=${ADMIN_PORT} MONGO=${MONGO_URL}`);
  flog(`BE_ENTRY=${BE_ENTRY}`);
  flog(`ADMIN_ENTRY=${ADMIN_ENTRY}`);
  flog(`BE exists: ${fs.existsSync(BE_ENTRY)}`);
  flog(`ADMIN exists: ${fs.existsSync(ADMIN_ENTRY)}`);
  try {
    flog('starting backend...');
    startBackend();
    flog('starting admin...');
    startAdmin();
    flog('waiting for BE port...');
    await waitForPort(BE_PORT, '/graphql');
    flog('[be] ready');
    flog('waiting for admin port...');
    await waitForPort(ADMIN_PORT, '/');
    flog('[admin] ready');
    await createWindow();
  } catch (err) {
    flog(`startup failed: ${err}`);
    app.quit();
  }
});

app.on('before-quit', () => {
  beProc?.kill('SIGTERM');
  adminProc?.kill('SIGTERM');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
