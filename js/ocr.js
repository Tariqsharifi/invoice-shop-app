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
    const normalized = toEnglishDigits(text);

    // چون \n وسط یک ردیف واقعی هم می‌افتد، کل جدول را یکجا (بدون توجه به خط)
    // بر اساس "|" می‌شکنیم — این از شکستن اشتباه ردیف‌ها جلوگیری می‌کند.
    const flat = normalized.replace(/\n/g, " ");
    const rawCells = flat.split("|").map((c) => c.trim());

    const isSeparator = (c) => /^-+$/.test(c);
    const isHeaderWord = (c) => /نام کالا|مبلغ کل|بهای واحد|تعداد|بسته|ردیف|دیف/.test(c);
    const isPureNumber = (c) => /^[\d,.]+$/.test(c);

    const cells = rawCells.filter((c) => c && !isSeparator(c) && !isHeaderWord(c));

    let expectedRowNum = null;
    const items = [];
    let currentNameParts = [];
    let currentNumbers = [];

    const flushItem = () => {
      if (currentNameParts.length && currentNumbers.length >= 2) {
        items.push({ name: currentNameParts.join(" ").trim(), numbers: currentNumbers.slice() });
      }
      currentNameParts = [];
      currentNumbers = [];
    };

    for (const cell of cells) {
      if (isPureNumber(cell)) {
        const val = Number(cell.replace(/[,.]/g, ""));
        // تشخیص ستون «ردیف»: اعداد کوچیک و متوالی (۷۶، ۷۷، ۷۸...) — این‌ها داده نیستن
        const looksLikeRowIndex =
          val > 0 && val < 1000 &&
          (expectedRowNum === null ? val < 200 : val === expectedRowNum + 1);
        if (looksLikeRowIndex) {
          expectedRowNum = val;
          continue; // رد کردن شماره ردیف
        }
        currentNumbers.push(val);
      } else {
        if (currentNumbers.length >= 2) flushItem();
        currentNameParts.push(cell);
      }
    }
    flushItem();

    const rows = [];
    for (const item of items) {
      const nums = item.numbers;
      if (nums.length < 2) continue;

      // پیدا کردن سه عددی که: تعداد × بهای واحد ≈ مبلغ کل
      let best = null;
      for (let i = 0; i < nums.length; i++) {
        for (let j = 0; j < nums.length; j++) {
          if (i === j) continue;
          for (let k = 0; k < nums.length; k++) {
            if (k === i || k === j) continue;
            const qty = nums[i], unit = nums[j], total = nums[k];
            if (qty <= 0 || unit <= 0 || total <= 0) continue;
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
        const sorted = [...nums].sort((a, b) => a - b);
        totalPrice = sorted[sorted.length - 1] || 0;
        unitPrice = sorted[sorted.length - 2] || 0;
        quantity = sorted[0] || 1;
        if (quantity === unitPrice) quantity = 1;
      }

      const name = item.name.replace(/\s{2,}/g, " ").trim();
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
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => {
        img.onload = () => {
          const maxDim = 1800;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          resolve(dataUrl.split(",")[1]);
        };
        img.onerror = reject;
        img.src = String(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },
};

window.OCR = OCR;
