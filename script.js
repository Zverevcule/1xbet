const DB_NAME = "videoAppDB";
const STORE_NAME = "videos";
const VIDEO_KEY = "currentVideo";
const METADATA_KEY = "videoMetadata";
const MAX_VIDEO_SIZE = 25 * 1024 * 1024; // 25 MB
const MAX_VIDEO_DURATION_SECONDS = 90;
const LARGE_VIDEO_THRESHOLD = 10 * 1024 * 1024;

const player = document.getElementById("player");
const controls = document.getElementById("controls");
const addBtn = document.getElementById("addBtn");
const deleteBtn = document.getElementById("deleteBtn");
const fileInput = document.getElementById("fileInput");
let hideTimer = null;
let isLoadingVideo = false;
let currentBlobUrl = null;
let lastSelectedFile = null;

player.preload = "metadata";

function formatFileSize(bytes) {
  if (!bytes) return "0 MB";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isValidVideoFile(file) {
  if (!file) return false;
  const validMime = file.type.startsWith("video/");
  const validExtension = /\.(mp4|webm|mov|m4v|mkv|ogg|3gp)$/i.test(file.name || "");
  return validMime || validExtension;
}

function isVideoTooLarge(file) {
  return !!file && file.size > MAX_VIDEO_SIZE;
}

function cleanupObjectURL() {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
}

function showStatus(message, isError = false) {
  if (!controls) return;
  const label = controls.querySelector(".label");
  if (!label) return;

  const oldText = label.textContent;
  label.textContent = message;
  controls.classList.remove("hidden");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    label.textContent = oldText;
    controls.classList.add("hidden");
  }, isError ? 4000 : 2500);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveVideo(blob) {
  if (isLoadingVideo) return;
  if (!blob || !isValidVideoFile(blob)) {
    throw new Error("نوع الملف غير مدعوم أو الملف غير صالح.");
  }
  if (isVideoTooLarge(blob)) {
    throw new Error(`الفيديو كبير جدًا. الحد الأقصى المسموح به هو ${Math.round(MAX_VIDEO_SIZE / (1024 * 1024))} MB.`);
  }

  isLoadingVideo = true;

  try {
    const db = await openDB();
    const metadata = {
      size: blob.size,
      type: blob.type,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);

      store.delete(VIDEO_KEY);
      store.delete(METADATA_KEY);
      store.put(blob, VIDEO_KEY);
      store.put(metadata, METADATA_KEY);

      tx.oncomplete = () => {
        isLoadingVideo = false;
        resolve();
      };
      tx.onerror = () => {
        isLoadingVideo = false;
        reject(tx.error);
      };
    });
  } catch (err) {
    isLoadingVideo = false;
    throw err;
  }
}

async function deleteVideoFromDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(VIDEO_KEY);
    store.delete(METADATA_KEY);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadVideo() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(VIDEO_KEY);

      req.onsuccess = () => {
        const blob = req.result;
        if (blob && blob.size > 0 && blob.size <= MAX_VIDEO_SIZE) {
          resolve(blob);
        } else {
          if (blob && blob.size > MAX_VIDEO_SIZE) {
            deleteVideoFromDB().catch(() => {});
          }
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("خطأ في تحميل الفيديو:", err);
    return null;
  }
}

function evaluateVideoFile(file) {
  if (!file) return { valid: false, reason: "لا يوجد ملف" };

  if (!isValidVideoFile(file)) {
    return { valid: false, reason: "هذا الملف ليس فيديو صالحًا." };
  }

  if (isVideoTooLarge(file)) {
    return {
      valid: false,
      reason: `الفيديو كبير جدًا (${formatFileSize(file.size)}). الحد الأقصى ${formatFileSize(MAX_VIDEO_SIZE)}.`
    };
  }

  if (file.size > LARGE_VIDEO_THRESHOLD) {
    return {
      valid: true,
      reason: "يتم تجهيز الفيديو الكبير، قد يستغرق قليلًا قبل التشغيل.",
      large: true
    };
  }

  return { valid: true, reason: "تم تجهيز الفيديو بنجاح.", large: false };
}

function playBlob(blob) {
  try {
    cleanupObjectURL();
    player.pause();

    const url = URL.createObjectURL(blob);
    currentBlobUrl = url;
    player.src = url;
    player.classList.add("active");
    player.loop = false;
    player.preload = "metadata";

    const playPromise = player.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((err) => {
        console.warn("لا يمكن التشغيل التلقائي:", err);
      });
    }

    hideAddButton();
  } catch (err) {
    console.error("خطأ في تشغيل الفيديو:", err);
    showAddButton();
  }
}

function showAddButton() {
  controls.classList.remove("hidden");
  clearTimeout(hideTimer);
  if (player.classList.contains("active")) {
    hideTimer = setTimeout(hideAddButton, 3000);
  }
}

function hideAddButton() {
  controls.classList.add("hidden");
}

function setBusyState(isBusy) {
  addBtn.style.opacity = isBusy ? "0.5" : "1";
  addBtn.disabled = isBusy;
  deleteBtn.disabled = isBusy;
}

addBtn.addEventListener("click", () => {
  if (!isLoadingVideo) {
    fileInput.click();
  }
});

deleteBtn.addEventListener("click", async () => {
  try {
    setBusyState(true);
    await deleteVideoFromDB();
    player.pause();
    cleanupObjectURL();
    player.removeAttribute("src");
    player.load();
    player.classList.remove("active");
    clearTimeout(hideTimer);
    showAddButton();
    showStatus("تم حذف الفيديو");
  } catch (err) {
    console.error("خطأ في حذف الفيديو:", err);
    showStatus("فشل حذف الفيديو", true);
  } finally {
    setBusyState(false);
  }
});

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const evaluation = evaluateVideoFile(file);
  if (!evaluation.valid) {
    console.warn(evaluation.reason);
    showStatus(evaluation.reason, true);
    fileInput.value = "";
    return;
  }

  lastSelectedFile = file;

  try {
    setBusyState(true);
    showStatus(evaluation.large ? "جارٍ تجهيز الفيديو الكبير..." : "جارٍ حفظ الفيديو...");

    await saveVideo(file);
    playBlob(file);
    showStatus(evaluation.large ? "تم تجهيز الفيديو الكبير بنجاح" : "تم حفظ الفيديو بنجاح");
  } catch (err) {
    console.error("خطأ في حفظ الفيديو:", err);
    showStatus(err.message || "فشل حفظ الفيديو", true);
  } finally {
    setBusyState(false);
    fileInput.value = "";
  }
});

player.addEventListener("loadedmetadata", () => {
  if (player.duration && Number.isFinite(player.duration) && player.duration > MAX_VIDEO_DURATION_SECONDS) {
    console.warn("الفيديو أطول من الحد المسموح به، سيتم إنذاره.");
    showStatus(`الفيديو طويل (${Math.round(player.duration)}s)`, true);
  }
});

player.addEventListener("timeupdate", () => {
  if (!player.duration || !Number.isFinite(player.duration)) return;
  if (player.duration > MAX_VIDEO_DURATION_SECONDS) {
    if (player.currentTime >= MAX_VIDEO_DURATION_SECONDS) {
      player.pause();
      player.currentTime = 0;
      showStatus(`تم إيقاف الفيديو بعد ${MAX_VIDEO_DURATION_SECONDS} ثانية`, true);
    }
  }
});

player.addEventListener("ended", () => {
  if (!player.loop) {
    showAddButton();
  }
});

player.addEventListener("error", (e) => {
  console.error("خطأ في الفيديو:", e);
  showStatus("فشل تشغيل الفيديو", true);
  showAddButton();
});

player.addEventListener("click", () => {
  if (controls.classList.contains("hidden")) {
    showAddButton();
  } else {
    hideAddButton();
  }
});

(async () => {
  try {
    const existing = await loadVideo();
    if (existing && existing.size > 0) {
      playBlob(existing);
    } else {
      showAddButton();
    }
  } catch (err) {
    console.error("خطأ في التهيئة:", err);
    showAddButton();
  }
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("فشل تسجيل Service Worker:", err);
    });
  });
}
