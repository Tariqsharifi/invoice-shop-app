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
    return this._extractRowsFromCells(rawCells);
  },

  /**
   * جایگزین سمت‌کلاینت برای OCR: متنی که کاربر با Live Text آیفون از عکس
   * فاکتور کپی کرده، یا متنی که یک هوش مصنوعی برایش دسته‌بندی کرده، رو
   * پردازش می‌کنه. سه حالت رو به ترتیب امتحان می‌کنیم:
   *
   * ۱) فرمت دقیق خط‌به‌خط «اسم | تعداد | قیمت‌واحد | مبلغ‌کل» — وقتی هر
   *    ردیف واقعاً تو یه خط جداست.
   * ۲) فرمت «جاری»: همون فرمت بالا ولی بدون خط جدید بین ردیف‌ها — یعنی
   *    مبلغ‌کل یک ردیف بی‌فاصله (فقط با یک space) به اسم ردیف بعدی می‌چسبه.
   *    این دقیقاً همون فرمتیه که هوش مصنوعی‌ها معمولاً تولید می‌کنن.
   * ۳) اگه هیچ‌کدوم جواب نداد، حدسِ هوشمند قدیمی (بر پایه سلول‌ها) رو
   *    امتحان می‌کنیم — برای متن خامِ نامنظم OCR.
   */
  parsePastedText(text) {
    const digitMap = {
      "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9",
      "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9",
    };
    const toEn = (s) => s.replace(/[۰-۹٠-٩]/g, (d) => digitMap[d] ?? d);
    const normalizedText = toEn(text);
    const lines = normalizedText.split("\n").map((l) => l.trim()).filter(Boolean);

    // حالت ۱: خط‌به‌خط و دقیق
    const structuredRows = this._parseStructuredLines(lines);
    if (structuredRows.length) return structuredRows;

    // حالت ۲: همون فرمت ولی پشت‌سرهم و بدون جداکننده‌ی خط
    const flowingRows = this._parseFlowingPipeFormat(normalizedText);
    if (flowingRows.length) return flowingRows;

    // حالت ۳: حدس هوشمند قدیمی
    return this._extractRowsFromCells(lines);
  },

  /**
   * فرمت دقیق و بدون ابهام: هر خط باید دقیقاً «اسم | تعداد | قیمت‌واحد | مبلغ‌کل»
   * باشه. اگه حتی یه خط این قالب رو نداشته باشه، کلاً از این حالت صرف‌نظر
   * می‌کنیم (چون یعنی این متنِ ساختاریافته نیست، متن خامِ OCR هست).
   */
  _parseStructuredLines(lines) {
    const rows = [];
    for (const line of lines) {
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length !== 4) return [];
      const [name, qtyStr, unitStr, totalStr] = parts;
      const qty = Number(qtyStr.replace(/[,،.]/g, ""));
      const unit = Number(unitStr.replace(/[,،.]/g, ""));
      const total = Number(totalStr.replace(/[,،.]/g, ""));
      if (!name || !Number.isFinite(qty) || !Number.isFinite(unit) || !Number.isFinite(total)) {
        return [];
      }
      rows.push({ name, quantity: qty, unitPrice: unit, totalPrice: total || qty * unit });
    }
    return rows;
  },

  /**
   * فرمت «جاری»: کل متن یک پاراگراف پیوسته‌ست، هر ردیف داخلش دقیقاً
   * «اسم | تعداد | قیمت‌واحد | مبلغ‌کل» رو داره، ولی بین مبلغ‌کلِ یک ردیف
   * و اسمِ ردیف بعدی هیچ جداکننده‌ای (نه \n نه |) نیست — فقط یک فاصله.
   * چون عددها (تعداد/قیمت/مبلغ) فقط شامل رقم و کاما هستن، می‌تونیم با یک
   * regex سراسری، مرز هر عدد رو دقیق تشخیص بدیم و از همون‌جا اسمِ ردیف
   * بعدی رو شروع کنیم — بدون نیاز به هیچ جداکننده‌ی دیگه.
   */
  _parseFlowingPipeFormat(text) {
    const re = /([^|]+?)\|\s*([\d,،.]+)\s*\|\s*([\d,،.]+)\s*\|\s*([\d,،.]+)/g;
    const rows = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].replace(/\s{2,}/g, " ").trim();
      const qty = Number(m[2].replace(/[,،.]/g, ""));
      const unit = Number(m[3].replace(/[,،.]/g, ""));
      const total = Number(m[4].replace(/[,،.]/g, ""));
      if (!name || !Number.isFinite(qty) || !Number.isFinite(unit) || !Number.isFinite(total)) {
        continue;
      }
      rows.push({ name, quantity: qty, unitPrice: unit, totalPrice: total || qty * unit });
    }
    return rows;
  },

  /**
   * منطق مشترک برای تبدیل یک آرایه از «سلول‌ها» (چه از پاره کردن خط با |،
   * چه هر خط پیست‌شده) به ردیف‌های کالا. هر سلول یا عدد خالص هست، یا
   * علامت مزاحم (٪ • - و امثالش) که نادیده گرفته می‌شه، یا بخشی از اسم کالا.
   *
   * فاکتورهای مختلف، ترتیب متفاوتی موقع کپی با Live Text تولید می‌کنن: بعضی‌ها
   * اسم کالا رو قبل از عددها می‌ذارن، بعضی‌ها (مخصوصاً جدول‌های شبکه‌ای پرستون)
   * عددها رو قبل از اسم کالا. چون از قبل نمی‌دونیم کدومه، هر دو حالت رو امتحان
   * می‌کنیم و هر کدوم ردیف بیشتر و سالم‌تری داد، همون رو برمی‌گردونیم.
   */
  _extractRowsFromCells(rawCells) {
    const isSeparator = (c) => /^-+$/.test(c);
    // علامت‌های خالص جدول (٪، •، خط تیره و ...) که نه عددن نه بخشی از اسم
    const isNoiseSymbol = (c) => /^[%٪•·:><\-_.]+$/.test(c);
    const isHeaderWord = (c) => /^(نام کالا|مبلغ کل|بهای واحد|تعداد|بسته|ردیف|دیف)$/.test(c.trim());
    const isPureNumber = (c) => /^[\d,،.]+$/.test(c) && /\d/.test(c);
    const toNumber = (c) => Number(c.replace(/[,،.]/g, ""));

    const cells = rawCells.filter(
      (c) => c && !isSeparator(c) && !isNoiseSymbol(c) && !isHeaderWord(c)
    );

    // یک ردیف معمولاً حداکثر ۳ عدد داره (تعداد، قیمت واحد، مبلغ کل). اگه بیشتر
    // از ۳ عدد پشت‌سرهم جمع بشه، عددهای اضافیِ ابتداییِ اضافه معمولاً باقی‌مونده‌ی
    // یک ردیف ناقصِ قبلی هستن (که اسمش تو متن پیست‌شده نیومده) — پس فقط ۳ تای
    // آخر رو نگه می‌داریم.
    const finalizeRow = (rawName, numsFull) => {
      const name = String(rawName || "").replace(/\s{2,}/g, " ").trim();
      const nums = numsFull.slice(-3);
      if (!name || nums.length < 2) return null;

      let best = null;
      for (let i = 0; i < nums.length; i++) {
        for (let j = 0; j < nums.length; j++) {
          if (i === j) continue;
          for (let k = 0; k < nums.length; k++) {
            if (k === i || k === j) continue;
            const qty = nums[i], unit = nums[j], total = nums[k];
            if (qty <= 0 || unit <= 0 || total <= 0) continue;
            const diff = Math.abs(qty * unit - total) / total;
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

      return { name, quantity, unitPrice, totalPrice: totalPrice || quantity * unitPrice };
    };

    // حالت ۱: اسم کالا اول میاد، بعدش عددها (تا قبل از اسم کالای بعدی)
    const groupNameFirst = () => {
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
          const val = toNumber(cell);
          const looksLikeRowIndex =
            val > 0 && val < 1000 &&
            (expectedRowNum === null ? val < 200 : val === expectedRowNum + 1);
          if (looksLikeRowIndex) {
            expectedRowNum = val;
            continue;
          }
          currentNumbers.push(val);
        } else {
          if (currentNumbers.length >= 2) flushItem();
          currentNameParts.push(cell);
        }
      }
      flushItem();
      return items.map((item) => finalizeRow(item.name, item.numbers)).filter(Boolean);
    };

    // حالت ۲: عددها اول میان (تعداد/قیمت‌واحد/مبلغ‌کل)، بعدش اسم همون کالا
    const groupNumbersFirst = () => {
      const rows = [];
      let numberBuffer = [];
      for (const cell of cells) {
        if (isPureNumber(cell)) {
          numberBuffer.push(toNumber(cell));
        } else {
          if (numberBuffer.length >= 2) {
            const row = finalizeRow(cell, numberBuffer);
            if (row) rows.push(row);
          }
          numberBuffer = [];
        }
      }
      return rows;
    };

    const rowsNameFirst = groupNameFirst();
    const rowsNumbersFirst = groupNumbersFirst();
    // هر کدوم ردیف بیشتری تولید کرد، یعنی احتمالاً کالاها را کمتر با هم قاطی
    // کرده — همون رو انتخاب می‌کنیم.
    const rows = rowsNumbersFirst.length > rowsNameFirst.length ? rowsNumbersFirst : rowsNameFirst;

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
