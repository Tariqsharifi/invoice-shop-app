// =====================================================================
// ماژول OCR
// این فایل هرگز مستقیم به یک سرویس OCR وصل نمی‌شود و هیچ API Key‌ای
// اینجا نیست. تصویر را به یک Supabase Edge Function می‌فرستد؛ خود آن
// تابع (که سمت سرور اجرا می‌شود) کلید سرویس OCR را در Secrets نگه
// می‌دارد و درخواست واقعی را می‌زند. نمونه‌ی آن تابع را در
// supabase/functions/ocr-invoice/index.ts ببین.
//
// اگر هنوز آن تابع را deploy نکرده‌ای (APP_CONFIG.OCR_MANUAL_FALLBACK = true)
// یا تابع خطا داد، برنامه یک ردیف خالی برمی‌گرداند تا کاربر بتواند
// دستی وارد کند — یعنی برنامه از همون روز اول، حتی بدون OCR واقعی، قابل استفاده است.
// =====================================================================

const OCR = {
  /**
   * file: تصویر فاکتور (از دوربین یا گالری)
   * برمی‌گرداند: { supplierName, invoiceDate, rows: [{name, quantity, unitPrice, totalPrice}] }
   */
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
alert("OCR DEBUG: " + JSON.stringify(data).slice(0, 800));
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

  /**
   * پاسخ خام Edge Function را به قالب استاندارد ردیف‌های قابل‌ویرایش تبدیل می‌کند.
   * این تابع طوری نوشته شده که با هر ساختار خروجی OCR (متن خام یا JSON ساخت‌یافته)
   * سازگار شود؛ فقط کافیست Edge Function داده‌اش را در یکی از این دو شکل بدهد.
   */
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

  /** تلاش ساده برای استخراج ردیف از متن خام OCR (
_parseRawText(text) {
    const digitMap = {
      "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9",
      "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9",
    };
    const toEnglishDigits = (s) => s.replace(/[۰-۹٠-٩]/g, (d) => digitMap[d] ?? d);

    const lines = text
      .split("\n")
      .map((l) => toEnglishDigits(l).trim())
      .filter(Boolean);

    const rows = [];
    for (const line of lines) {
      const match = line.match(/^(.+?)\s+(\d+)\s+([\d,،]+)\s+([\d,،]+)$/);
      if (match) {
        rows.push({
          name: match[1].trim(),
          quantity: Number(match[2]),
          unitPrice: Number(match[3].replace(/[,،]/g, "")),
          totalPrice: Number(match[4].replace(/[,،]/g, "")),
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
