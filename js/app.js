// =====================================================================
// منطق اصلی برنامه: ناوبری بین صفحات + هر صفحه یک ماژول کوچک مستقل
// =====================================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function formatToman(num) {
  const n = Math.round(Number(num) || 0);
  return n.toLocaleString("fa-IR") + " تومان";
}

function formatDateFa(isoDate) {
  if (!isoDate) return "—";
  try {
    return new Date(isoDate).toLocaleDateString("fa-IR", {
      year: "numeric", month: "long", day: "numeric",
    });
  } catch {
    return isoDate;
  }
}

function showToast(message, type = "") {
  const el = $("#toast");
  el.textContent = message;
  el.className = "toast" + (type ? " " + type : "");
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

function setLoading(isLoading, text = "در حال پردازش…") {
  $("#loading-text").textContent = text;
  $("#loading-overlay").hidden = !isLoading;
}

// ---------------------------------------------------------------------
// ناوبری بین صفحات
// ---------------------------------------------------------------------
const Router = {
  current: "home",
  go(pageName) {
    $$(".page").forEach((p) => { p.hidden = p.dataset.page !== pageName; });
    this.current = pageName;
    window.scrollTo(0, 0);
    if (pageName === "search") SearchPage.onEnter();
    if (pageName === "products") ProductsPage.onEnter();
    if (pageName === "invoices") InvoicesPage.onEnter();
    if (pageName === "capture") CapturePage.reset();
  },
};

document.addEventListener("click", (e) => {
  const navBtn = e.target.closest("[data-nav]");
  if (navBtn) Router.go(navBtn.dataset.nav);
});

// ---------------------------------------------------------------------
// صفحه ثبت فاکتور
// ---------------------------------------------------------------------
const CapturePage = {
  selectedFile: null,
  rows: [],

  init() {
    $("#btn-open-camera").addEventListener("click", () => $("#camera-input").click());
    $("#btn-open-gallery").addEventListener("click", () => $("#gallery-input").click());
    $("#camera-input").addEventListener("change", (e) => this.onFileChosen(e));
    $("#gallery-input").addEventListener("change", (e) => this.onFileChosen(e));
    $("#btn-process-ocr").addEventListener("click", () => this.processOcr());
    $("#btn-add-row").addEventListener("click", () => this.addRow());
    $("#btn-save-invoice").addEventListener("click", () => this.saveInvoice());
    $("#invoice-date-input").value = new Date().toISOString().slice(0, 10);
  },

  reset() {
    this.selectedFile = null;
    this.rows = [];
    $("#invoice-preview-img").hidden = true;
    $("#photo-placeholder").hidden = false;
    $("#btn-process-ocr").hidden = true;
    $("#capture-step-photo").hidden = false;
    $("#capture-step-review").hidden = true;
    $("#camera-input").value = "";
    $("#gallery-input").value = "";
    $("#invoice-date-input").value = new Date().toISOString().slice(0, 10);
    $("#invoice-supplier-input").value = "";
  },

  onFileChosen(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    this.selectedFile = file;
    const url = URL.createObjectURL(file);
    const img = $("#invoice-preview-img");
    img.src = url;
    img.hidden = false;
    $("#photo-placeholder").hidden = true;
    $("#btn-process-ocr").hidden = false;
  },

  async processOcr() {
    if (!this.selectedFile) return;
    setLoading(true, "در حال خواندن فاکتور…");
    try {
      const result = await OCR.extractInvoice(this.selectedFile);
      this.rows = result.rows.length
        ? result.rows
        : [{ name: "", quantity: 1, unitPrice: 0, totalPrice: 0 }];
      $("#invoice-date-input").value = result.invoiceDate || new Date().toISOString().slice(0, 10);
      $("#invoice-supplier-input").value = result.supplierName || "";
      this.renderRows();
      $("#capture-step-photo").hidden = true;
      $("#capture-step-review").hidden = false;
    } catch (err) {
      console.error(err);
      showToast("خطا در پردازش فاکتور. دستی وارد کن.", "error");
      this.rows = [{ name: "", quantity: 1, unitPrice: 0, totalPrice: 0 }];
      this.renderRows();
      $("#capture-step-photo").hidden = true;
      $("#capture-step-review").hidden = false;
    } finally {
      setLoading(false);
    }
  },

  addRow() {
    this.rows.push({ name: "", quantity: 1, unitPrice: 0, totalPrice: 0 });
    this.renderRows();
  },

  removeRow(index) {
    this.rows.splice(index, 1);
    this.renderRows();
  },
  updateRow(index, field, value) {
    const row = this.rows[index];
    row[field] = field === "name" ? value : Number(value) || 0;
    if (field === "quantity" || field === "unitPrice") {
      row.totalPrice = Math.round((Number(row.quantity) || 0) * (Number(row.unitPrice) || 0));
      const totalInput = document.querySelector(
        `#items-table [data-field="totalPrice"][data-index="${index}"]`
      );
      if (totalInput) totalInput.value = row.totalPrice;
    }
    this.updateTotal();
  },

  updateTotal() {
    const total = this.rows.reduce((s, r) => s + (Number(r.totalPrice) || 0), 0);
    $("#items-total").textContent = formatToman(total);
  },

  renderRows() {
    const container = $("#items-table");
    container.innerHTML = "";
    this.rows.forEach((row, i) => {
      const div = document.createElement("div");
      div.className = "item-row";
      div.innerHTML = `
        <div class="item-row-top">
          <input type="text" placeholder="نام کالا" value="${escapeHtml(row.name)}" data-field="name" data-index="${i}" />
          <button class="item-row-remove" data-remove="${i}" type="button">✕</button>
        </div>
        <div class="item-row-fields">
          <div>
            <label>تعداد</label>
            <input type="number" inputmode="decimal" value="${row.quantity}" data-field="quantity" data-index="${i}" />
          </div>
          <div>
            <label>قیمت واحد</label>
            <input type="number" inputmode="decimal" value="${row.unitPrice}" data-field="unitPrice" data-index="${i}" />
          </div>
          <div>
            <label>مبلغ کل</label>
            <input type="number" inputmode="decimal" value="${row.totalPrice}" data-field="totalPrice" data-index="${i}" />
          </div>
        </div>`;
      container.appendChild(div);
    });

    $$('[data-field]', container).forEach((input) => {
      input.addEventListener("input", (e) => {
        this.updateRow(Number(e.target.dataset.index), e.target.dataset.field, e.target.value);
      });
    });
    $$('[data-remove]', container).forEach((btn) => {
      btn.addEventListener("click", () => this.removeRow(Number(btn.dataset.remove)));
    });

    this.updateTotal();
  },

  async saveInvoice() {
    const validRows = this.rows.filter((r) => r.name.trim());
    if (!validRows.length) {
      showToast("حداقل یک کالا با نام معتبر وارد کن", "error");
      return;
    }
    setLoading(true, "در حال ذخیره فاکتور…");
    try {
      let imagePath = null;
      if (this.selectedFile) {
        imagePath = await DB.uploadInvoiceImage(this.selectedFile);
      }
      await DB.saveInvoice({
        invoiceDate: $("#invoice-date-input").value || new Date().toISOString().slice(0, 10),
        supplierName: $("#invoice-supplier-input").value.trim(),
        imagePath,
        rows: validRows,
      });
      showToast("فاکتور با موفقیت ذخیره شد ✅", "success");
      Router.go("home");
    } catch (err) {
      console.error(err);
      showToast("ذخیره فاکتور با خطا مواجه شد", "error");
    } finally {
      setLoading(false);
    }
  },
};

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------------------------------------------------------------------
// صفحه جستجوی کالا
// ---------------------------------------------------------------------
const SearchPage = {
  allProducts: [],
  loaded: false,

  onEnter() {
    $("#search-input").value = "";
    $("#search-results").innerHTML = "";
    $("#search-input").focus();
    if (!this.loaded) this.preload();
  },

  async preload() {
    try {
      this.allProducts = await DB.getAllProducts();
      this.loaded = true;
    } catch (err) {
      console.error(err);
    }
  },

  init() {
    let debounceTimer;
    $("#search-input").addEventListener("input", (e) => {
      clearTimeout(debounceTimer);
      const q = e.target.value;
      debounceTimer = setTimeout(() => this.runSearch(q), 180);
    });
  },

  async runSearch(query) {
    const box = $("#search-results");
    if (!query.trim()) { box.innerHTML = ""; return; }
    if (!this.loaded) await this.preload();

    const matches = SearchUtils.fuzzySearchProducts(query, this.allProducts);
    if (!matches.length) {
      box.innerHTML = `<div class="empty-state">چیزی پیدا نشد. اسم دیگه‌ای امتحان کن.</div>`;
      return;
    }

    box.innerHTML = "";
    for (const product of matches) {
      const card = document.createElement("div");
      card.className = "result-card";
      card.innerHTML = `
        <div class="result-card-title">${escapeHtml(product.name)}</div>
        <div class="result-card-meta"><span>در حال بارگذاری…</span></div>`;
      card.addEventListener("click", () => ProductDetail.open(product));
      box.appendChild(card);
      this.fillLastPrice(card, product.id);
    }
  },

  async fillLastPrice(card, productId) {
    try {
      const history = await DB.getProductHistory(productId);
      const meta = $(".result-card-meta", card);
      if (!history.length) {
        meta.innerHTML = `<span>هنوز خریدی ثبت نشده</span>`;
        return;
      }
      const last = history[0];
      meta.innerHTML = `
        <span>آخرین خرید: ${formatDateFa(last.purchase_date)} — ${history.length} بار خریداری‌شده</span>
        <span class="price-pill">${formatToman(last.unit_price)}</span>`;
    } catch (err) {
      console.error(err);
    }
  },
};

// ---------------------------------------------------------------------
// جزئیات یک کالا (مودال با سابقه قیمت)
// ---------------------------------------------------------------------
const ProductDetail = {
  async open(product) {
    const modal = $("#product-detail-modal");
    const body = $("#product-detail-body");
    body.innerHTML = `<p class="hint">در حال بارگذاری سابقه خرید…</p>`;
    modal.hidden = false;

    try {
      const history = await DB.getProductHistory(product.id);
      const last = history[0];
      body.innerHTML = `
        <h2>${escapeHtml(product.name)}</h2>
        ${last ? `
          <div class="total-bar">
            <span>آخرین قیمت خرید</span>
            <strong>${formatToman(last.unit_price)}</strong>
          </div>
          <p class="hint">آخرین خرید: ${formatDateFa(last.purchase_date)} — تعداد کل خریدها: ${history.length}</p>
        ` : `<div class="empty-state">هنوز سابقه خریدی برای این کالا ثبت نشده</div>`}
        ${history.length ? `
          <div class="history-list">
            ${history.map((h) => `
              <div class="history-row">
                <span>${formatDateFa(h.purchase_date)}${h.supplier_name ? " · " + escapeHtml(h.supplier_name) : ""}</span>
                <span class="h-price">${formatToman(h.unit_price)}</span>
              </div>`).join("")}
          </div>` : ""}
      `;
    } catch (err) {
      console.error(err);
      body.innerHTML = `<div class="empty-state">خطا در بارگذاری اطلاعات</div>`;
    }
  },
};

// ---------------------------------------------------------------------
// صفحه کالاهای ثبت‌شده
// ---------------------------------------------------------------------
const ProductsPage = {
  all: [],

  init() {
    $("#products-filter-input").addEventListener("input", () => this.render());
    $("#products-sort-select").addEventListener("change", () => this.render());
  },

  async onEnter() {
    $("#products-list").innerHTML = `<div class="empty-state">در حال بارگذاری…</div>`;
    try {
      this.all = await DB.getProductsWithLastPrice();
      $("#products-filter-input").value = "";
      this.render();
    } catch (err) {
      console.error(err);
      $("#products-list").innerHTML = `<div class="empty-state">خطا در بارگذاری کالاها</div>`;
    }
  },

  render() {
    const filterVal = $("#products-filter-input").value.trim();
    const sortVal = $("#products-sort-select").value;
    let list = this.all;

    if (filterVal) {
      list = SearchUtils.fuzzySearchProducts(filterVal, this.all, { minScore: 0.4, limit: 200 });
    }

    list = [...list].sort((a, b) => {
      if (sortVal === "name") return a.name.localeCompare(b.name, "fa");
      if (sortVal === "price") return (b.lastPrice ?? 0) - (a.lastPrice ?? 0);
      if (sortVal === "date") return new Date(b.lastDate ?? 0) - new Date(a.lastDate ?? 0);
      return 0;
    });

    const box = $("#products-list");
    if (!list.length) {
      box.innerHTML = `<div class="empty-state">هنوز کالایی ثبت نشده</div>`;
      return;
    }

    box.innerHTML = list.map((p) => `
      <div class="result-card" data-product-id="${p.id}">
        <div class="result-card-title">${escapeHtml(p.name)}</div>
        <div class="result-card-meta">
          <span>${p.lastDate ? "آخرین خرید: " + formatDateFa(p.lastDate) : "بدون سابقه خرید"}</span>
          ${p.lastPrice != null ? `<span class="price-pill">${formatToman(p.lastPrice)}</span>` : ""}
        </div>
      </div>
    `).join("");

    $$(".result-card", box).forEach((card) => {
      card.addEventListener("click", () => {
        const product = list.find((p) => p.id === card.dataset.productId);
        if (product) ProductDetail.open(product);
      });
    });
  },
};

// ---------------------------------------------------------------------
// صفحه فاکتورهای قبلی
// ---------------------------------------------------------------------
const InvoicesPage = {
  async onEnter() {
    const box = $("#invoices-list");
    box.innerHTML = `<div class="empty-state">در حال بارگذاری…</div>`;
    try {
      const invoices = await DB.getAllInvoices();
      if (!invoices.length) {
        box.innerHTML = `<div class="empty-state">هنوز فاکتوری ثبت نشده</div>`;
        return;
      }
      box.innerHTML = invoices.map((inv) => `
        <div class="invoice-card" data-invoice-id="${inv.id}">
          <div class="invoice-card-thumb-wrap" data-thumb="${inv.id}"></div>
          <div class="invoice-card-info">
            <div class="i-date">${formatDateFa(inv.invoice_date)}</div>
            <div class="i-supplier">${inv.supplier_name ? escapeHtml(inv.supplier_name) : "بدون نام فروشنده"}</div>
            <div class="i-meta">
              <span>${inv.items_count ?? 0} قلم کالا</span>
              <span class="i-total">${formatToman(inv.total_amount)}</span>
            </div>
          </div>
        </div>
      `).join("");

      $$(".invoice-card", box).forEach((card) => {
        card.addEventListener("click", () => InvoiceDetail.open(card.dataset.invoiceId));
      });

      for (const inv of invoices) {
        if (!inv.image_path) continue;
        DB.getInvoiceImageUrl(inv.image_path).then((url) => {
          if (!url) return;
          const wrap = box.querySelector(`[data-thumb="${inv.id}"]`);
          if (wrap) wrap.innerHTML = `<img class="invoice-card-thumb" src="${url}" alt="" />`;
        });
      }
    } catch (err) {
      console.error(err);
      box.innerHTML = `<div class="empty-state">خطا در بارگذاری فاکتورها</div>`;
    }
  },
};

const InvoiceDetail = {
  async open(invoiceId) {
    const modal = $("#invoice-detail-modal");
    const body = $("#invoice-detail-body");
    body.innerHTML = `<p class="hint">در حال بارگذاری…</p>`;
    modal.hidden = false;

    try {
      const { invoice, items } = await DB.getInvoiceWithItems(invoiceId);
      let imgHtml = "";
      if (invoice.image_path) {
        const url = await DB.getInvoiceImageUrl(invoice.image_path);
        if (url) imgHtml = `<img class="modal-img" src="${url}" alt="عکس فاکتور" />`;
      }
      body.innerHTML = `
        ${imgHtml}
        <h2>${formatDateFa(invoice.invoice_date)}</h2>
        <p class="hint">${invoice.supplier_name ? escapeHtml(invoice.supplier_name) : "بدون نام فروشنده"}</p>
        <div class="history-list">
          ${items.map((it) => `
            <div class="history-row">
              <span>${escapeHtml(it.products?.name ?? "—")} × ${it.quantity}</span>
              <span class="h-price">${formatToman(it.total_price)}</span>
            </div>`).join("")}
        </div>
        <div class="total-bar">
          <span>جمع کل فاکتور</span>
          <strong>${formatToman(invoice.total_amount)}</strong>
        </div>
      `;
    } catch (err) {
      console.error(err);
      body.innerHTML = `<div class="empty-state">خطا در بارگذاری فاکتور</div>`;
    }
  },
};

// ---------------------------------------------------------------------
// راه‌اندازی
// ---------------------------------------------------------------------
function initModals() {
  $("#btn-close-invoice-modal").addEventListener("click", () => { $("#invoice-detail-modal").hidden = true; });
  $("#btn-close-product-modal").addEventListener("click", () => { $("#product-detail-modal").hidden = true; });
  $("#invoice-detail-modal").addEventListener("click", (e) => { if (e.target.id === "invoice-detail-modal") e.target.hidden = true; });
  $("#product-detail-modal").addEventListener("click", (e) => { if (e.target.id === "product-detail-modal") e.target.hidden = true; });
}

document.addEventListener("DOMContentLoaded", () => {
  CapturePage.init();
  SearchPage.init();
  ProductsPage.init();
  initModals();
  Router.go("home");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  }
});
