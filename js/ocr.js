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
alert("OCR RAW: " + JSON.stringify(data.rawText || data).slice(0, 1200));
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

    const normalized = toEnglishDigits(text);

    const rawLines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);

    // حذف خط تیتر و خط‌های جداکننده (----)
    const lines = rawLines.filter((l) => {
      if (/^\|?-+(\s*\|\s*-+)*\|?$/.test(l)) return false;
      if (l.includes("نام کالا") || l.includes("مبلغ کل") || l.includes("ردیف")) return false;
      return true;
    });

    const isPureNumber = (s) => /^[\d,.]+$/.test(s);

    const rows = [];

    for (const line of lines) {
      const segments = line.split("|").map((s) => s.trim()).filter(Boolean);
      if (!segments.length) continue;

      const numericSegments = [];
      const textSegments = [];
      for (const seg of segments) {
        if (isPureNumber(seg)) {
          numericSegments.push(Number(seg.replace(/[,.]/g, "")));
        } else {
          textSegments.push(seg);
        }
      }

      // حداقل باید ۳ ستون عددی مستقل (مبلغ کل، بهای واحد، تعداد) داشته باشیم
      if (numericSegments.length < 3) continue;
      // و حداقل یک بخش متنی برای اسم کالا
      if (!textSegments.length) continue;

      // ترتیب مشاهده‌شده در خروجی جدولی OCR.space:
      // [مبلغ کل, بهای واحد, تعداد, بسته(اختیاری), ...]
      const totalPrice = numericSegments[0];
      const unitPrice = numericSegments[1];
      const quantity = numericSegments[2];

      if (!quantity || !unitPrice) continue;

      // اسم کالا = طولانی‌ترین بخش متنی خط (برای حذف تکه‌های کوچیک اضافی)
      const name = textSegments.sort((a, b) => b.length - a.length)[0];
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
