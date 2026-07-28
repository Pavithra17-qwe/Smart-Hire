// desktop-agent/main.js
//
// OPTIONAL Electron desktop agent. This is the ONLY layer of this system
// that can see OS-level information (running processes, monitor count,
// foreground app). A browser tab cannot do any of this — that's a hard
// platform limitation, not a bug to work around.
//
// Consent model:
// - The agent must be explicitly downloaded and launched by the candidate.
// - On launch it shows a consent screen (see consent-window.html, not
//   included here — build to match your design system) before it starts
//   sending ANY events.
// - It sends only small, typed event summaries (a known process name from
//   an allow-list, a monitor count, a foreground app name) — never screen
//   contents, never full process lists, never file paths or window titles
//   beyond the matched app name.
// - The candidate can quit the agent at any time; the backend records
//   'agent_stopped' when the connection drops.
//
// This file is a skeleton to adapt into your existing Electron build
// tooling (electron-builder, forge, etc.) — it is not a full app.

const { app, BrowserWindow, ipcMain } = require('electron');
const psList = require('ps-list'); // npm install ps-list
const { screen } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

// ── Launch config ──────────────────────────────────────────────────────────
// SmartHire generates a personalized `config.json` per candidate (containing
// only the interviewId, candidateId, and your API base URL — no secrets)
// and bundles it alongside this agent in the download the candidate
// receives, e.g. from a "Download Integrity Agent" link on the pre-interview
// screen. This keeps the candidate from having to manually type IDs in.
//
// Example config.json (place next to main.js):
// {
//   "apiBaseUrl": "https://your-smarthire-domain.com",
//   "interviewId": "abc123",
//   "candidateId": "cand456"
// }
function loadAgentConfig() {
  const configPath = path.join(__dirname, 'config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    // No config bundled — fall back to empty; consent-window.html will show
    // an error state rather than silently proceeding with missing IDs.
    return null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'consent-window.html'));
}

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Name-match only — we detect that a known remote-control tool's process
// is running, nothing about how it's configured or being used.
const REMOTE_CONTROL_SIGNATURES = [
  { match: /anydesk/i, name: 'AnyDesk' },
  { match: /ultraviewer/i, name: 'UltraViewer' },
  { match: /teamviewer/i, name: 'TeamViewer' },
  { match: /rustdesk/i, name: 'RustDesk' },
  { match: /remoting_host|chrome.*remote.*desktop/i, name: 'Chrome Remote Desktop' },
  { match: /quickassist/i, name: 'Microsoft Quick Assist' },
];

let consentGiven = false;
let pollInterval = null;
let backendUrl = null;
let interviewId = null;
let candidateId = null;

async function sendEvent(event) {
  if (!backendUrl) return;
  try {
    await fetch(`${backendUrl}/api/interview/integrity-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interviewId,
        candidateId,
        events: [{ ...event, timestamp: new Date().toISOString(), interviewId, candidateId }],
      }),
    });
  } catch (err) {
    console.error('[DesktopAgent] send failed:', err.message);
  }
}

async function checkRemoteControlProcesses() {
  const processes = await psList();
  for (const sig of REMOTE_CONTROL_SIGNATURES) {
    const found = processes.find((p) => sig.match.test(p.name));
    if (found) {
      await sendEvent({
        type: 'remote_control_process_detected',
        metadata: { processName: sig.name }, // matched label only, not raw process line
      });
    }
  }
}

function checkMonitors() {
  const displays = screen.getAllDisplays();
  if (displays.length > 1) {
    sendEvent({ type: 'multiple_monitors_detected', metadata: { monitorCount: displays.length } });
  }
}

// Foreground-app polling is platform-specific (active-win package or
// equivalent native binding). Left as a stub — wire in `active-win` or
// similar and only report the app NAME, not window title text, to avoid
// capturing incidental sensitive content (e.g. someone's email subject).
async function checkForegroundApp() {
  // const result = await activeWin();
  // if (result?.owner?.name) {
  //   sendEvent({ type: 'foreground_app_changed', metadata: { foregroundAppName: result.owner.name } });
  // }
}

function startMonitoring({ apiBaseUrl, interviewId: iId, candidateId: cId, pollMs = 15_000 }) {
  if (!consentGiven) {
    throw new Error('Cannot start monitoring before explicit consent is recorded.');
  }
  backendUrl = apiBaseUrl;
  interviewId = iId;
  candidateId = cId;

  sendEvent({ type: 'agent_started' });
  checkMonitors();
  checkRemoteControlProcesses();

  pollInterval = setInterval(() => {
    checkRemoteControlProcesses();
    checkForegroundApp();
  }, pollMs);
}

function stopMonitoring() {
  if (pollInterval) clearInterval(pollInterval);
  sendEvent({ type: 'agent_stopped' });
}

// Renderer (consent-window.html) asks for the bundled config on load so it
// can display *what* it's about to monitor and *which* interview it's tied
// to, before the candidate clicks anything.
ipcMain.handle('integrity-agent:get-config', () => {
  return loadAgentConfig();
});

// IPC bridge — the renderer's consent screen calls this once the candidate
// explicitly agrees.
ipcMain.handle('integrity-agent:grant-consent', (_event, config) => {
  consentGiven = true;
  startMonitoring(config);
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, 'consent-window.html'), {
      hash: 'monitoring-active',
    });
  }
  return { ok: true };
});

// Candidate declines — close the app without ever calling startMonitoring,
// so nothing is sent to the backend.
ipcMain.handle('integrity-agent:decline-consent', () => {
  app.quit();
  return { ok: true };
});

ipcMain.handle('integrity-agent:stop', () => {
  stopMonitoring();
  consentGiven = false;
  return { ok: true };
});

app.on('window-all-closed', () => {
  stopMonitoring();
  if (process.platform !== 'darwin') app.quit();
});

module.exports = { startMonitoring, stopMonitoring };