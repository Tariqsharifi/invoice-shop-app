// =====================================================================
// ماژول OCR
// =====================================================================

const OCR = {
  async extractInvoice(file) {
    if (window.APP_CONFIG.OCR_MANUAL_FALLBACK) {
      return this._manualFallback();
    }

    try {
      const base64 = await this._fileToBase64(file);
      const { data, error } = await window.DB_CLIENT.functions.invoke(
        window.APP_CONFIG.OCR_FUNCTION_NAME,
        { body: { image_base64: base64 } }
      );
      if (error) throw error;
      return this._normalizeOcrResponse(data);
    } catch (err) {
      console.warn("OCR ناموفق بود، حالت ورود دستی فعال شد:", err);
      alert("خطای OCR: " + (err?.message || JSON.stringify(err)));
      return this._manualFallback();
    }
  },

  _manualFallback() {
    return {
      supplierName: "",
      invoiceDate: new Date().toISOString().slice(0, 10),
      rows: [{ name: "", quantity: 1, unitPrice: 0, totalPrice: 0 }],
    };
  },

  _normalizeOcrResponse(data) {
    if (data?.rows?.length) {
      return {
        supplierName: data.supplierName || "",
        invoiceDate: data.invoiceDate || new Date().toISOString().slice(0, 10),
        rows: data.rows.map((r) => ({
          name: r.name || "",
          quantity: Number(r.quantity) || 1,
          unitPrice: Number(r.unitPrice) || 0,
          totalPrice: Number(r.totalPrice) || (Number(r.quantity) || 1) * (Number(r.unitPrice) || 0),
        })),
      };
    }
    if (data?.rawText) {
      return { ...this._manualFallback(), rows: this._parseRawText(data.rawText) };
    }
    return this._manualFallback();
  },

  _parseRawText(text) {
    const digitMap = {
      "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9",
      "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9",
    };
    const toEnglishDigits = (s) => s.replace(/[۰-۹٠-٩]/g, (d) => digitMap[d] ?? d);

    // یکسان‌سازی اعداد و حذف جداکننده‌های هزارگان (چون فقط داخل قیمت‌ها استفاده میشن)
    const normalized = toEnglishDigits(text).replace(/[,،]/g, "");

    const lines = normalized
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const rows = [];

    for (const line of lines) {
      // رد کردن خط تیتر و خط جداکننده (----)
      if (/^-+(\s*\|\s*-+)*$/.test(line)) continue;
      if (line.includes("نام کالا") || line.includes("مبلغ کل") || line.includes("ردیف")) continue;

      // حذف نشانه‌های ردیف که OCR بهم چسبونده مثل n76 یا ن76
      const cleaned = line.replace(/n(\d{2,3})/gi, " ").replace(/ن(\d{2,3})/g, " ");

      const numberMatches = [...cleaned.matchAll(/\d+/g)];
      if (numberMatches.length < 2) continue;

      const numbers = numberMatches.map((m) => parseInt(m[0], 10)).filter((n) => n > 0);
      if (numbers.length < 2) continue;

      // پیدا کردن سه عددی که: تعداد × بهای واحد ≈ مبلغ کل
      let best = null;
      for (let i = 0; i < numbers.length; i++) {
        for (let j = 0; j < numbers.length; j++) {
          if (i === j) continue;
          for (let k = 0; k < numbers.length; k++) {
            if (k === i || k === j) continue;
            const qty = numbers[i];
            const unit = numbers[j];
            const total = numbers[k];
            if (unit < qty) continue; // فرض: بهای واحد از تعداد بزرگ‌تره
            const expected = qty * unit;
            const diff = Math.abs(expected - total) / total;
            if (diff < 0.03 && (!best || diff < best.diff)) {
              best = { qty, unit, total, diff };
            }
          }
        }
      }

      let quantity, unitPrice, totalPrice;
      if (best) {
        quantity = best.qty;
        unitPrice = best.unit;
        totalPrice = best.total;
      } else {
        // fallback: بزرگ‌ترین عدد = مبلغ کل، دومی = بهای واحد، کوچیک‌ترین = تعداد
        const sorted = [...numbers].sort((a, b) => a - b);
        totalPrice = sorted[sorted.length - 1] || 0;
        unitPrice = sorted[sorted.length - 2] || 0;
        quantity = sorted[0] || 1;
        if (quantity === unitPrice || quantity === totalPrice) quantity = 1;
      }

      // استخراج نام کالا: حذف اعداد و جداکننده‌ها
      const name = cleaned
        .replace(/\d+/g, " ")
        .replace(/[|\\/_-]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();

      if (!name) continue;

      rows.push({
        name,
        quantity,
        unitPrice,
        totalPrice: totalPrice || quantity * unitPrice,
      });
    }

    return rows.length ? rows : [{ name: "", quantity: 1, unitPrice: 0, totalPrice: 0 }];
  },

  _fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },
};

window.OCR = OCR;
