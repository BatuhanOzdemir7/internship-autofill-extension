const fillButton = document.getElementById("fillButton");
const profileStatus = document.getElementById("profileStatus");
const actionStatus = document.getElementById("actionStatus");
const optionsButton = document.getElementById("optionsButton");

function hasProfile(profile) {
  return Boolean(profile && Object.values(profile).some((value) =>
    Array.isArray(value) ? value.some((entry) => String(entry).trim()) : String(value ?? "").trim()
  ));
}

async function refreshProfileStatus() {
  try {
    const { profile } = await chrome.storage.local.get("profile");
    const ready = hasProfile(profile);
    fillButton.disabled = !ready;
    profileStatus.textContent = ready
      ? "Profiliniz hazır. Doldurma yalnızca bu düğmeye bastığınızda başlar."
      : "Henüz profil kaydedilmedi. Önce bilgilerinizi düzenleyin.";
  } catch {
    fillButton.disabled = true;
    profileStatus.textContent = "Profil okunamadı. Ayarlar sayfasını açıp yeniden deneyin.";
  }
}

optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
fillButton.addEventListener("click", async () => {
  fillButton.disabled = true;
  actionStatus.textContent = "Etkin sekme kontrol ediliyor…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/i.test(tab.url || "")) {
      actionStatus.textContent = "Bu sayfa doldurma için kullanılamıyor. Normal bir web sayfasında deneyin.";
      return;
    }
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    actionStatus.textContent = result?.length ? "Doldurma denemesi tamamlandı. Göndermeden önce bilgileri kontrol edin." : "Sayfada doldurulabilecek alan bulunamadı.";
  } catch {
    actionStatus.textContent = "Bu sayfaya erişilemiyor. Sekmeyi yenileyip tekrar deneyin.";
  } finally {
    await refreshProfileStatus();
  }
});

refreshProfileStatus();
