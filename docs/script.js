const PROXY_BASE = "https://momod-workers.ryo1119g.workers.dev/?url=";
const TARGET_DOMAIN = "momon-ga.com";


// ==============================
// キュー管理
// ==============================
let urlQueue = [];
let isRunning = false;
let totalCount = 0;
const usedFilenames = new Map();
let isPaused = false;
let currentUrl = null;

// ==============================
// ブックマークHTML読込
// ==============================
async function loadBookmarks(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, "text/html");

  urlQueue = [...doc.querySelectorAll("a")]
    .map(a => a.href)
    .filter(h => h.startsWith(`https://${TARGET_DOMAIN}`));

  totalCount = urlQueue.length;
  updateStatus(`URLを ${totalCount} 件読み込みました\n`);
}

// ==============================
// キュー開始
// ==============================
async function startQueue() {
  if (isRunning || urlQueue.length === 0) return;

  isRunning = true;
  let done = 0;

  while (urlQueue.length > 0) {
    const url = urlQueue.shift();
    done++;

    saveQueueState(); 

    updateStatus(`\n==== ${done}/${totalCount} ====\n${url}\n`);
    try {
      await generatePdfSingle(url);
    } catch (e) {
      updateStatus(`失敗: ${e.message}\n`);
    }

    await sleep(2000); // Bot回避ウェイト
  }

  isRunning = false;
  
  if (isPaused) {
    updateStatus("\n⏸ 停止中\n");
  } else {
    clearQueueState();
    updateStatus("\n✅ すべて完了しました\n");
  }
}

async function generatePdfFromUrl() {
  const pageUrl = document.getElementById("pageUrl").value.trim();

  if (!pageUrl) {
    updateStatus("URLを入力してください\n");
    return;
  }

  try {
    await generatePdfSingle(pageUrl);
  } catch (e) {
    updateStatus(`失敗: ${e.message}\n`);
  }
}

async function generatePdfSingle(pageUrl) {
  const maxPages = Number(document.getElementById("maxPages").value || 100);
  const status = document.getElementById("status");

  if (!pageUrl) {
    status.textContent = "URLを入力してください\n";
    return;
  }

  status.textContent = "ページ取得中...\n";

  try {
    // ① HTML取得（proxy経由）
    const html = await (await fetch(PROXY_BASE + encodeURIComponent(pageUrl))).text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    // ② 画像URL候補を収集
    const candidates = new Set();

    doc.querySelectorAll("img, source").forEach(el => {
      if (el.src) candidates.add(el.src);
      if (el.dataset?.src) candidates.add(el.dataset.src);
      if (el.srcset) {
        el.srcset.split(",").forEach(s => {
          candidates.add(s.trim().split(" ")[0]);
        });
      }
    });

    // script内の文字列も探索
    doc.querySelectorAll("script").forEach(s => {
      const matches = s.textContent.match(
        /https:\/\/z\d+\.momon-ga\.com\/galleries\/[^\/]+\/\d+\.webp/g
      );
      matches?.forEach(m => candidates.add(m));
    });

    const firstImage = [...candidates].find(u =>
      u.includes(".momon-ga.com/galleries/") && u.endsWith(".webp")
    );

    if (!firstImage) {
      throw new Error("画像URLを検出できませんでした");
    }

    // ③ ベースURL抽出
    const baseUrl = firstImage.replace(/\/\d+\.webp$/, "/");
    updateStatus(`ベースURL:\n${baseUrl}\n`);
    
    const h1 = doc.querySelector("h1");
    const title = sanitizeFilename(h1?.textContent || "untitled");

    // ④ PDF生成
    const pdfDoc = await PDFLib.PDFDocument.create();
    let miss = 0;
    let pageCount = 0;

    for (let i = 1; i <= maxPages; i++) {
      const imgUrl = `${baseUrl}${i}.webp`;
      updateStatus(`取得中 ${i}\n`);

      try {
        const res = await fetch(PROXY_BASE + encodeURIComponent(imgUrl));
        if (!res.ok) {
          miss++;
          if (miss >= 2) break;
          continue;
        }

        const webpBytes = await res.arrayBuffer();
        const pngBytes = await webpToPng(webpBytes);
        const image = await pdfDoc.embedPng(pngBytes);

        const page = pdfDoc.addPage([image.width, image.height]);
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: image.width,
          height: image.height
        });

        pageCount++;
        miss = 0;
        await sleep(600); // Bot回避ウェイト
      } catch {
        miss++;
      }
    }

    if (pageCount === 0) {
      throw new Error("画像を取得できませんでした");
    }

    const pdfBytes = await pdfDoc.save();
    download(pdfBytes, `${title}.pdf`);
    updateStatus(`\n完了 (${pageCount}ページ)\n`);

  } catch (e) {
    miss++;
  }
}

// WebP → PNG（pdf-lib用）
async function webpToPng(bytes) {
  const blob = new Blob([bytes], { type: "image/webp" });
  const bitmap = await createImageBitmap(blob);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);

  return new Promise(resolve => {
    canvas.toBlob(async b => resolve(await b.arrayBuffer()), "image/png");
  });
}

function download(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function updateStatus(text) {
  document.getElementById("status").textContent += text;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function pauseQueue() {
  isPaused = true;
  updateStatus("\n⏸ 停止します（現在の処理が終わり次第）\n");
  saveQueueState();
}

async function resumeQueue() {
  if (isRunning) return;

  loadQueueState();
  isPaused = false;
  updateStatus("\n▶ 再開します\n");
  await startQueue();
}

function saveQueueState() {
  localStorage.setItem("pdfQueue", JSON.stringify({
    queue: urlQueue,
    total: totalCount,
    current: currentUrl
  }));
}

function loadQueueState() {
  const data = JSON.parse(localStorage.getItem("pdfQueue") || "{}");
  if (data.queue) {
    urlQueue = data.queue;
    totalCount = data.total || data.queue.length;
  }
}

function clearQueueState() {
  localStorage.removeItem("pdfQueue");
}

window.addEventListener("load", () => {
  if (localStorage.getItem("pdfQueue")) {
    updateStatus("未完了のキューがあります。再開できます。\n");
  }
});