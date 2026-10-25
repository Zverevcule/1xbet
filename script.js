const DB_NAME = "videoAppDB";
const STORE_NAME = "videos";
const VIDEO_KEY = "currentVideo";
const METADATA_KEY = "videoMetadata";
const VIDEO_POSITION_KEY = "videoCurrentPosition";
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const MAX_VIDEO_DURATION_SECONDS = 60 * 60 * 4; // 4 ساعات
const LARGE_VIDEO_THRESHOLD = 100 * 1024 * 1024; // 100 MB

const player = document.getElementById("player");
const screen = document.getElementById("screen");
const controls = document.getElementById("controls");
const addBtn = document.getElementById("addBtn");
const deleteBtn = document.getElementById("deleteBtn");
const fileInput = document.getElementById("fileInput");

let hideTimer = null;
let isLoadingVideo = false;
let currentBlobUrl = null;
let lastSelectedFile = null;
let lastSavedPlaybackTime = -1;
let lastTapTime = 0;
let lastSaveTimestamp = 0;
let isSeekingResume = false;

if (player) {
  player.preload = "metadata";
  player.controls = false;
  player.playsInline = true;
  player.muted = false;
}

function formatFileSize(bytes) {
  if (!bytes) return "0 MB";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getSavedPlaybackPosition() {
  try {
    const value = Number.parseFloat(localStorage.getItem(VIDEO_POSITION_KEY) || "0");
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch (err) {
    return 0;
  }
}

function savePlaybackPosition(force = false) {
  if (!player || !player.src) return;

  const time = Number(player.currentTime);
  if (!Number.isFinite(time) || time <= 0) return;

  const now = Date.now();
  if (!force && now - lastSaveTimestamp < 800) return;

  lastSaveTimestamp = now;
  lastSavedPlaybackTime = time;

  try {
    localStorage.setItem(VIDEO_POSITION_KEY, String(time.toFixed(2)));
  } catch (err) {
    console.warn("تعذر حفظ موضع التشغيل:", err);
  }
}

function clearPlaybackPosition() {
  try {
    localStorage.removeItem(VIDEO_POSITION_KEY);
  } catch (err) {
    console.warn("تعذر حذف موضع التشغيل:", err);
  }
  lastSavedPlaybackTime = -1;
  lastSaveTimestamp = 0;
}

function restorePlaybackPosition() {
  if (!player) return;
  const savedTime = getSavedPlaybackPosition();
  if (!savedTime || !Number.isFinite(player.duration) || player.duration <= 0) return;

  const safeTime = Math.min(savedTime, Math.max(player.duration - 0.25, 0));
  if (safeTime > 0 && Math.abs(player.currentTime - safeTime) > 0.5) {
    isSeekingResume = true;
    player.currentTime = safeTime;
    lastSavedPlaybackTime = safeTime;
    setTimeout(() => {
      isSeekingResume = false;
    }, 250);
  }
}

function resumePlaybackIfAllowed() {
  if (!player || !player.src || document.hidden || isSeekingResume) return;

  const savedTime = getSavedPlaybackPosition();
  if (!savedTime || savedTime <= 0) return;

  if (player.readyState >= 1 || player.duration > 0) {
    restorePlaybackPosition();
    if (player.paused) {
      player.play().catch(() => {});
    }
  }
}

function isValidVideoFile(file) {
  if (!file) return false;
  const validMime = file.type.startsWith("video/");
  const validExtension = /\.(mp4|webm|mov|m4v|mkv|ogg|3gp|avi|flv|wmv)$/i.test(file.name || "");
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

function showAddButton() {
  if (!controls) return;
  controls.classList.remove("hidden");
  clearTimeout(hideTimer);
  if (player && player.classList.contains("active")) {
    hideTimer = setTimeout(hideAddButton, 3500);
  }
}

function hideAddButton() {
  if (!controls) return;
  controls.classList.add("hidden");
}

function handleDoubleTapShowControls() {
  const now = Date.now();
  const isDoubleTap = now - lastTapTime < 300;
  lastTapTime = now;

  if (isDoubleTap) {
    showAddButton();
  }
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
    throw new Error(`الفيديو كبير جدًا. الحد الأقصى المسموح به هو ${Math.round(MAX_VIDEO_SIZE / (1024 * 1024 * 1024))} GB.`);
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
  if (!player || !blob) return;

  try {
    cleanupObjectURL();
    player.pause();
    player.removeAttribute("src");
    player.load();
    player.classList.remove("active");

    const url = URL.createObjectURL(blob);
    currentBlobUrl = url;
    player.src = url;
    player.classList.add("active");
    player.preload = "metadata";
    player.controls = false;
    player.muted = false;
    player.style.opacity = "0";

    const handleReady = () => {
      player.style.opacity = "1";
      restorePlaybackPosition();
      if (!document.hidden && player.paused) {
        player.play().catch(() => {});
      }
    };

    player.addEventListener("loadedmetadata", handleReady, { once: true });
    player.addEventListener("loadeddata", handleReady, { once: true });
    player.addEventListener("canplay", handleReady, { once: true });

    hideAddButton();
  } catch (err) {
    console.error("خطأ في تشغيل الفيديو:", err);
    showAddButton();
  }
}

function setBusyState(isBusy) {
  if (!addBtn || !deleteBtn) return;
  addBtn.style.opacity = isBusy ? "0.5" : "1";
  addBtn.disabled = isBusy;
  deleteBtn.disabled = isBusy;
}

if (addBtn) {
  addBtn.addEventListener("click", () => {
    if (!isLoadingVideo) {
      fileInput.click();
    }
  });
}

if (deleteBtn) {
  deleteBtn.addEventListener("click", async () => {
    try {
      setBusyState(true);
      await deleteVideoFromDB();
      clearPlaybackPosition();
      if (player) {
        player.pause();
        cleanupObjectURL();
        player.removeAttribute("src");
        player.load();
        player.classList.remove("active");
      }
      clearTimeout(hideTimer);
      showAddButton();
      showStatus("تم حذف الفيديو");
    } catch (err) {
      console.error("فشل حذف الفيديو:", err);
      showStatus("فشل حذف الفيديو", true);
    } finally {
      setBusyState(false);
    }
  });
}

if (fileInput) {
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
    clearPlaybackPosition();

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
}

if (player) {
  player.addEventListener("loadedmetadata", () => {
    const duration = Number(player.duration);
    if (Number.isFinite(duration) && duration > MAX_VIDEO_DURATION_SECONDS) {
      showStatus(`مدة الفيديو طويلة (${Math.round(duration / 60)} دقيقة)`, false);
    }
    restorePlaybackPosition();
  });

  player.addEventListener("canplay", () => {
    restorePlaybackPosition();
    if (!document.hidden && player.paused) {
      player.play().catch(() => {});
    }
  });

  player.addEventListener("timeupdate", () => savePlaybackPosition(false));
  player.addEventListener("pause", () => savePlaybackPosition(true));
  player.addEventListener("ended", () => {
    clearPlaybackPosition();
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
    if (controls && controls.classList.contains("hidden")) {
      showAddButton();
    } else if (controls) {
      hideAddButton();
    }
  });
}

if (screen) {
  screen.addEventListener("dblclick", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showAddButton();
  });

  screen.addEventListener("touchstart", (event) => {
    if (event.touches && event.touches.length > 0) {
      handleDoubleTapShowControls();
    }
  }, { passive: true });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    savePlaybackPosition(true);
    return;
  }

  if (document.visibilityState === "visible") {
    setTimeout(() => {
      if (!player || !player.src) return;
      restorePlaybackPosition();
      if (player.paused) {
        player.play().catch(() => {});
      }
    }, 250);
  }
});

window.addEventListener("pagehide", () => savePlaybackPosition(true));
window.addEventListener("beforeunload", () => savePlaybackPosition(true));
window.addEventListener("focus", () => {
  setTimeout(() => {
    if (!player || !player.src || document.hidden) return;
    restorePlaybackPosition();
    if (player.paused) {
      player.play().catch(() => {});
    }
  }, 250);
});

(async () => {
  try {
    const existing = await loadVideo();
    if (existing && existing.size > 0) {
      playBlob(existing);
    } else if (controls) {
      showAddButton();
    }
  } catch (err) {
    console.error("خطأ في التهيئة:", err);
    if (controls) showAddButton();
  }
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("فشل تسجيل Service Worker:", err);
    });
  });
}
