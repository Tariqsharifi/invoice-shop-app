// =====================================================================
// لایه دسترسی به دیتابیس (Supabase). تمام کوئری‌های برنامه از اینجا رد می‌شود.
// ستون‌های واقعی جدول‌ها: invoices(vendor_name, image_url) — این فایل
// خودش این‌ها را به شکلی که بقیه برنامه انتظار دارد (supplier_name,
// image_path) تبدیل می‌کند، تا نیازی به تغییر جدول‌های Supabase نباشد.
// =====================================================================

const client = window.supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_ANON_KEY
);
window.DB_CLIENT = client;

const DB = {
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

  async getProductHistory(productId) {
    const { data, error } = await client
      .from("purchases")
      .select("id, unit_price, quantity, total_price, purchase_date, invoice_id, invoices(vendor_name)")
      .eq("product_id", productId)
      .order("purchase_date", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      ...r,
      supplier_name: r.invoices?.vendor_name ?? null,
    }));
  },

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

  async getAllInvoices() {
    const { data, error } = await client
      .from("invoices")
      .select("id, invoice_date, vendor_name, image_url, total_amount, created_at, purchases(id)")
      .order("invoice_date", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((inv) => ({
      ...inv,
      supplier_name: inv.vendor_name,
      image_path: inv.image_url,
      items_count: inv.purchases?.length ?? 0,
    }));
  },

  async getInvoiceWithItems(invoiceId) {
    const { data: invoiceRaw, error: invErr } = await client
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .single();
    if (invErr) throw invErr;

    const invoice = {
      ...invoiceRaw,
      supplier_name: invoiceRaw.vendor_name,
      image_path: invoiceRaw.image_url,
    };

    const { data: items, error: itemsErr } = await client
      .from("purchases")
      .select("id, quantity, unit_price, total_price, products(name)")
      .eq("invoice_id", invoiceId);
    if (itemsErr) throw itemsErr;

    return { invoice, items: items ?? [] };
  },

  async saveInvoice({ invoiceDate, supplierName, imagePath, rows }) {
    const totalAmount = rows.reduce((sum, r) => sum + (Number(r.totalPrice) || 0), 0);

    const { data: invoice, error: invErr } = await client
      .from("invoices")
      .insert({
        invoice_date: invoiceDate,
        vendor_name: supplierName || null,
        image_url: imagePath || null,
        total_amount: totalAmount,
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
        existingProducts.push(product);
      }
      purchaseRows.push({
        product_id: product.id,
        invoice_id: invoice.id,
        unit_price: Number(row.unitPrice) || 0,
        quantity: Number(row.quantity) || 0,
        total_price: Number(row.totalPrice) || 0,
        purchase_date: invoiceDate,
      });
    }

    if (purchaseRows.length) {
      const { error: purErr } = await client.from("purchases").insert(purchaseRows);
      if (purErr) throw purErr;
    }

    return invoice;
  },

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
      .createSignedUrl(path, 60 * 60);
    if (error) return null;
    return data?.signedUrl ?? null;
  },
};

window.DB = DB;
