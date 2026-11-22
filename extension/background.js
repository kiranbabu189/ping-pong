// Registers the api-pingpong auto build as a MAIN-world, document_start content script
// on the origins the user enabled from the popup. Running in the page's own world
// lets it patch fetch/XHR before the site's code runs.
const SCRIPT_ID = 'api-pingpong';

async function sync() {
  const { origins = [] } = await chrome.storage.local.get('origins');
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (!origins.length) return;
  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches: origins.map((o) => `${o}/*`),
      js: ['api-pingpong.auto.global.js'],
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: false,
      persistAcrossSessions: true,
    },
  ]);
}

chrome.runtime.onInstalled.addListener(sync);
chrome.runtime.onStartup.addListener(sync);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.origins) sync();
});
