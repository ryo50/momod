const PROXY_BASE = "https://momod-workers.ryo1119g.workers.dev/?url=";
const TARGET_DOMAIN = "momon-ga.com";


// ==============================
// キュー管理
// ==============================
let queue = [];
let isPaused = false;

// ==============================
// キュー開始
// ==============================
async function processQueue() {
  isPaused = false;
  log("キュー処理開始");

  while (queue.length > 0 && !isPaused) {
    const url = queue.shift();
    log(`処理開始: ${url}`);

    try {
      await generatePdfFromUrl(url);
      markAsGenerated(url);
    } catch (e) {
      log(`失敗: ${url}`);
    }

    await sleep(1500); // Bot対策
  }

  log("キュー処理終了");
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function generatePdf() {
  const pageUrl = document.getElementById("pageUrl").value.trim();
  const maxPages = Number(document.getElementById("maxPages").value || 100);

  if (!pageUrl) {
    log("URLを入力してください\n");
    return;
  }

  try {
    await generatePdfFromUrl(pageUrl, maxPages);
  } catch (e) {
    log(`失敗: ${e.message}`);
  }
}

async function generatePdfFromUrl(pageUrl, maxPages) {
  log("ページ取得中...");

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
    log(`ベースURL:${baseUrl}`);

    const h1 = doc.querySelector("h1");
    const title = sanitizeFilename(h1?.textContent || "untitled");

    // ④ PDF生成
    const pdfDoc = await PDFLib.PDFDocument.create();
    let miss = 0;
    let pageCount = 0;

    for (let i = 1; i <= maxPages; i++) {
      const imgUrl = `${baseUrl}${i}.webp`;
      log(`取得中 ${i}`);

      try {
        const res = await fetch(PROXY_BASE + encodeURIComponent(imgUrl));
        if (!res.ok) {
          miss++;
          if (miss >= 1) break;
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
        // await sleep(200); // Bot回避ウェイト
      } catch {
        miss++;
      }
    }

    if (pageCount === 0) {
      throw new Error("画像を取得できませんでした");
    }

    const pdfBytes = await pdfDoc.save();
    download(pdfBytes, `${title}.pdf`);
    log(`完了 (${pageCount}ページ)`);

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


function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/* =========================
   UI補助
========================= */

function log(msg) {
  const status = document.getElementById("status");
  status.textContent += msg + "\n";
  status.scrollTop = status.scrollHeight;
}

function clearPageUrl() {
  const input = document.getElementById("pageUrl");
  input.value = "";
  input.focus();
  toggleClearButton();
}

function toggleClearButton() {
  const input = document.getElementById("pageUrl");
  const btn = document.querySelector(".clear-btn");
  btn.style.display = input.value ? "block" : "none";
}

document.getElementById("pageUrl").addEventListener("input", toggleClearButton);


/* =========================
   localStorage（生成済み管理）
========================= */

function loadGeneratedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem("pdfGeneratedUrls") || "[]"));
  } catch {
    return new Set();
  }
}

function markAsGenerated(url) {
  const set = loadGeneratedSet();
  set.add(url);
  localStorage.setItem("pdfGeneratedUrls", JSON.stringify([...set]));
}

function clearGenerated() {
  localStorage.removeItem("pdfGeneratedUrls");
  log("生成済みURLをリセットしました");
}

/* =========================
   ブックマークHTML → キュー
========================= */

document.getElementById("bookmarkFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;

  log("ブックマーク読み込み中...");

  const text = await file.text();
  queue = buildQueueFromBookmarkHtml(text);

  log(`キュー生成完了: ${queue.length} 件`);
});

function buildQueueFromBookmarkHtml(html) {
  const result = [];
  const seen = new Set();
  const generated = loadGeneratedSet();

  const regex = /href="(https?:\/\/[^"]+)"/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    try {
      const url = new URL(match[1]);

      if (!url.hostname.startsWith(`https://${TARGET_DOMAIN}`)) continue;
      if (generated.has(url.href)) continue;
      if (seen.has(url.href)) continue;

      seen.add(url.href);
      result.push(url.href);
    } catch { }
  }

  return result;
}



/* =========================
   2段階方式（安定）
========================= */

async function generatePdfChunk() {
  const pageUrl = document.getElementById("pageUrl").value.trim();

  if (!pageUrl) {
    log("URLを入力してください\n");
    return;
  }

  try {
    await generatePdfChunked(pageUrl);
  } catch (e) {
    log(`失敗: ${e.message}`);
  }
}

async function generatePdfChunked(pageUrl) {
  log("ページ解析中...");

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
  log(`ベースURL:${baseUrl}`);

  const h1 = doc.querySelector("h1");
  const title = sanitizeFilename(h1?.textContent || "untitled");
  const CHUNK_SIZE = isAndroid() ? 25 : 40;
  const partialPdfs = [];

  let pageIndex = 1;

  while (true) {
    const pdf = await PDFLib.PDFDocument.create();
    let added = 0;

    for (let i = 0; i < CHUNK_SIZE; i++) {
      const imgUrl = `${baseUrl}${pageIndex}.webp`;
       log(`取得中 ${pageIndex}`);

      try {
        const res = await fetch(PROXY_BASE + encodeURIComponent(imgUrl));
        if (!res.ok) break;

        const pngBytes = await webpToPng(await res.arrayBuffer());
        const img = await pdf.embedPng(pngBytes);

        const page = pdf.addPage([img.width, img.height]);
        page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });

        pageIndex++;
        added++;
        await sleep(0);
      } catch {
        break;
      }
    }

    if (added === 0) break;

    partialPdfs.push(await pdf.save());
    await sleep(0);
  }

  log("PDF結合中...");
  await mergePartialPdfs(partialPdfs, title);
}

async function mergePartialPdfs(partials, title) {
  const finalPdf = await PDFLib.PDFDocument.create();

  for (const bytes of partials) {
    const pdf = await PDFLib.PDFDocument.load(bytes);
    const pages = await finalPdf.copyPages(pdf, pdf.getPageIndices());
    pages.forEach(p => finalPdf.addPage(p));
    await sleep(0);
  }

  const result = await finalPdf.save();
  download(result, `${title}.pdf`);
  log("完了（2段階方式）");
}