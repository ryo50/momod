async function generatePdf() {
    const pageUrl = document.getElementById("pageUrl").value;
    const maxPages = Number(document.getElementById("maxPages").value || 100);
    const status = document.getElementById("status");
  
    status.textContent = "ページ解析中...\n";
  
    // ① HTML取得
    const html = await (await fetch(pageUrl)).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
  
    // ② 画像URL候補収集
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
  
    // script内文字列も探索
    doc.querySelectorAll("script").forEach(s => {
      const matches = s.textContent.match(/https:\/\/z\d+\.momon-ga\.com\/galleries\/[^\/]+\/\d+\.webp/g);
      //https://z3.momon-ga.com/galleries/3709403/1.webp
      matches?.forEach(m => candidates.add(m));
    });
  
    const firstImage = [...candidates].find(u =>
      u.includes(".momon-ga.com/galleries/") && u.endsWith(".webp")
    );
  
    if (!firstImage) {
      status.textContent += "画像URLが見つかりません\n";
      return;
    }
  
    // ③ ベースURL抽出
    const baseUrl = firstImage.replace(/\/\d+\.webp$/, "/");
    status.textContent += `検出ベースURL:\n${baseUrl}\n`;
  
    // ④ PDF生成
    const pdfDoc = await PDFLib.PDFDocument.create();
    let miss = 0;
  
    for (let i = 1; i <= maxPages; i++) {
      const imgUrl = `${baseUrl}${i}.webp`;
      status.textContent += `取得中 ${i}\n`;
  
      try {
        const res = await fetch(imgUrl);
        if (!res.ok) {
          miss++;
          if (miss >= 5) break;
          continue;
        }
  
        const webp = await res.arrayBuffer();
        const png = await webpToPng(webp);
        const image = await pdfDoc.embedPng(png);
  
        const page = pdfDoc.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
        miss = 0;
  
      } catch {}
    }
  
    const pdfBytes = await pdfDoc.save();
    download(pdfBytes, "images.pdf");
    status.textContent += "完了\n";
  }
  
  async function webpToPng(bytes) {
    const blob = new Blob([bytes], { type: "image/webp" });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    return new Promise(r => canvas.toBlob(async b => r(await b.arrayBuffer()), "image/png"));
  }
  
  function download(bytes, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    a.download = name;
    a.click();
  }
  