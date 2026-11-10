// Localisation helpers for extension pages and the background script.

export function msg(key, ...substitutions) {
  return browser.i18n.getMessage(key, substitutions.map(String)) || key;
}

// Fills elements marked with data-i18n (text), data-i18n-placeholder,
// data-i18n-title and data-i18n-aria-label.
export function applyI18n(root = document) {
  for (const element of root.querySelectorAll("[data-i18n]")) element.textContent = msg(element.dataset.i18n);
  for (const element of root.querySelectorAll("[data-i18n-placeholder]")) {
    element.placeholder = msg(element.dataset.i18nPlaceholder);
  }
  for (const element of root.querySelectorAll("[data-i18n-title]")) element.title = msg(element.dataset.i18nTitle);
  for (const element of root.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", msg(element.dataset.i18nAriaLabel));
  }
  document.documentElement.lang = browser.i18n.getUILanguage();
}
