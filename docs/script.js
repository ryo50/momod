// ★ 自分の Cloudflare Workers URL に変更
const PROXY_BASE = "https://momod-workers.ryo1119g.workers.dev/?url=";

async function generatePdf() {
  const pageUrl = document.getElementById("pageUrl").value.trim();
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
      status.textContent += "画像URLを検出できませんでした\n";
      return;
    }

    // ③ ベースURL抽出
    const baseUrl = firstImage.replace(/\/\d+\.webp$/, "/");
    status.textContent += `検出ベースURL:\n${baseUrl}\n\n`;

    // ④ PDF生成
    const pdfDoc = await PDFLib.PDFDocument.create();
    let miss = 0;
    let pageCount = 0;

    for (let i = 1; i <= maxPages; i++) {
      const imgUrl = `${baseUrl}${i}.webp`;
      status.textContent += `取得中 ${i}\n`;

      try {
        const res = await fetch(PROXY_BASE + encodeURIComponent(imgUrl));
        if (!res.ok) {
          miss++;
          if (miss >= 5) break;
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
      } catch {
        miss++;
      }
    }

    if (pageCount === 0) {
      status.textContent += "\n画像を取得できませんでした\n";
      return;
    }

    const pdfBytes = await pdfDoc.save();
    download(pdfBytes, "images.pdf");
    status.textContent += `\n完了 (${pageCount}ページ)\n`;

  } catch (e) {
    status.textContent += "\nエラー:\n" + e.message;
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