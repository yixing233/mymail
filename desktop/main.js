const { app, BrowserWindow, shell } = require("electron");
const { createServer } = require("node:http");
const path = require("node:path");

let mainWindow = null;
let nextServer = null;

function resolveAppDir() {
  return app.getAppPath();
}

function ensureDesktopEnvironment() {
  process.env.MYMAIL_DATA_DIR ||= path.join(app.getPath("userData"), "data");
  process.env.MYMAIL_DESKTOP = "1";
}

async function startNextServer() {
  const next = require("next");
  const hostname = "127.0.0.1";
  const dir = resolveAppDir();
  const nextApp = next({
    dev: false,
    dir,
    hostname,
    port: 0,
  });
  const handler = nextApp.getRequestHandler();

  await nextApp.prepare();

  const server = createServer((request, response) => {
    handler(request, response);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, hostname, resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 12121;
  return {
    url: `http://${hostname}:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function resolveAppUrl() {
  if (process.env.MYMAIL_DESKTOP_URL) {
    return process.env.MYMAIL_DESKTOP_URL;
  }

  nextServer = await startNextServer();
  return nextServer.url;
}

async function createMainWindow() {
  ensureDesktopEnvironment();
  const appUrl = await resolveAppUrl();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    show: false,
    title: "MyMail",
    icon: path.join(resolveAppDir(), "mymail-icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  await mainWindow.loadURL(appUrl);
}

app.whenReady().then(createMainWindow).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  if (nextServer) {
    await nextServer.close();
    nextServer = null;
  }
});
