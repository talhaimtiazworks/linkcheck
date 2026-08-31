// LinkCheck — Content Script
// Injected into all HTTP/HTTPS pages to extract link data from the DOM.

(function () {
  'use strict';

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractLinks') {
      const pageUrl = request.pageUrl || window.location.href;
      const result = extractLinks(pageUrl);
      sendResponse(result);
    }
    return true;
  });

  function extractLinks(pageUrl) {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const base = new URL(pageUrl);
    const pageDomain = base.hostname;
    const links = [];
    let ignored = 0;

    anchors.forEach((a, index) => {
      const raw = a.getAttribute('href');
      if (!raw || !raw.trim()) {
        ignored++;
        return;
      }
      const href = raw.trim();

      // Ignore non-HTTP schemes
      if (
        href.startsWith('javascript:') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('sms:')
      ) {
        ignored++;
        return;
      }
      if (href.startsWith('#')) {
        ignored++;
        return;
      }
      if (href.startsWith('data:')) {
        ignored++;
        return;
      }

      let url;
      try {
        url = new URL(href, pageUrl).href;
      } catch (e) {
        ignored++;
        return;
      }

      const urlObj = new URL(url);
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        ignored++;
        return;
      }

      const isInternal = urlObj.hostname === pageDomain || urlObj.hostname.endsWith('.' + pageDomain);
      const anchorText = (a.innerText || a.textContent || a.getAttribute('title') || '').trim();

      // Detect source location via ancestor elements
      let sourceLocation = 'Other';
      let el = a;
      while (el && el.tagName !== 'BODY') {
        const tag = el.tagName.toLowerCase();
        if (tag === 'nav') { sourceLocation = 'Navigation'; break; }
        if (tag === 'footer') { sourceLocation = 'Footer'; break; }
        if (tag === 'header') { sourceLocation = 'Header'; break; }
        if (tag === 'main' || tag === 'article') { sourceLocation = 'Main Content'; break; }
        if (tag === 'aside') { sourceLocation = 'Sidebar'; break; }
        el = el.parentElement;
      }

      links.push({ url, anchorText, isInternal, sourceLocation, index });
    });

    return { links, ignored };
  }
})();
