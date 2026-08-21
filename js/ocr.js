// =====================================================================
// ماژول OCR
// این فایل هرگز مستقیم به یک سرویس OCR وصل نمی‌شود و هیچ API Key‌ای
// اینجا نیست. تصویر را به یک Supabase Edge Function می‌فرستد؛ خود آن
// تابع (که سمت سرور اجرا می‌شود) کلید سرویس OCR را در Secrets نگه
// می‌دارد و درخواست واقعی را می‌زند.
//
// اگر هنوز آن تابع را deploy نکردهای (APP_CONFIG.OCR_MANUAL_FALLBACK = true)
// یا تابع خطا داد، برنامه یک ردیف خالی برمی‌گرداند تا کاربر بتواند
// دستی وارد کند.
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
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const rows = [];
    for (const line of lines) {
      const match = line.match(/^(.+?)\s+(\d+)\s+([\d,]+)\s+([\d,]+)$/);
      if (match) {
        rows.push({
          name: match[1].trim(),
          quantity: Number(match[2]),
          unitPrice: Number(match[3].replace(/,/g, "")),
          totalPrice: Number(match[4].replace(/,/g, "")),
        });
      }
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
