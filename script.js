const DB_NAME = "videoAppDB";
const STORE_NAME = "videos";
const VIDEO_KEY = "currentVideo";
const METADATA_KEY = "videoMetadata";
const MAX_VIDEO_SIZE = 25 * 1024 * 1024; // 25 MB

const player = document.getElementById("player");
const controls = document.getElementById("controls");
const addBtn = document.getElementById("addBtn");
const deleteBtn = document.getElementById("deleteBtn");
const fileInput = document.getElementById("fileInput");
let hideTimer = null;
let isLoadingVideo = false;

player.preload = "metadata";

function isValidVideoFile(file) {
  if (!file) return false;
  const validMime = file.type.startsWith("video/");
  const validExtension = /\.(mp4|webm|mov|m4v|mkv|ogg|3gp)$/i.test(file.name || "");
  return validMime || validExtension;
}

function isVideoTooLarge(file) {
  return !!file && file.size > MAX_VIDEO_SIZE;
}

// ---------- IndexedDB helpers ----------
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

      const putReq = store.put(blob, VIDEO_KEY);
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

// ---------- UI logic ----------
function playBlob(blob) {
  try {
    if (player.src) {
      URL.revokeObjectURL(player.src);
    }

    player.pause();

    const url = URL.createObjectURL(blob);
    player.src = url;
    player.classList.add("active");
    player.loop = false;
    player.preload = "metadata";

    const playPromise = player.play();
    if (playPromise !== undefined) {
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

addBtn.addEventListener("click", () => {
  if (!isLoadingVideo) {
    fileInput.click();
  }
});

deleteBtn.addEventListener("click", async () => {
  try {
    await deleteVideoFromDB();
    player.pause();
    if (player.src) {
      URL.revokeObjectURL(player.src);
    }
    player.removeAttribute("src");
    player.load();
    player.classList.remove("active");
    clearTimeout(hideTimer);
    showAddButton();
  } catch (err) {
    console.error("خطأ في حذف الفيديو:", err);
  }
});

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!isValidVideoFile(file)) {
    console.warn("الملف المحدد ليس فيديو صالحًا.");
    fileInput.value = "";
    return;
  }

  if (isVideoTooLarge(file)) {
    console.warn("الفيديو كبير جدًا، تم رفضه لتجنب توقف التطبيق.");
    fileInput.value = "";
    showAddButton();
    return;
  }

  try {
    showAddButton();
    addBtn.style.opacity = "0.5";
    addBtn.disabled = true;

    await saveVideo(file);
    playBlob(file);

    addBtn.style.opacity = "1";
    addBtn.disabled = false;
  } catch (err) {
    console.error("خطأ في حفظ الفيديو:", err);
    addBtn.style.opacity = "1";
    addBtn.disabled = false;
    showAddButton();
  }

  fileInput.value = "";
});

player.addEventListener("ended", () => {
  if (!player.loop) {
    showAddButton();
  }
});

player.addEventListener("error", (e) => {
  console.error("خطأ في الفيديو:", e);
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
