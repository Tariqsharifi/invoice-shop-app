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

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------------------------------------------------------------------
// نمایش تمام‌صفحه‌ی عکس فاکتور با قابلیت زوم و جابه‌جایی با انگشت
// (چون زوم کل صفحه تو manifest غیرفعاله، این مخصوص خود عکسه)
// ---------------------------------------------------------------------
const PhotoZoom = {
  scale: 1,
  panX: 0,
  panY: 0,
  startDist: 0,
  startScale: 1,
  lastTapTime: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,

  init() {
    $("#btn-close-photo-zoom").addEventListener("click", () => this.close());
    const viewport = $("#photo-zoom-viewport");
    viewport.addEventListener("touchstart", (e) => this.onTouchStart(e), { passive: false });
    viewport.addEventListener("touchmove", (e) => this.onTouchMove(e), { passive: false });
    viewport.addEventListener("touchend", (e) => this.onTouchEnd(e), { passive: false });
  },

  open(src) {
    if (!src) return;
    const img = $("#photo-zoom-img");
    img.src = src;
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.apply();
    $("#photo-zoom-modal").hidden = false;
  },

  close() {
    $("#photo-zoom-modal").hidden = true;
  },

  apply() {
    $("#photo-zoom-img").style.transform =
      `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
  },

  dist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  },

  onTouchStart(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      this.startDist = this.dist(e.touches);
      this.startScale = this.scale;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - this.lastTapTime < 300) {
        this.scale = this.scale > 1 ? 1 : 2.5;
        this.panX = 0;
        this.panY = 0;
        this.apply();
      }
      this.lastTapTime = now;
      this.dragging = true;
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
    }
  },

  onTouchMove(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const newDist = this.dist(e.touches);
      if (this.startDist > 0) {
        this.scale = Math.min(5, Math.max(1, this.startScale * (newDist / this.startDist)));
        this.apply();
      }
    } else if (e.touches.length === 1 && this.dragging && this.scale > 1) {
      e.preventDefault();
      const dx = e.touches[0].clientX - this.lastX;
      const dy = e.touches[0].clientY - this.lastY;
      this.panX += dx;
      this.panY += dy;
      this.lastX = e.touches[0].clientX;
      this.lastY = e.touches[0].clientY;
      this.apply();
    }
  },

  onTouchEnd(e) {
    if (e.touches.length === 0) this.dragging = false;
  },
};

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
    $("#btn-process-paste").addEventListener("click", () => this.processPastedText());
    $("#btn-add-row").addEventListener("click", () => this.addRow());
    $("#btn-save-invoice").addEventListener("click", () => this.saveInvoice());
    $("#invoice-date-input").value = new Date().toISOString().slice(0, 10);
    $("#review-photo-img").addEventListener("click", () => {
      PhotoZoom.open($("#review-photo-img").src);
    });
    $("#invoice-expected-total-input").addEventListener("input", () => {
      const total = this.rows.reduce((s, r) => s + (Number(r.totalPrice) || 0), 0);
      this.updateTotalCheck(total);
    });
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
    $("#paste-text-input").value = "";
    $("#invoice-date-input").value = new Date().toISOString().slice(0, 10);
    $("#invoice-supplier-input").value = "";
    $("#review-photo-wrap").hidden = true;
    $("#review-photo-img").src = "";
    $("#invoice-expected-total-input").value = "";
    $("#total-check-badge").hidden = true;
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
    $("#review-photo-img").src = url;
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
      $("#review-photo-wrap").hidden = !this.selectedFile;
      this.renderRows();
      $("#capture-step-photo").hidden = true;
      $("#capture-step-review").hidden = false;
    } catch (err) {
      console.error(err);
      showToast("خطا در پردازش فاکتور. دستی وارد کن.", "error");
      this.rows = [{ name: "", quantity: 1, unitPrice: 0, totalPrice: 0 }];
      $("#review-photo-wrap").hidden = !this.selectedFile;
      this.renderRows();
      $("#capture-step-photo").hidden = true;
      $("#capture-step-review").hidden = false;
    } finally {
      setLoading(false);
    }
  },

  processPastedText() {
    const text = $("#paste-text-input").value;
    if (!text.trim()) {
      showToast("اول متن رو پیست کن", "error");
      return;
    }
    const parsedRows = OCR.parsePastedText(text);
    this.rows = parsedRows.length
      ? parsedRows
      : [{ name: "", quantity: 1, unitPrice: 0, totalPrice: 0 }];
    $("#review-photo-wrap").hidden = !this.selectedFile;
    this.renderRows();
    $("#capture-step-photo").hidden = true;
    $("#capture-step-review").hidden = false;
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
    this.updateTotalCheck(total);
  },

  updateTotalCheck(computedTotal) {
    const expectedRaw = $("#invoice-expected-total-input").value;
    const badge = $("#total-check-badge");
    if (!expectedRaw) {
      badge.hidden = true;
      return;
    }
    const expected = Number(expectedRaw) || 0;
    if (!expected) {
      badge.hidden = true;
      return;
    }
    const diff = Math.abs(computedTotal - expected);
    const ok = diff <= 1;
    badge.hidden = false;
    badge.style.color = ok ? "#1b7a3d" : "#b91c1c";
    badge.textContent = ok
      ? "✅ جمع با فاکتور کاغذی مطابقت داره"
      : `⚠️ اختلاف با فاکتور کاغذی: ${formatToman(diff)} — یه ردیف رو دوباره چک کن`;
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
      showToast("خطا: " + (err?.message || JSON.stringify(err)), "error");
    } finally {
      setLoading(false);
    }
  },
};

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
                <span class="hr-name">${formatDateFa(h.purchase_date)}${h.supplier_name ? " · " + escapeHtml(h.supplier_name) : ""}</span>
                <span class="h-price">${formatToman(h.unit_price)}</span>
              </div>`).join("")}
          </div>` : ""}
        <button class="btn btn-danger btn-full" id="btn-delete-product" style="margin-top:14px;">🗑 حذف این کالا</button>
      `;
      $("#btn-delete-product").addEventListener("click", async () => {
        if (!confirm("مطمئنی می‌خوای این کالا و کل سابقه خریدش حذف بشه؟")) return;
        setLoading(true, "در حال حذف…");
        try {
          await DB.deleteProduct(product.id);
          $("#product-detail-modal").hidden = true;
          showToast("کالا حذف شد", "success");
          if (Router.current === "products") ProductsPage.onEnter();
          if (Router.current === "search") SearchPage.runSearch($("#search-input").value);
        } catch (err) {
          console.error(err);
          showToast("خطا در حذف کالا", "error");
        } finally {
          setLoading(false);
        }
      });
    } catch (err) {
      console.error(err);
      body.innerHTML = `<div class="empty-state">خطا در بارگذاری اطلاعات</div>`;
    }
  },
};

// ---------------------------------------------------------------------
// صفحه کالاهای ثبت‌شده — با حالت انتخاب چندتایی برای حذف گروهی
// ---------------------------------------------------------------------
const ProductsPage = {
  all: [],
  currentVisible: [],
  selectionMode: false,
  selectedIds: new Set(),

  init() {
    $("#products-filter-input").addEventListener("input", () => this.render());
    $("#products-sort-select").addEventListener("change", () => this.render());
    $("#btn-toggle-select-mode").addEventListener("click", () => this.toggleSelectionMode());
    $("#btn-select-all-products").addEventListener("click", () => this.toggleSelectAll());
    $("#btn-delete-selected-products").addEventListener("click", () => this.deleteSelected());
  },

  async onEnter() {
    this.selectionMode = false;
    this.selectedIds.clear();
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

  toggleSelectionMode() {
    this.selectionMode = !this.selectionMode;
    if (!this.selectionMode) this.selectedIds.clear();
    this.render();
  },

  toggleSelectAll() {
    const visibleIds = this.currentVisible.map((p) => p.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => this.selectedIds.has(id));
    if (allSelected) {
      visibleIds.forEach((id) => this.selectedIds.delete(id));
    } else {
      visibleIds.forEach((id) => this.selectedIds.add(id));
    }
    this.render();
  },

  async deleteSelected() {
    const count = this.selectedIds.size;
    if (!count) return;
    if (!confirm(`مطمئنی می‌خوای ${count} کالای انتخاب‌شده و کل سابقه خریدشون حذف بشه؟`)) return;

    setLoading(true, "در حال حذف…");
    try {
      await DB.deleteProducts([...this.selectedIds]);
      showToast(`${count} کالا حذف شد`, "success");
      this.selectionMode = false;
      this.selectedIds.clear();
      await this.onEnter();
    } catch (err) {
      console.error(err);
      showToast("خطا در حذف کالاها", "error");
    } finally {
      setLoading(false);
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

    this.currentVisible = list;

    const toggleBtn = $("#btn-toggle-select-mode");
    toggleBtn.textContent = this.selectionMode ? "✕ لغو انتخاب" : "✔️ انتخاب";

    const bar = $("#products-selection-bar");
    bar.hidden = !this.selectionMode;
    $("#selected-products-count").textContent = this.selectedIds.size;

    const visibleIds = list.map((p) => p.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => this.selectedIds.has(id));
    $("#btn-select-all-products").textContent = allSelected ? "لغو انتخاب همه" : "انتخاب همه";

    const box = $("#products-list");
    if (!list.length) {
      box.innerHTML = `<div class="empty-state">هنوز کالایی ثبت نشده</div>`;
      return;
    }

    box.innerHTML = list.map((p) => {
      const selected = this.selectedIds.has(p.id);
      return `
      <div class="result-card ${this.selectionMode ? "result-card-selectable" : ""} ${selected ? "result-card-selected" : ""}" data-product-id="${p.id}">
        ${this.selectionMode ? `<span class="select-checkbox ${selected ? "checked" : ""}"></span>` : ""}
        <div class="result-card-body">
          <div class="result-card-title">${escapeHtml(p.name)}</div>
          <div class="result-card-meta">
            <span>${p.lastDate ? "آخرین خرید: " + formatDateFa(p.lastDate) : "بدون سابقه خرید"}</span>
            ${p.lastPrice != null ? `<span class="price-pill">${formatToman(p.lastPrice)}</span>` : ""}
          </div>
        </div>
      </div>
    `;
    }).join("");

    $$(".result-card", box).forEach((card) => {
      card.addEventListener("click", () => {
        const id = card.dataset.productId;
        if (this.selectionMode) {
          if (this.selectedIds.has(id)) this.selectedIds.delete(id);
          else this.selectedIds.add(id);
          this.render();
          return;
        }
        const product = list.find((p) => p.id === id);
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
          <button class="icon-btn icon-btn-danger invoice-card-delete" data-delete-invoice="${inv.id}" type="button" aria-label="حذف فاکتور">🗑</button>
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

      $$("[data-delete-invoice]", box).forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const invoiceId = btn.dataset.deleteInvoice;
          if (!confirm("مطمئنی می‌خوای این فاکتور حذف بشه؟ این کار قابل بازگشت نیست.")) return;
          setLoading(true, "در حال حذف…");
          try {
            await DB.deleteInvoice(invoiceId);
            showToast("فاکتور حذف شد", "success");
            InvoicesPage.onEnter();
          } catch (err) {
            console.error(err);
            showToast("خطا در حذف فاکتور", "error");
          } finally {
            setLoading(false);
          }
        });
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

// ---------------------------------------------------------------------
// جزئیات یک فاکتور — با امکان ویرایش/حذف تک‌تک اقلام داخلش
// ---------------------------------------------------------------------
const InvoiceDetail = {
  currentItems: [],

  async open(invoiceId) {
    const modal = $("#invoice-detail-modal");
    const body = $("#invoice-detail-body");
    body.innerHTML = `<p class="hint">در حال بارگذاری…</p>`;
    modal.hidden = false;

    try {
      const { invoice, items } = await DB.getInvoiceWithItems(invoiceId);
      this.currentItems = items;

      let imgHtml = "";
      if (invoice.image_path) {
        const url = await DB.getInvoiceImageUrl(invoice.image_path);
        if (url) imgHtml = `<img class="modal-img" src="${url}" alt="عکس فاکتور" />`;
      }

      body.innerHTML = `
        ${imgHtml}
        <h2>${formatDateFa(invoice.invoice_date)}</h2>
        <p class="hint">${invoice.supplier_name ? escapeHtml(invoice.supplier_name) : "بدون نام فروشنده"}</p>
        <div class="history-list" id="invoice-items-list">
          ${items.length ? items.map((it) => this.renderItemRow(it)).join("") : `<div class="empty-state">دیگه قلمی تو این فاکتور نیست</div>`}
        </div>
        <div class="total-bar">
          <span>جمع کل فاکتور</span>
          <strong>${formatToman(invoice.total_amount)}</strong>
        </div>
        <button class="btn btn-danger btn-full" id="btn-delete-invoice" style="margin-top:14px;">🗑 حذف کل فاکتور</button>
      `;

      this.attachItemHandlers(invoiceId);

      $("#btn-delete-invoice").addEventListener("click", async () => {
        if (!confirm("مطمئنی می‌خوای این فاکتور حذف بشه؟ این کار قابل بازگشت نیست.")) return;
        setLoading(true, "در حال حذف…");
        try {
          await DB.deleteInvoice(invoiceId);
          $("#invoice-detail-modal").hidden = true;
          showToast("فاکتور حذف شد", "success");
          InvoicesPage.onEnter();
        } catch (err) {
          console.error(err);
          showToast("خطا در حذف فاکتور", "error");
        } finally {
          setLoading(false);
        }
      });
    } catch (err) {
      console.error(err);
      body.innerHTML = `<div class="empty-state">خطا در بارگذاری فاکتور</div>`;
    }
  },

  renderItemRow(it) {
    return `
      <div class="history-row" data-purchase-id="${it.id}">
        <span class="hr-name">${escapeHtml(it.products?.name ?? "—")} × ${it.quantity}</span>
        <span class="h-price">${formatToman(it.total_price)}</span>
        <span class="hr-actions">
          <button class="icon-btn" data-edit-item="${it.id}" type="button" aria-label="ویرایش">✏️</button>
          <button class="icon-btn icon-btn-danger" data-delete-item="${it.id}" type="button" aria-label="حذف">🗑</button>
        </span>
      </div>`;
  },

  attachItemHandlers(invoiceId) {
    const list = $("#invoice-items-list");
    if (!list) return;
    $$('[data-edit-item]', list).forEach((btn) => {
      btn.addEventListener("click", () => this.openEditItem(btn.dataset.editItem, invoiceId));
    });
    $$('[data-delete-item]', list).forEach((btn) => {
      btn.addEventListener("click", () => this.deleteItem(btn.dataset.deleteItem, invoiceId));
    });
  },

  openEditItem(purchaseId, invoiceId) {
    const row = document.querySelector(`.history-row[data-purchase-id="${purchaseId}"]`);
    const item = this.currentItems.find((i) => String(i.id) === String(purchaseId));
    if (!row || !item) return;

    row.innerHTML = `
      <div class="item-edit-form">
        <div class="item-edit-field">
          <label>تعداد</label>
          <input type="number" inputmode="decimal" class="edit-qty" value="${item.quantity}" />
        </div>
        <div class="item-edit-field">
          <label>قیمت واحد</label>
          <input type="number" inputmode="decimal" class="edit-price" value="${item.unit_price}" />
        </div>
        <div class="item-edit-btns">
          <button class="btn btn-primary edit-save" type="button">ذخیره</button>
          <button class="btn btn-secondary edit-cancel" type="button">انصراف</button>
        </div>
      </div>`;

    row.querySelector(".edit-save").addEventListener("click", () => this.saveItem(purchaseId, invoiceId));
    row.querySelector(".edit-cancel").addEventListener("click", () => this.open(invoiceId));
  },

  async saveItem(purchaseId, invoiceId) {
    const row = document.querySelector(`.history-row[data-purchase-id="${purchaseId}"]`);
    if (!row) return;
    const qty = row.querySelector(".edit-qty").value;
    const price = row.querySelector(".edit-price").value;

    setLoading(true, "در حال ذخیره…");
    try {
      await DB.updatePurchaseItem(purchaseId, invoiceId, { quantity: qty, unitPrice: price });
      showToast("ویرایش شد ✅", "success");
      await this.open(invoiceId);
      InvoicesPage.onEnter();
    } catch (err) {
      console.error(err);
      showToast("خطا در ذخیره", "error");
    } finally {
      setLoading(false);
    }
  },

  async deleteItem(purchaseId, invoiceId) {
    if (!confirm("این قلم از فاکتور حذف بشه؟")) return;
    setLoading(true, "در حال حذف…");
    try {
      await DB.deletePurchaseItem(purchaseId, invoiceId);
      showToast("قلم حذف شد", "success");
      await this.open(invoiceId);
      InvoicesPage.onEnter();
    } catch (err) {
      console.error(err);
      showToast("خطا در حذف", "error");
    } finally {
      setLoading(false);
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
  PhotoZoom.init();
  initModals();
  Router.go("home");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  }
});
