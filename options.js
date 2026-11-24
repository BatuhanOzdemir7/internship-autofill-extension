const PROFILE_FIELDS = [
  ["firstName", "Ad"], ["lastName", "Soyad"], ["email", "E-posta"], ["phone", "Telefon"],
  ["linkedin", "LinkedIn"], ["github", "GitHub"], ["portfolio", "Portföy"],
  ["university", "Üniversite / Okul"], ["department", "Bölüm / Program"], ["gpa", "Not ortalaması"],
  ["dob", "Doğum tarihi"], ["gender", "Cinsiyet"], ["experience", "İş tecrübesi"], ["location", "Konum"],
  ["educationLevel", "Eğitim seviyesi"], ["grade", "Sınıf"], ["gradYear", "Mezuniyet yılı"],
  ["languages", "Diller"], ["technologies", "Teknolojiler"], ["skills", "Beceriler"]
];
const PROFILE_KEY_SET = new Set(PROFILE_FIELDS.map(([key]) => key));
const fieldsRoot = document.getElementById("profileFields");
const profileForm = document.getElementById("profileForm");
const saveStatus = document.getElementById("saveStatus");
const learnStatus = document.getElementById("learnStatus");
const learnedRoot = document.getElementById("learnedFields");

function createProfileForm() {
  for (const [key, label] of PROFILE_FIELDS) {
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    const id = "profile-" + key;
    const labelNode = document.createElement("label");
    labelNode.htmlFor = id;
    labelNode.textContent = label;
    const input = document.createElement(key === "skills" || key === "languages" || key === "technologies" ? "textarea" : "input");
    input.id = id;
    input.name = key;
    input.autocomplete = "off";
    if (key === "email") input.type = "email";
    if (key === "phone") input.type = "tel";
    if (key === "dob") input.type = "date";
    wrapper.append(labelNode, input);
    fieldsRoot.append(wrapper);
  }
}

async function loadSettings() {
  const data = await chrome.storage.local.get(["profile", "learnedFields", "autoLearnEnabled"]);
  const profile = data.profile && typeof data.profile === "object" ? data.profile : {};
  for (const [key] of PROFILE_FIELDS) {
    const input = profileForm.elements.namedItem(key);
    const value = profile[key];
    input.value = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  }
  document.getElementById("autoLearnToggle").checked = data.autoLearnEnabled === true;
  renderLearnedFields(data.learnedFields || {});
}

function parseProfile() {
  const profile = {};
  for (const [key] of PROFILE_FIELDS) {
    const raw = String(profileForm.elements.namedItem(key).value || "").trim();
    profile[key] = ["languages", "technologies", "skills"].includes(key)
      ? raw.split(",").map((item) => item.trim()).filter(Boolean)
      : raw;
  }
  profile.fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");
  return profile;
}

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await chrome.storage.local.set({ profile: parseProfile() });
    saveStatus.textContent = "Bilgiler bu tarayıcıya kaydedildi.";
  } catch {
    saveStatus.textContent = "Kaydetme başarısız oldu. Tekrar deneyin.";
  }
});

document.getElementById("autoLearnToggle").addEventListener("change", async (event) => {
  try {
    await chrome.storage.local.set({ autoLearnEnabled: event.target.checked });
    learnStatus.textContent = event.target.checked ? "Öğrenme önerileri açık." : "Öğrenme önerileri kapalı.";
  } catch {
    learnStatus.textContent = "Tercih kaydedilemedi.";
  }
});

function renderLearnedFields(learned) {
  learnedRoot.replaceChildren();
  const entries = Object.entries(learned).filter(([key]) => key && !PROFILE_KEY_SET.has(key));
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Henüz öğrenilmiş alan yok.";
    learnedRoot.append(empty);
    return;
  }
  for (const [key, value] of entries) {
    const row = document.createElement("div");
    row.className = "learned-item";
    const text = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = key;
    const storedValue = document.createElement("span");
    storedValue.textContent = String(value);
    text.append(label, storedValue);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Sil";
    remove.addEventListener("click", async () => {
      const current = await chrome.storage.local.get("learnedFields");
      const next = { ...(current.learnedFields || {}) };
      delete next[key];
      await chrome.storage.local.set({ learnedFields: next });
      renderLearnedFields(next);
    });
    row.append(text, remove);
    learnedRoot.append(row);
  }
}

document.getElementById("clearButton").addEventListener("click", async () => {
  if (!window.confirm("Bu tarayıcıdaki tüm profil ve öğrenilmiş alan verileri silinsin mi?")) return;
  try {
    await chrome.storage.local.clear();
    profileForm.reset();
    document.getElementById("autoLearnToggle").checked = false;
    saveStatus.textContent = "";
    learnStatus.textContent = "";
    document.getElementById("clearStatus").textContent = "Yerel veriler temizlendi.";
    renderLearnedFields({});
  } catch {
    document.getElementById("clearStatus").textContent = "Veriler temizlenemedi.";
  }
});

createProfileForm();
loadSettings().catch(() => { saveStatus.textContent = "Yerel profil okunamadı."; });
