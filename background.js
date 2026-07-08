// JARVIS background service worker
// Content scripts can't reliably window.open() from an async speech-recognition
// callback (browsers treat that as "not a user gesture" and block the popup).
// Routing it through the extension's tabs API avoids that entirely.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "openTab" && msg.url) {
    chrome.tabs.create({ url: msg.url });
    sendResponse({ ok: true });
  }
  return true;
});
