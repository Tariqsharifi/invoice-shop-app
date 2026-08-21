// اطلاعات اتصال به Supabase (پروژه مستقل دفتر خرید مغازه)
const SUPABASE_URL = "https://jtkjgmpotablnmcbrjkn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_PM2ydrpkgoM9yQU4uMUeRg_H3cvHQp3";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// نام باکت Storage برای عکس فاکتورها
const INVOICE_BUCKET = "invoice-images";
