// =====================================================================
// لایه دسترسی به دیتابیس (Supabase). تمام کوئری‌های برنامه از اینجا رد می‌شود
// تا اگر بعداً دیتابیس یا ساختار عوض شد، فقط همین فایل تغییر کند.
// =====================================================================

const { createClient } = supabase; // از CDN بارگذاری شده (index.html)

const client = createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_ANON_KEY
);
window.DB_CLIENT = client; // برای ماژول‌های دیگر (مثل ocr.js) که به functions.invoke نیاز دارند

const DB = {
  // ---------------------------------------------------------------
  // محصولات
  // ---------------------------------------------------------------
  async getAllProducts() {
    const { data, error } = await client
      .from("products")
      .select("id, name, normalized_name, created_at")
      .order("name", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async createProduct(name) {
    const { data, error } = await client
      .from("products")
      .insert({ name, normalized_name: SearchUtils.normalizePersian(name) })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** ویرایش نام یک محصول (مثلاً برای اصلاح غلط املایی) — روی همه فاکتورهایی که این کالا در آن‌ها هست اثر می‌گذارد.
   *  فقط برای وقتی استفاده شود که مطمئنی این محصول در هیچ فاکتور دیگری با معنای متفاوت استفاده نشده. */
  async updateProductName(productId, name) {
    const trimmed = (name || "").trim();
    if (!trimmed) throw new Error("نام کالا نمی‌تواند خالی باشد");
    const { error } = await client
      .from("products")
      .update({ name: trimmed, normalized_name: SearchUtils.normalizePersian(trimmed) })
      .eq("id", productId);
    if (error) throw error;
  },

  /**
   * ویرایش نام کالا از داخل یک ردیف خرید مشخص، بدون اثر روی بقیه ردیف‌هایی که
   * به همین محصول وصل بودند (مثلاً وقتی دو کالای متفاوت اشتباهی یکی شده‌اند).
   * دنبال محصولی با همین نام دقیق می‌گردد؛ اگر نبود، محصول جدید می‌سازد،
   * و فقط همین ردیف خرید را به آن وصل می‌کند.
   */
  async setPurchaseItemProductName(purchaseId, name) {
    const trimmed = (name || "").trim();
    if (!trimmed) throw new Error("نام کالا نمی‌تواند خالی باشد");
    const normalized = SearchUtils.normalizePersian(trimmed);

    const { data: existing, error: findErr } = await client
      .from("products")
      .select("id, name")
      .eq("normalized_name", normalized)
      .maybeSingle();
    if (findErr) throw findErr;

    let productId = existing?.id;
    if (!productId) {
      const created = await this.createProduct(trimmed);
      productId = created.id;
    }

    const { error } = await client
      .from("purchases")
      .update({ product_id: productId })
      .eq("id", purchaseId);
    if (error) throw error;

    return productId;
  },

  /** آخرین قیمت + کل سابقه خرید یک کالا */
  async getProductHistory(productId) {
    const { data, error } = await client
      .from("purchases")
      .select("id, unit_price, quantity, total_price, purchase_date, supplier_name, invoice_id")
      .eq("product_id", productId)
      .order("purchase_date", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  /** برای صفحه «کالاهای ثبت‌شده»: هر کالا + آخرین قیمتش در یک کوئری */
  async getProductsWithLastPrice() {
    const products = await this.getAllProducts();
    const { data: purchases, error } = await client
      .from("purchases")
      .select("product_id, unit_price, purchase_date")
      .order("purchase_date", { ascending: false });
    if (error) throw error;

    const lastByProduct = new Map();
    for (const row of purchases ?? []) {
      if (!lastByProduct.has(row.product_id)) {
        lastByProduct.set(row.product_id, row);
      }
    }
    return products.map((p) => ({
      ...p,
      lastPrice: lastByProduct.get(p.id)?.unit_price ?? null,
      lastDate: lastByProduct.get(p.id)?.purchase_date ?? null,
    }));
  },

  // ---------------------------------------------------------------
  // فاکتورها
  // ---------------------------------------------------------------
  async getAllInvoices() {
    const { data, error } = await client
      .from("invoices")
      .select("id, invoice_date, supplier_name, image_path, total_amount, items_count, created_at")
      .order("invoice_date", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async getInvoiceWithItems(invoiceId) {
    const { data: invoice, error: invErr } = await client
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();
    if (invErr) throw invErr;

    const { data: items, error: itemsErr } = await client
      .from("purchases")
      .select("id, product_id, quantity, unit_price, total_price, products(id, name)")
      .eq("invoice_id", invoiceId);
    if (itemsErr) throw itemsErr;

    return { invoice, items: items ?? [] };
  },

  /** ویرایش نام فروشنده یک فاکتور */
  async updateInvoiceSupplier(invoiceId, supplierName) {
    const { error } = await client
      .from("invoices")
      .update({ supplier_name: (supplierName || "").trim() || null })
      .eq("id", invoiceId);
    if (error) throw error;
  },

  /**
   * ذخیره نهایی فاکتور تایید‌شده: خود فاکتور + همه ردیف‌های خرید.
   * برای هر ردیف، اول دنبال کالای مشابه می‌گردد، اگر نبود کالای جدید می‌سازد.
   * rows: [{ name, quantity, unitPrice, totalPrice }]
   */
  async saveInvoice({ invoiceDate, supplierName, imagePath, rows }) {
    const totalAmount = rows.reduce((sum, r) => sum + (Number(r.totalPrice) || 0), 0);

    const { data: invoice, error: invErr } = await client
      .from("invoices")
      .insert({
        invoice_date: invoiceDate,
        supplier_name: supplierName || null,
        image_path: imagePath || null,
        total_amount: totalAmount,
        items_count: rows.length,
      })
      .select()
      .single();
    if (invErr) throw invErr;

    const existingProducts = await this.getAllProducts();
    const purchaseRows = [];

    for (const row of rows) {
      let product = SearchUtils.findMatchingProduct(row.name, existingProducts);
      if (!product) {
        product = await this.createProduct(row.name);
        existingProducts.push(product); // تا در همین حلقه هم به‌عنوان تکراری شناخته بشه
      }
      purchaseRows.push({
        product_id: product.id,
        invoice_id: invoice.id,
        unit_price: Number(row.unitPrice) || 0,
        quantity: Number(row.quantity) || 0,
        total_price: Number(row.totalPrice) || 0,
        purchase_date: invoiceDate,
        supplier_name: supplierName || null,
      });
    }

    if (purchaseRows.length) {
      const { error: purErr } = await client.from("purchases").insert(purchaseRows);
      if (purErr) throw purErr;
    }

    return invoice;
  },

  /**
   * بعد از هر ویرایش/حذفِ یک قلم داخل فاکتور، جمع کل و تعداد اقلام
   * فاکتور را دوباره از روی ردیف‌های باقی‌مانده محاسبه و ذخیره می‌کند.
   */
  async recalcInvoiceTotals(invoiceId) {
    const { data: items, error } = await client
      .from("purchases")
      .select("total_price")
      .eq("invoice_id", invoiceId);
    if (error) throw error;

    const total = (items ?? []).reduce((s, r) => s + (Number(r.total_price) || 0), 0);
    const { error: updErr } = await client
      .from("invoices")
      .update({ total_amount: total, items_count: (items ?? []).length })
      .eq("id", invoiceId);
    if (updErr) throw updErr;
  },

  /** ویرایش تعداد/قیمت یک قلم داخل یک فاکتور (مثلاً وقتی قیمت اشتباه ثبت شده) */
  async updatePurchaseItem(purchaseId, invoiceId, { quantity, unitPrice }) {
    const qty = Number(quantity) || 0;
    const unit = Number(unitPrice) || 0;
    const totalPrice = Math.round(qty * unit);

    const { error } = await client
      .from("purchases")
      .update({ quantity: qty, unit_price: unit, total_price: totalPrice })
      .eq("id", purchaseId);
    if (error) throw error;

    await this.recalcInvoiceTotals(invoiceId);
  },

  /** حذف یک قلم از داخل فاکتور (بدون حذف کل فاکتور) */
  async deletePurchaseItem(purchaseId, invoiceId) {
    const { error } = await client.from("purchases").delete().eq("id", purchaseId);
    if (error) throw error;

    await this.recalcInvoiceTotals(invoiceId);
  },

  // ---------------------------------------------------------------
  // آپلود عکس فاکتور به Supabase Storage
  // ---------------------------------------------------------------
  async uploadInvoiceImage(file) {
    const ext = (file.name?.split(".").pop() || "jpg").toLowerCase();
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const { error } = await client.storage.from("invoice-images").upload(path, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
    if (error) throw error;
    return path;
  },

  async getInvoiceImageUrl(path) {
    if (!path) return null;
    const { data, error } = await client.storage
      .from("invoice-images")
      .createSignedUrl(path, 60 * 60); // یک ساعت اعتبار
    if (error) return null;
     return data?.signedUrl ?? null;
  },

  async deleteInvoice(invoiceId) {
    const { error: purErr } = await client.from("purchases").delete().eq("invoice_id", invoiceId);
    if (purErr) throw purErr;
    const { error: invErr } = await client.from("invoices").delete().eq("id", invoiceId);
    if (invErr) throw invErr;
  },

  async deleteProduct(productId) {
    const { error: purErr } = await client.from("purchases").delete().eq("product_id", productId);
    if (purErr) throw purErr;
    const { error: prodErr } = await client.from("products").delete().eq("id", productId);
    if (prodErr) throw prodErr;
  },

  /** حذف گروهی چند کالا با هم (برای حالت انتخاب چندتایی) */
  async deleteProducts(productIds) {
    if (!productIds || !productIds.length) return;
    const { error: purErr } = await client.from("purchases").delete().in("product_id", productIds);
    if (purErr) throw purErr;
    const { error: prodErr } = await client.from("products").delete().in("id", productIds);
    if (prodErr) throw prodErr;
  },
};
window.DB = DB;
