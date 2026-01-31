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

// Start Flask backend - returns a promise that rejects on immediate failure
function startBackend(port) {
  return new Promise((resolve, reject) => {
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
      args = [];
    }

    const env = { ...process.env, GEO_PORT: String(port) };

    // Track stderr for error reporting
    let stderrBuffer = "";
    let startupFailed = false;
    let startupTimer = null;

    backendProcess = spawn(cmd, args, {
      cwd: isDev ? path.join(__dirname, "..") : process.resourcesPath,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    if (app.isPackaged) logBackendToFile(backendProcess);

    backendProcess.stdout.on("data", (data) => console.log(`[backend] ${data}`));
    backendProcess.stderr.on("data", (data) => {
      console.error(`[backend] ${data}`);
      stderrBuffer += data.toString();
    });

    // Immediate spawn error (e.g., executable not found)
    backendProcess.on("error", (err) => {
      startupFailed = true;
      if (startupTimer) clearTimeout(startupTimer);
      console.error("Failed to start backend:", err);
      reject(new Error(
        `Could not start backend: ${err.message}\n\n` +
        (isDev
          ? "Make sure Python and dependencies are installed."
          : "The backend executable was not found or could not be started.")
      ));
    });

    // Process exited immediately (crash on startup)
    backendProcess.on("exit", (code, signal) => {
      console.log(`[backend] exited code=${code} signal=${signal}`);
      if (!startupFailed && startupTimer) {
        // Exited during startup window - this is a fatal error
        startupFailed = true;
        clearTimeout(startupTimer);
        reject(new Error(
          `Backend crashed on startup (exit code ${code}).\n\n` +
          (stderrBuffer ? `Error output:\n${stderrBuffer.slice(-1000)}` : "No error output captured.")
        ));
      }
    });

    // Give the process a moment to fail immediately, then resolve
    startupTimer = setTimeout(() => {
      if (!startupFailed) {
        resolve();
      }
    }, 500);
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
    let resolved = false;

    // Listen for backend crash during startup
    const onExit = (code) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`Backend exited unexpectedly during startup (code ${code})`));
      }
    };
    backendProcess?.once("exit", onExit);

    const check = () => {
      if (resolved) return;

      // Check if process is still alive
      if (!backendProcess || backendProcess.exitCode !== null) {
        if (!resolved) {
          resolved = true;
          reject(new Error("Backend process is not running"));
        }
        return;
      }

      const req = net.createConnection({ port, host: "127.0.0.1" }, () => {
        req.end();
        if (!resolved) {
          resolved = true;
          backendProcess?.off("exit", onExit);
          resolve();
        }
      });
      req.on("error", () => {
        attempts++;
        if (attempts >= maxRetries) {
          if (!resolved) {
            resolved = true;
            backendProcess?.off("exit", onExit);
            reject(new Error("Backend did not start in time (timeout after " + (maxRetries * 0.5) + "s)"));
          }
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
  console.log(`[main] Using port ${port}`);

  try {
    // Start backend and catch immediate failures
    await startBackend(port);

    // Wait for backend HTTP server to be ready
    await waitForBackend(port);
    await createWindow(port);
  } catch (err) {
    dialog.showErrorBox("Startup Error", err.message);
    stopBackend();
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
