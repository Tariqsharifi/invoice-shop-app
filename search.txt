// =====================================================================
// نرمال‌سازی متن فارسی و جستجوی فازی (نه فقط تطابق دقیق)
// =====================================================================

/**
 * یک رشته فارسی/عربی را برای مقایسه یکسان می‌کند:
 * - ی عربی → ی فارسی ، ك عربی → ک فارسی
 * - حذف اعراب و کشیده (ـ)
 * - همه ارقام عربی/فارسی → ارقام لاتین (برای مقایسه اعداد داخل نام کالا)
 * - چند فاصله پشت‌سرهم → یک فاصله ، حذف فاصله ابتدا/انتها
 * - حذف علائم نگارشی رایج
 */
function normalizePersian(str) {
  if (!str) return "";
  let s = String(str);

  s = s.replace(/[يى]/g, "ی").replace(/ك/g, "ک");
  s = s.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, ""); // اعراب
  s = s.replace(/ـ+/g, ""); // کشیده

  const digitMap = {
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  };
  s = s.replace(/[۰-۹٠-٩]/g, (d) => digitMap[d] ?? d);

  s = s.replace(/[.,،؛;:!؟?()«»"']/g, " ");
  s = s.replace(/\s+/g, " ").trim().toLowerCase();

  return s;
}

/** تبدیل رشته نرمال‌شده به آرایه‌ای از کلمات، برای مقایسه توکن‌به‌توکن */
function tokenize(normalized) {
  return normalized.split(" ").filter(Boolean);
}

/** فاصله ویرایشی (Levenshtein) بین دو رشته کوتاه (نام کالا/کلمه) */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = tmp;
    }
  }
  return dp[n];
}

/** شباهت دو کلمه بین 0 و 1 (1 یعنی کاملاً یکسان) بر پایه فاصله ویرایشی */
function wordSimilarity(a, b) {
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - dist / maxLen;
}

/**
 * امتیاز شباهت بین عبارت جستجو و نام یک کالا (0 تا 1).
 * منطق: هر کلمه‌ی جستجو باید حداقل یک کلمه‌ی نزدیک در نام کالا پیدا کند
 * (تطابق دقیق یا حداکثر ۱-۲ حرف اختلاف تایپی)، به‌علاوه تطابق زیررشته‌ای ساده.
 */
function fuzzyScore(query, productName) {
  const nq = normalizePersian(query);
  const np = normalizePersian(productName);
  if (!nq) return 0;

  // تطابق مستقیم زیررشته‌ای -> امتیاز بالا
  if (np.includes(nq)) return 0.95;

  const qTokens = tokenize(nq);
  const pTokens = tokenize(np);
  if (qTokens.length === 0 || pTokens.length === 0) return 0;

  let totalScore = 0;
  for (const qt of qTokens) {
    let best = 0;
    for (const pt of pTokens) {
      if (pt.includes(qt) || qt.includes(pt)) {
        best = Math.max(best, 0.9);
        continue;
      }
      const sim = wordSimilarity(qt, pt);
      // برای کلمات کوتاه (مثل اعداد یا واحد)، آستانه سخت‌گیرتر
      const threshold = qt.length <= 3 ? 0.75 : 0.55;
      if (sim >= threshold) best = Math.max(best, sim);
    }
    totalScore += best;
  }

  return totalScore / qTokens.length;
}

/**
 * فهرست کالاها را بر اساس شباهت به عبارت جستجو مرتب و فیلتر می‌کند.
 * products: [{id, name, ...}]
 * برمی‌گرداند: [{...product, score}] مرتب‌شده نزولی، فقط موارد بالاتر از حد آستانه
 */
function fuzzySearchProducts(query, products, { minScore = 0.45, limit = 30 } = {}) {
  if (!query || !query.trim()) return [];
  const scored = products
    .map((p) => ({ ...p, score: fuzzyScore(query, p.name) }))
    .filter((p) => p.score >= minScore)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * برای جلوگیری از ساخت کالای تکراری هنگام ذخیره فاکتور: نزدیک‌ترین
 * کالای موجود را پیدا می‌کند. اگر شباهت بالای آستانه بود همان را برگردان،
 * وگرنه null یعنی باید کالای جدید ساخته شود.
 */
function findMatchingProduct(name, existingProducts, threshold = 0.82) {
  let best = null;
  let bestScore = 0;
  for (const p of existingProducts) {
    const score = fuzzyScore(name, p.name);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= threshold ? best : null;
}

window.SearchUtils = {
  normalizePersian,
  fuzzyScore,
  fuzzySearchProducts,
  findMatchingProduct,
};
