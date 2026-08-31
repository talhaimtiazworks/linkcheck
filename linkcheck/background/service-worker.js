// LinkCheck — Service Worker (Manifest V3)
// Minimal background script. The popup handles all user-facing logic.

chrome.runtime.onInstalled.addListener(() => {
  // Initialize default settings on first install
  chrome.storage.local.get(['linkcheck_settings'], (res) => {
    if (!res.linkcheck_settings) {
      chrome.storage.local.set({
        linkcheck_settings: {
          maxLinks: 500,
          timeout: 10000,
          includeExternal: true,
          includeInternal: true,
          compactMode: false,
          rememberLatest: true
        }
      });
    }
  });
});
