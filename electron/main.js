const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const net = require("net");

let mainWindow = null;
let backendProcess = null;

const DEFAULT_PORT = 8964;

// Find a free port (fallback if DEFAULT_PORT is taken)
function findFreePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });
}

// Path to packaged backend executable
function getPackagedBackendPath() {
  const exeName = process.platform === "win32" ? "geo_backend.exe" : "geo_backend";
  return path.join(process.resourcesPath, "backend", exeName);
}

// Start Flask backend
function startBackend(port) {
  const isDev = !app.isPackaged;

  let cmd;
  let args;

  if (isDev) {
    // Dev: use system python
    cmd = process.platform === "win32" ? "python" : "python3";
    args = ["-m", "backend"];
  } else {
    // Packaged: use compiled backend binary
    cmd = getPackagedBackendPath();
    args = []; // backend reads GEO_PORT from env; add CLI args if you prefer
  }

  const env = { ...process.env, GEO_PORT: String(port) };

  backendProcess = spawn(cmd, args, {
    cwd: isDev ? path.join(__dirname, "..") : process.resourcesPath,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (app.isPackaged) logBackendToFile(backendProcess);

  backendProcess.stdout.on("data", (data) => console.log(`[backend] ${data}`));
  backendProcess.stderr.on("data", (data) => console.error(`[backend] ${data}`));

  backendProcess.on("error", (err) => {
    console.error("Failed to start backend:", err);
    dialog.showErrorBox(
      "Backend Error",
      `Could not start backend.\n\n${err.message}\n\n` +
      (isDev
        ? "Make sure Python and dependencies are installed."
        : "The backend executable was not found or could not be started.")
    );
  });

  backendProcess.on("exit", (code, signal) => {
    console.log(`[backend] exited code=${code} signal=${signal}`);
  });
}

const fs = require("fs");

function logBackendToFile(proc) {
  const logPath = path.join(app.getPath("userData"), "backend.log");
  const stream = fs.createWriteStream(logPath, { flags: "a" });
  proc.stdout?.pipe(stream);
  proc.stderr?.pipe(stream);
  console.log("Backend log:", logPath);
}

// Wait for backend to be ready
function waitForBackend(port, maxRetries = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      const req = net.createConnection({
        port,
        host: "127.0.0.1"
      }, () => {
        req.end();
        resolve();
      });
      req.on("error", () => {
        attempts++;
        if (attempts >= maxRetries) {
          reject(new Error("Backend did not start in time"));
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Geo Analyzer",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
    backgroundColor: "#1a1a2e",
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (app.isPackaged) {
    mainWindow.setMenuBarVisibility(false);
  }
}

// ── App Lifecycle ────────────────────────────────────────────────

app.on("ready", async () => {
  // Prefer DEFAULT_PORT, but fall back if taken
  const port = (await isPortFree(DEFAULT_PORT)) ? DEFAULT_PORT : await findFreePort();

  startBackend(port);

  try {
    await waitForBackend(port);
    await createWindow(port);
  } catch (err) {
    dialog.showErrorBox("Startup Error", err.message);
    app.quit();
  }
});

function stopBackend() {
  if (backendProcess) {
    try {
      backendProcess.kill();
    } catch { }
    backendProcess = null;
  }
}

app.on("window-all-closed", () => {
  stopBackend();
  app.quit();
});

app.on("before-quit", () => {
  stopBackend();
});
