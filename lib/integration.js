// Thunderbird does not focus the main window when opening options from a
// compose window. Keep the whole operation in the background: focusing the
// main window closes the popup and destroys its execution context.
export async function openManager() {
  const url = browser.runtime.getURL("manager/manager.html");
  // A URL filter requires the broad "tabs" permission in Thunderbird, even
  // for our own page. Query metadata and match the own-extension URL locally.
  const managerTabs = async () => (await browser.tabs.query({ type: "content" })).filter((tab) => tab.url === url);
  const tabs = await managerTabs();
  let tab = tabs.find((candidate) => candidate.active) ?? tabs[0];
  if (!tab) {
    // Let Thunderbird create an extension options tab, including its link and
    // download handling, rather than a generic content tab.
    await browser.runtime.openOptionsPage();
    // openOptionsPage resolves before the new tab has committed its URL.
    for (let attempt = 0; attempt < 40 && !tab; attempt++) {
      tab = (await managerTabs())[0];
      if (!tab) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!tab) throw new Error("Quicktext Lite: manager tab was not opened");
  }
  await browser.tabs.update(tab.id, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
}

export async function registerComposeScript(script) {
  // Thunderbird throws when a filtered lookup contains an unregistered ID.
  const registered = await browser.scripting.compose.getRegisteredScripts();
  if (!registered.some(({ id }) => id === script.id)) {
    await browser.scripting.compose.registerScripts([script]);
  }
}
