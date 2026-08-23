const DB_NAME = "videoAppDB";
const STORE_NAME = "videos";
const VIDEO_KEY = "currentVideo";
const METADATA_KEY = "videoMetadata";

const player = document.getElementById("player");
const controls = document.getElementById("controls");
const addBtn = document.getElementById("addBtn");
const deleteBtn = document.getElementById("deleteBtn");
const fileInput = document.getElementById("fileInput");
let hideTimer = null;
let isLoadingVideo = false;

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
  isLoadingVideo = true;
  
  try {
    const db = await openDB();
    
    // حفظ البيانات الوصفية
    const metadata = {
      size: blob.size,
      type: blob.type,
      timestamp: Date.now()
    };
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      
      // حذف الفيديو القديم أولاً
      store.delete(VIDEO_KEY);
      store.delete(METADATA_KEY);
      
      // حفظ الفيديو الجديد
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
        if (blob && blob.size > 0) {
          resolve(blob);
        } else {
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
    // إيقاف الفيديو السابق وتحرير الذاكرة
    if (player.src) {
      URL.revokeObjectURL(player.src);
    }
    
    player.pause();
    
    // إنشاء URL جديد من الـ blob
    const url = URL.createObjectURL(blob);
    player.src = url;
    player.classList.add("active");
    
    // تشغيل الفيديو مباشرة بدون تكرار إلا إذا كنا نريد
    player.loop = false;
    
    // محاولة التشغيل
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
  
  try {
    showAddButton(); // عرض رسالة التحميل
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

// معالجة أحداث الفيديو
player.addEventListener("ended", () => {
  // عند انتهاء الفيديو
  if (!player.loop) {
    showAddButton();
  }
});

player.addEventListener("error", (e) => {
  console.error("خطأ في الفيديو:", e);
  showAddButton();
});

// tap on the video briefly reveals the add button
player.addEventListener("click", () => {
  if (controls.classList.contains("hidden")) {
    showAddButton();
  } else {
    hideAddButton();
  }
});

// ---------- init ----------
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

// register service worker for offline / installability
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("فشل تسجيل Service Worker:", err);
    });
  });
}
