const PdfImport = {
  async toImageFiles(pdfFile, onProgress) {
    if (!window.pdfjsLib) throw new Error("pdf.js بارگذاری نشده");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const data = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const total = Math.min(pdf.numPages, 15);
    const baseName = (pdfFile.name || "invoice").replace(/\.pdf$/i, "");
    const files = [];

    for (let i = 1; i <= total; i++) {
      if (onProgress) onProgress(i, total);
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = 1800 / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;

      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) throw new Error("تبدیل صفحه " + i + " ناموفق");
      files.push(new File([blob], baseName + "-" + i + ".jpg", { type: "image/jpeg" }));
    }
    return files;
  },
};
window.PdfImport = PdfImport;
