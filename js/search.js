// =====================================================================
// نرمال‌سازی متن فارسی و جستجوی فازی (نه فقط تطابق دقیق)
// =====================================================================

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

function tokenize(normalized) {
  return normalized.split(" ").filter(Boolean);
}

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

function wordSimilarity(a, b) {
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - dist / maxLen;
}

function fuzzyScore(query, productName) {
  const nq = normalizePersian(query);
  const np = normalizePersian(productName);
  if (!nq) return 0;

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
      const threshold = qt.length <= 3 ? 0.75 : 0.55;
      if (sim >= threshold) best = Math.max(best, sim);
    }
    totalScore += best;
  }

  return totalScore / qTokens.length;
}

function fuzzySearchProducts(query, products, { minScore = 0.45, limit = 30 } = {}) {
  if (!query || !query.trim()) return [];
  const scored = products
    .map((p) => ({ ...p, score: fuzzyScore(query, p.name) }))
    .filter((p) => p.score >= minScore)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

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
