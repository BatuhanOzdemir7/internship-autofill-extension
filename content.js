(() => {
  "use strict";

  const LISTENER_MARKER = "__privateFormAssistantLearnListeners__";
  const POPUP_ID = "__privateFormAssistantLearnPrompt__";
  const SENSITIVE_TERMS = [
    "tckn", "tc kimlik", "tc no", "kimlik numarasi", "kimlik no", "national id",
    "identity number", "government id", "government identifier", "ssn", "passport", "pasaport", "iban", "kredi karti", "credit card", "credit card number", "bank account", "password", "cvv", "security code"
  ];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/\s+/g, " ")
    .trim();

  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (data) => resolve(data || {}));
      } catch {
        resolve({});
      }
    });
  }

  function storageSet(values) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(values, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  function isSensitiveField(value) {
    const text = normalize(value);
    return SENSITIVE_TERMS.some((term) => text.includes(normalize(term)));
  }

  function pseudoText(element) {
    if (!element || !element.ownerDocument?.defaultView) return "";
    const view = element.ownerDocument.defaultView;
    return ["::before", "::after"].map((pseudo) => {
      let content = "";
      try { content = view.getComputedStyle(element, pseudo).content || ""; } catch {}
      if (content === "none" || content === "normal") return "";
      return content.replace(/^(["'])(.*)\1$/, "$2");
    }).filter(Boolean).join(" ");
  }

  function textOf(element) {
    if (!element) return "";
    return [element.innerText, element.textContent, pseudoText(element)]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
  }

  function getRoots() {
    const roots = [];
    const seen = new Set();
    const visit = (root) => {
      if (!root || seen.has(root)) return;
      seen.add(root);
      roots.push(root);
      for (const element of root.querySelectorAll?.("*") || []) {
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(document);
    return roots;
  }

  function allElements(selector) {
    return getRoots().flatMap((root) => Array.from(root.querySelectorAll(selector)));
  }

  function relatedLabelText(element) {
    if (element.labels?.length) {
      const label = Array.from(element.labels).map((node) => textOf(node)).filter(Boolean).join(" ");
      if (label) return label;
    }
    const wrapper = element.closest?.("label");
    if (wrapper) return textOf(wrapper);
    const id = element.id;
    if (id) {
      for (const root of getRoots()) {
        const label = Array.from(root.querySelectorAll("label[for]"))
          .find((node) => node.htmlFor === id);
        if (label && textOf(label)) return textOf(label);
      }
    }
    let child = element;
    for (let depth = 0; child && depth < 12; depth += 1) {
      const parent = child.parentElement;
      if (!parent) break;
      const siblings = Array.from(parent.children || []);
      const index = siblings.findIndex((node) => node === child || node.contains(child));
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const sibling = siblings[cursor];
        const siblingText = textOf(sibling).trim();
        if (siblingText && siblingText.length <= 160) return siblingText;
      }
      child = parent;
    }
    return "";
  }
  function fieldInfo(element) {
    const radioWrapper = element.matches?.('input[type="radio"], input[type="checkbox"]')
      ? element.closest('[role="radio"], [role="checkbox"]')
      : null;
    const target = radioWrapper || element;
    const label = relatedLabelText(element);
    const attrs = [
      label,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("aria-labelledby"),
      element.getAttribute?.("placeholder"),
      element.getAttribute?.("data-ph"),
      element.getAttribute?.("title"),
      element.getAttribute?.("name"),
      element.getAttribute?.("id"),
      element.getAttribute?.("autocomplete"),
      target.getAttribute?.("aria-label"),
      target.getAttribute?.("data-label"),
      textOf(target)
    ].filter(Boolean);
    return { label: label || attrs.find(Boolean) || "", text: attrs.join(" "), target };
  }

  function isSensitive(element, info) {
    const all = [info.text, element.name, element.id, element.getAttribute?.("autocomplete")].join(" ");
    return isSensitiveField(all);
  }

  function hasUsableBox(element) {
    if (!element?.isConnected) return false;
    const view = element.ownerDocument.defaultView;
    let current = element;
    while (current && current.nodeType === 1) {
      const style = view.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) return false;
      current = current.parentElement;
    }
    const style = view.getComputedStyle(element);
    if (style.clip === "rect(0px, 0px, 0px, 0px)" || style.clip === "rect(0, 0, 0, 0)") return false;
    if (/inset\(\s*50%\s*\)/i.test(style.clipPath || "")) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function isHiddenHoneypot(element) {
    if (element.getAttribute?.("aria-hidden") === "true" || element.getAttribute?.("tabindex") === "-1") return true;
    const type = normalize(element.type || "");
    if (type === "radio" || type === "checkbox") {
      const wrapper = element.closest('[role="radio"], [role="checkbox"], label, [aria-checked], [data-state]');
      return !(wrapper && hasUsableBox(wrapper));
    }
    return !hasUsableBox(element);
  }

  const FIELD_TERMS = {
    firstName: ["first name", "given name", "firstname", "adiniz", "ad", "isim"],
    lastName: ["last name", "surname", "family name", "lastname", "soyad", "soyadiniz"],
    fullName: ["full name", "name surname", "ad soyad", "adiniz soyadiniz"],
    email: ["email", "e posta", "eposta", "mail"],
    phone: ["phone", "telephone", "mobile", "telefon", "gsm", "cep telefonu"],
    linkedin: ["linkedin"], github: ["github"], portfolio: ["portfolio", "portfoy", "website", "web site"],
    university: ["university", "school", "okul", "yuva", "egitim", "fakulte", "universite"],
    department: ["department", "major", "bolum", "alan", "program", "programi"],
    gpa: ["gpa", "grade point", "not ortalamasi", "ortalama"],
    dob: ["date of birth", "birth date", "dogum tarihi", "dogum"],
    gender: ["gender", "cinsiyet"],
    experience: ["experience", "work history", "is tecrubesi", "deneyim", "tecrube"],
    location: ["location", "city", "address", "konum", "sehir", "il"],
    educationLevel: ["education level", "education type", "egitim seviyesi", "egitim turu"],
    grade: ["grade", "class", "sinif", "kacinci sinif"],
    gradYear: ["graduation year", "grad year", "mezuniyet yili", "mezuniyet"],
    languages: ["languages", "diller", "yabanci dil"],
    technologies: ["technologies", "technology", "teknolojiler", "teknoloji"],
    skills: ["skills", "abilities", "beceriler", "yetenekler"]
  };

  function matchesTerm(text, term) {
    const value = normalize(text);
    const needle = normalize(term);
    if (needle === "ad") return /(^|\s)ad($|\s)/.test(value) && !value.includes("soyad");
    if (needle === "il") return /(^|\s)il($|\s)/.test(value);
    return value.includes(needle);
  }

  function profileKeyFor(info, element) {
    const text = normalize(info.text + " " + element.name + " " + element.id + " " + element.getAttribute?.("placeholder"));
    if (isSensitiveField(text)) return null;
    if (matchesTerm(text, "full name") || matchesTerm(text, "name surname") || matchesTerm(text, "ad soyad") || matchesTerm(text, "adiniz soyadiniz")) return "fullName";
    if (matchesTerm(text, "soyad") || matchesTerm(text, "last name") || matchesTerm(text, "surname")) return "lastName";
    if (matchesTerm(text, "first name") || matchesTerm(text, "given name") || matchesTerm(text, "firstname") || matchesTerm(text, "adiniz") || matchesTerm(text, "isim") || matchesTerm(text, "ad")) return "firstName";
    if (FIELD_TERMS.department.some((term) => matchesTerm(text, term))) return "department";
    for (const [key, terms] of Object.entries(FIELD_TERMS)) {
      if (key === "firstName" || key === "lastName" || key === "fullName" || key === "department") continue;
      if (terms.some((term) => matchesTerm(text, term))) return key;
    }
    const autocomplete = normalize(element.getAttribute?.("autocomplete"));
    if (autocomplete === "email") return "email";
    if (autocomplete === "given-name") return "firstName";
    if (autocomplete === "family-name") return "lastName";
    if (element.type === "email") return "email";
    if (element.type === "tel") return "phone";
    return null;
  }
  function getProfileValue(key, profile) {
    if (key === "fullName") return profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" ");
    return profile[key];
  }

  function findLearnedValue(info, element, learnedFields) {
    const aliases = [info.label, element.name, element.id, element.getAttribute?.("placeholder"), element.getAttribute?.("data-ph")]
      .filter(Boolean).map(normalize);
    for (const [key, value] of Object.entries(learnedFields || {})) {
      if (aliases.includes(normalize(key))) return value;
    }
    return undefined;
  }

  function valueFor(info, element, profile, learnedFields) {
    const key = profileKeyFor(info, element);
    const profileValue = key ? getProfileValue(key, profile) : "";
    if (profileValue !== undefined && profileValue !== null && String(profileValue).trim()) return { value: profileValue, key };
    const learned = findLearnedValue(info, element, learnedFields);
    return learned !== undefined && learned !== null && String(learned).trim() ? { value: learned, key: null } : null;
  }

  function dispatchFocus(element) {
    try { element.focus({ preventScroll: true }); } catch { try { element.focus(); } catch {} }
    element.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
  }

  function dispatchBlur(element) {
    try { element.blur(); } catch {}
    element.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
  }

  function setNativeValue(element, value) {
    let prototype = element;
    while ((prototype = Object.getPrototypeOf(prototype))) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor?.set) { descriptor.set.call(element, String(value)); return true; }
    }
    element.value = String(value);
    return true;
  }

  function fillTextControl(element, value) {
    dispatchFocus(element);
    setNativeValue(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    dispatchBlur(element);
  }

  function fillContentEditable(element, value) {
    dispatchFocus(element);
    let inserted = false;
    try {
      element.ownerDocument.execCommand("insertText", false, String(value));
      inserted = normalize(element.textContent) === normalize(value);
    } catch {}
    if (!inserted) element.textContent = String(value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    dispatchBlur(element);
  }

  function optionText(option) {
    return normalize([textOf(option), option.getAttribute?.("value"), option.getAttribute?.("aria-label")].filter(Boolean).join(" "));
  }

  function closestDropdownTrigger(element) {
    const explicit = element.closest?.('[role="combobox"], [aria-haspopup], select, button');
    if (explicit) return explicit;
    let current = element;
    for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
      const text = textOf(current);
      const hasArrow = /[▼▾⌄⏷]/u.test(text) || Boolean(current.querySelector?.("svg"));
      if (hasArrow || current.getAttribute?.("aria-expanded") !== null) return current;
    }
    return element;
  }

  function isCustomDropdown(element, info) {
    if (element.matches?.("select")) return false;
    if (element.isContentEditable || element.getAttribute?.("contenteditable") === "true") {
      const context = element.closest?.('[role="combobox"], [aria-haspopup], [aria-expanded], [role="listbox"]');
      const parent = element.parentElement?.parentElement;
      const arrow = /[▼▾⌄⏷]/u.test(textOf(parent)) || Boolean(parent?.querySelector?.("svg"));
      const explicitTrigger = element.closest?.('button, [role="button"]');
      return Boolean(context || arrow || explicitTrigger || element.getAttribute("aria-readonly") === "true");
    }
    return Boolean(element.matches?.('[role="combobox"], [aria-haspopup], [aria-expanded], [data-dropdown], [data-select]'));
  }

  function simulatePointerClick(element) {
    if (!element?.isConnected) return;
    const view = element.ownerDocument.defaultView;
    const rect = element.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, composed: true, view, button: 0, buttons: 1, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    try { element.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true })); } catch {}
    element.dispatchEvent(new MouseEvent("mousedown", init));
    try { element.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true })); } catch {}
    element.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 }));
    element.dispatchEvent(new MouseEvent("click", { ...init, buttons: 0 }));
  }

  async function selectCustomDropdown(element, value) {
    const trigger = closestDropdownTrigger(element);
    simulatePointerClick(trigger);
    await wait(450);
    const roots = getRoots();
    const candidates = roots.flatMap((root) => Array.from(root.querySelectorAll('li, [role="option"], option, button, [tabindex], div, span')))
      .filter((candidate) => candidate !== trigger && hasUsableBox(candidate));
    const wanted = normalize(value);
    const exact = candidates.filter((candidate) => optionText(candidate) === wanted || normalize(candidate.getAttribute?.("value")) === wanted);
    const partial = candidates.filter((candidate) => {
      const text = optionText(candidate);
      return text && text.includes(wanted);
    });
    const match = (exact.length ? exact : partial).sort((a, b) => optionText(a).length - optionText(b).length)[0];
    if (match) simulatePointerClick(match);
    await wait(250);
    return Boolean(match);
  }

  function getChoiceText(radio) {
    const wrapper = radio.closest('[role="radio"], [role="checkbox"]');
    return normalize([
      radio.value,
      radio.getAttribute("aria-label"),
      textOf(wrapper),
      pseudoText(wrapper),
      textOf(wrapper?.querySelector("svg")),
      relatedLabelText(radio)
    ].filter(Boolean).join(" "));
  }

  function fillRadioGroup(radios, value) {
    const wanted = normalize(value);
    const radio = radios.find((item) => {
      const choice = getChoiceText(item);
      return choice.includes(wanted) || wanted.includes(normalize(item.value));
    });
    if (!radio) return false;
    const wrapper = radio.closest('[role="radio"], [role="checkbox"], label, [aria-checked], [data-state]');
    const target = wrapper && hasUsableBox(wrapper) ? (wrapper.querySelector("svg") || wrapper) : radio;
    simulatePointerClick(target);
    return true;
  }

  function selectNativeSelect(element, value) {
    const wanted = normalize(value);
    const option = Array.from(element.options || []).find((item) => normalize(item.textContent) === wanted || normalize(item.value) === wanted)
      || Array.from(element.options || []).find((item) => normalize(item.textContent).includes(wanted));
    if (!option) return false;
    dispatchFocus(element);
    setNativeValue(element, option.value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    dispatchBlur(element);
    return true;
  }

  function formControls() {
    const selector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select, [contenteditable="true"], [role="combobox"], [aria-haspopup], [data-dropdown], [data-select]';
    return allElements(selector).filter((element) => !element.matches?.('[data-private-form-assistant]'));
  }

  function learnableValue(element) {
    if (element.matches?.('input[type="radio"], input[type="checkbox"]')) {
      if (!element.checked) return "";
      const wrapper = element.closest('[role="radio"], [role="checkbox"]');
      return textOf(wrapper) || element.value || "";
    }
    if (element.matches?.("select")) return element.selectedOptions?.[0]?.textContent?.trim() || element.value || "";
    if (element.isContentEditable || element.getAttribute?.("contenteditable") === "true") return element.textContent?.trim() || "";
    return String(element.value || "").trim();
  }

  function profileContainsValue(profile, value) {
    const target = normalize(value);
    if (!target) return true;
    return Object.values(profile || {}).some((entry) => {
      const values = Array.isArray(entry) ? entry : [entry];
      return values.some((candidate) => normalize(candidate) === target);
    });
  }

  function showLearnPrompt(info, element, value) {
    if (document.getElementById(POPUP_ID)) return;
    const host = document.createElement("div");
    host.id = POPUP_ID;
    host.setAttribute("data-private-form-assistant", "true");
    host.style.cssText = "all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483647;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ":host{all:initial}*{box-sizing:border-box;font-family:Inter,Arial,sans-serif}.card{width:min(360px,calc(100vw - 32px));padding:16px;border:1px solid #f2b8c8;border-radius:14px;background:#fff;color:#1d2732;box-shadow:0 12px 40px #13202b35}.title{margin:0 0 7px;font-size:14px;font-weight:700}.label{margin:0 0 13px;color:#536170;font-size:12px;overflow-wrap:anywhere}.actions{display:flex;gap:7px;flex-wrap:wrap}button{border:0;border-radius:8px;padding:8px 10px;background:#e31b54;color:#fff;font-size:12px;font-weight:700;cursor:pointer}button:hover{filter:brightness(.94)}button.secondary{background:#edf1f5;color:#263544}button.muted{background:transparent;color:#536170}";
    const card = document.createElement("section");
    card.className = "card";
    const title = document.createElement("p");
    title.className = "title";
    title.textContent = "Bu bilgiyi sonraki başvurular için kaydedelim mi?";
    const label = document.createElement("p");
    label.className = "label";
    label.textContent = info.label || element.name || element.id || "Form alanı";
    const actions = document.createElement("div");
    actions.className = "actions";
    const createButton = (text, className, action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.textContent = text;
      button.addEventListener("click", action);
      return button;
    };
    const close = () => host.remove();
    actions.append(
      createButton("Evet", "", async () => {
        const key = String(info.label || element.name || element.id || "").trim();
        if (key && !isSensitiveField(key)) {
          const { learnedFields = {} } = await storageGet("learnedFields");
          await storageSet({ learnedFields: { ...learnedFields, [key]: value } });
        }
        close();
      }),
      createButton("Hayır", "secondary", close),
      createButton("Bi' daha sorma", "muted", async () => {
        await storageSet({ neverAskLearn: true, autoLearnEnabled: false });
        close();
      })
    );
    card.append(title, label, actions);
    shadow.append(style, card);
    (document.documentElement || document.body).append(host);
  }

  function installLearningListeners(profile, learnedFields, enabled) {
    if (!enabled || window[LISTENER_MARKER]) return;
    const seen = new WeakSet();
    window[LISTENER_MARKER] = seen;
    const attach = () => {
      for (const element of formControls()) {
        if (seen.has(element)) continue;
        seen.add(element);
        const check = () => setTimeout(async () => {
          if (!element.isConnected || isSensitive(element, fieldInfo(element)) || isHiddenHoneypot(element)) return;
          const value = learnableValue(element);
          if (!value || profileContainsValue(profile, value)) return;
          const info = fieldInfo(element);
          if (isSensitiveField(info.text) || findLearnedValue(info, element, learnedFields) !== undefined) return;
          const current = await storageGet(["autoLearnEnabled", "neverAskLearn"]);
          if (current.autoLearnEnabled === true && current.neverAskLearn !== true) showLearnPrompt(info, element, value);
        }, 80);
        for (const eventName of ["input", "change", "blur"]) element.addEventListener(eventName, check, { passive: true });
      }
    };
    attach();
  }

  async function runFill() {
    const stored = await storageGet(["profile", "learnedFields", "autoLearnEnabled", "neverAskLearn"]);
    const profile = stored.profile && typeof stored.profile === "object" ? { ...stored.profile } : {};
    profile.fullName = [profile.firstName, profile.lastName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
    const learnedFields = stored.learnedFields && typeof stored.learnedFields === "object" ? stored.learnedFields : {};
    const controls = formControls();
    const radiosByKey = new Map();
    const radioHandled = new WeakSet();

    installLearningListeners(profile, learnedFields, stored.autoLearnEnabled === true && stored.neverAskLearn !== true);

    for (const element of controls) {
      const debugInfo = fieldInfo(element);
      if (!element.isConnected || isSensitive(element, debugInfo)) continue;
      const type = normalize(element.type || "");
      if (type === "radio" || type === "checkbox") {
        const info = fieldInfo(element);
        const key = profileKeyFor(info, element);
        if (key && (key === "gender" || key === "experience")) {
          if (!radiosByKey.has(key)) radiosByKey.set(key, []);
          radiosByKey.get(key).push(element);
        }
        continue;
      }
      if (isHiddenHoneypot(element)) continue;
      const info = fieldInfo(element);
      const resolved = valueFor(info, element, profile, learnedFields);
      if (!resolved || resolved.value == null || String(resolved.value).trim() === "") continue;
      const value = Array.isArray(resolved.value) ? resolved.value.join(", ") : String(resolved.value);
      if (element.matches?.("select")) {
        if (isCustomDropdown(element, info)) await selectCustomDropdown(element, value);
        else selectNativeSelect(element, value);
      } else if (element.isContentEditable || element.getAttribute?.("contenteditable") === "true") {
        if (isCustomDropdown(element, info)) await selectCustomDropdown(element, value);
        else fillContentEditable(element, value);
      } else if (element.matches?.('input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="url"], input[type="search"], textarea')) {
        fillTextControl(element, value);
      } else if (isCustomDropdown(element, info)) {
        await selectCustomDropdown(element, value);
      }
    }

    for (const [key, radios] of radiosByKey) {
      if (radioHandled.has(radios[0])) continue;
      const profileValue = getProfileValue(key, profile) || findLearnedValue(fieldInfo(radios[0]), radios[0], learnedFields);
      if (profileValue) fillRadioGroup(radios, profileValue);
      radios.forEach((radio) => radioHandled.add(radio));
    }

    return { fieldsSeen: controls.length, passCompleted: true };
  }

  runFill().catch(() => {});
})();











