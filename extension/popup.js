(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const toggle = document.getElementById('toggle');
  let origin;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    origin = null;
  }
  if (!origin || !/^https?:/.test(origin)) {
    toggle.disabled = true;
    document.getElementById('origin').textContent = 'this page (not supported)';
    return;
  }
  document.getElementById('origin').textContent = origin;
  const { origins = [] } = await chrome.storage.local.get('origins');
  toggle.checked = origins.includes(origin);
  toggle.addEventListener('change', async () => {
    const { origins: current = [] } = await chrome.storage.local.get('origins');
    const next = toggle.checked ? [...new Set([...current, origin])] : current.filter((o) => o !== origin);
    await chrome.storage.local.set({ origins: next });
    // give the background worker a moment to re-register, then reload
    setTimeout(() => chrome.tabs.reload(tab.id), 150);
  });
})();
