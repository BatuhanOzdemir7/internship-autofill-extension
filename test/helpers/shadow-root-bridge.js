(() => {
  "use strict";

  const marker = "__stajAutofillShadowBridgeInstalled__";
  if (window[marker]) return;
  window[marker] = true;

  const attachShadow = Element.prototype.attachShadow;
  const rootsByHost = new WeakMap();

  try {
    Object.defineProperty(Element.prototype, "attachShadow", {
      configurable: true,
      writable: true,
      value: function (init) {
        const wasClosed = init?.mode === "closed";
        // Closed roots are retained and bridged through the standard host.shadowRoot
        // accessor; open roots keep their requested behavior unchanged.
        const options = wasClosed ? { ...init, mode: "open" } : init;
        const root = attachShadow.call(this, options);
        if (wasClosed) {
          rootsByHost.set(this, root);
        }
        return root;
      }
    });
  } catch {
    // If a page has locked down the prototype, the isolated walker still handles
    // ordinary open roots and the extension continues to work on that page.
  }

  // Keep the registry alive without exposing selectors or fixture-specific names.
  // Open roots are also available to the isolated content script via host.shadowRoot.
  Object.defineProperty(window, "__stajAutofillShadowRoots__", {
    configurable: false,
    enumerable: false,
    value: rootsByHost
  });
})();
