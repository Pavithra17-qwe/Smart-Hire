// desktop-agent/preload.js
//
// Runs in an isolated context between main.js (full Node/OS access) and
// consent-window.html (untrusted-ish renderer, no Node access). Only
// exposes the specific, narrow methods the consent screen actually needs —
// the renderer can never call arbitrary IPC channels or touch Node APIs
// directly. This is the standard Electron security pattern
// (contextIsolation: true + a minimal contextBridge surface).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('integrityAgent', {
  /**
   * Fetch the bundled config.json (apiBaseUrl, interviewId, candidateId)
   * so the consent screen can show what it's about to connect to.
   * Returns null if no config.json was bundled with this download.
   */
  getConfig: () => ipcRenderer.invoke('integrity-agent:get-config'),

  /**
   * Candidate clicked "I consent, start monitoring". Starts the
   * process/monitor checks in main.js.
   */
  grantConsent: (config) => ipcRenderer.invoke('integrity-agent:grant-consent', config),

  /**
   * Candidate clicked "Decline" — quits the app, nothing is ever sent.
   */
  declineConsent: () => ipcRenderer.invoke('integrity-agent:decline-consent'),

  /**
   * Candidate wants to stop monitoring mid-session without fully quitting.
   */
  stop: () => ipcRenderer.invoke('integrity-agent:stop'),
});