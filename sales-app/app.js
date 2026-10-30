/* برنامج المبيعات — تطبيق محلي يعمل بالكامل داخل المتصفح.
 * كل البيانات محفوظة في localStorage على نفس الجهاز. */
(function () {
  'use strict';

  const STORAGE_KEY = 'salesApp.v1';
  // Set by the hosted single-file build, where printing, downloads and service workers are unavailable.
  const EMBED = !!window.SALES_EMBED;
  const CREDIT = 'Powered by Youssef Ibrahim';

  /* =========================================================
   * Data layer
   * ======================================================= */
  const defaultDB = () => ({
    settings: {
      storeName: 'محلي',
      phone: '',
      address: '',
      currency: 'ج.م',
      taxRate: 0,
      footer: 'شكرًا لزيارتكم',
      theme: 'auto',
      allowNegativeStock: false,
      // Default login admin / admin; the password is stored as a SHA-256 hash.
      auth: { user: 'admin', hash: '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918' }
    },
    products: [],
    customers: [],
    invoices: [],
    expenses: [],
    payments: [],
    suppliers: [],
    purchases: [],
    supplierPayments: [],
    movements: [],
    counters: { invoice: 1, purchase: 1 }
  });

  let db = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultDB();
      const parsed = JSON.parse(raw);
      const base = defaultDB();
      return Object.assign(base, parsed, {
        settings: Object.assign(base.settings, parsed.settings || {}),
        counters: Object.assign(base.counters, parsed.counters || {})
      });
    } catch (e) {
      console.error(e);
      return defaultDB();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {
      toast('تعذر الحفظ! مساحة التخزين ممتلئة — خذ نسخة احتياطية', true);
    }
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const byId = (list, id) => list.find(x => x.id === id);

  /* =========================================================
   * Helpers
   * ======================================================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const num = v => {
    const n = parseFloat(String(v).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',', '.'));
    return isFinite(n) ? n : 0;
  };
  const fmt = n => round2(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const money = n => `<bdi dir="ltr">${fmt(n)}</bdi> ${esc(db.settings.currency)}`;
  const signClass = n => (n < 0 ? 'danger' : 'ok');

  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const todayKey = () => dayKey(new Date());
  const fmtDate = d => new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  const fmtDateTime = d => new Date(d).toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const monthStartKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`; };

  const methodLabel = m => ({ cash: 'نقدي', card: 'فيزا', credit: 'آجل' }[m] || m);

  let toastTimer;
  function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function emptyState(icon, text, action) {
    return `<div class="empty"><span class="big">${icon}</span>${text}${action ? `<div style="margin-top:12px">${action}</div>` : ''}</div>`;
  }

  /* =========================================================
   * Modal
   * ======================================================= */
  const modal = {
    open(title, html, onMount) {
      $('#modal-title').textContent = title;
      $('#modal-body').innerHTML = html;
      $('#modal').hidden = false;
      document.body.style.overflow = 'hidden';
      if (onMount) onMount($('#modal-body'));
      const first = $('#modal-body input:not([type=hidden]), #modal-body select');
      if (first && window.matchMedia('(min-width: 641px)').matches) first.focus();
    },
    close() {
      $('#modal').hidden = true;
      $('#modal-body').innerHTML = '';
      document.body.style.overflow = '';
    }
  };
  $('#modal').addEventListener('click', e => {
    if (e.target.id === 'modal' || e.target.closest('[data-close]')) modal.close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) modal.close(); });

  function confirmBox(message, onYes, yesLabel = 'تأكيد', danger = true) {
    modal.open('تأكيد', `
      <p style="margin-top:0">${message}</p>
      <div class="form-actions">
        <button class="btn" data-close>إلغاء</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" id="confirm-yes">${esc(yesLabel)}</button>
      </div>`, body => {
      $('#confirm-yes', body).onclick = () => { modal.close(); onYes(); };
    });
  }

  function formData(form) {
    const o = {};
    new FormData(form).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; });
    return o;
  }

  /* =========================================================
   * Domain logic
   * ======================================================= */
  const activeInvoices = () => db.invoices.filter(i => i.status !== 'returned');

  function invoiceCost(inv) {
    return inv.items.reduce((s, it) => s + it.cost * it.qty, 0);
  }
  // Profit after discount. Tax is passed through, not counted as profit.
  function invoiceProfit(inv) {
    return inv.subtotal - inv.discount - invoiceCost(inv);
  }

  function inRange(iso, from, to) {
    const k = dayKey(iso);
    return (!from || k >= from) && (!to || k <= to);
  }

  function summarize(from, to) {
    const invs = activeInvoices().filter(i => inRange(i.date, from, to));
    const sales = invs.reduce((s, i) => s + i.total, 0);
    const net = invs.reduce((s, i) => s + i.subtotal - i.discount, 0);
    const cost = invs.reduce((s, i) => s + invoiceCost(i), 0);
    const tax = invs.reduce((s, i) => s + i.tax, 0);
    const expenses = db.expenses.filter(e => inRange(e.date, from, to)).reduce((s, e) => s + e.amount, 0);
    const gross = net - cost;
    const purs = db.purchases.filter(p => p.status !== 'returned' && inRange(p.date, from, to));
    const purchases = purs.reduce((s, p) => s + p.total, 0);
    return { invs, count: invs.length, sales, net, cost, tax, gross, expenses, profit: gross - expenses, purchases, purchaseCount: purs.length };
  }

  function lowStockProducts() {
    return db.products.filter(p => p.trackStock !== false && p.stock <= (p.minStock || 0));
  }

  function categories() {
    return [...new Set(db.products.map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  }

  /* =========================================================
   * Router
   * ======================================================= */
  const routes = {
    dashboard: { title: 'الرئيسية', render: renderDashboard },
    pos: { title: 'نقطة البيع', render: renderPOS },
    invoices: { title: 'الفواتير', render: renderInvoices },
    products: { title: 'الأصناف', render: renderProducts },
    inventory: { title: 'المخزون', render: renderInventory },
    purchases: { title: 'المشتريات', render: renderPurchases },
    suppliers: { title: 'الموردين', render: renderSuppliers },
    customers: { title: 'العملاء', render: renderCustomers },
    expenses: { title: 'المصروفات', render: renderExpenses },
    reports: { title: 'التقارير', render: renderReports },
    options: { title: 'الإعدادات', render: renderSettings }
  };

  function currentRoute() {
    const name = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard';
    return routes[name] ? name : 'dashboard';
  }

  function render() {
    const name = currentRoute();
    const route = routes[name];
    $('#page-title').textContent = route.title;
    document.title = `${route.title} — ${db.settings.storeName || 'برنامج المبيعات'}`;
    $$('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === name));
    const isMore = ['inventory', 'purchases', 'suppliers', 'customers', 'expenses', 'reports', 'options'].includes(name);
    $('#more-btn').style.color = isMore ? 'var(--primary)' : '';
    $('#more-sheet').hidden = true;
    route.render($('#view'));
  }

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  $('#more-btn').addEventListener('click', () => { $('#more-sheet').hidden = false; });
  $('#more-sheet').addEventListener('click', e => { if (e.target.id === 'more-sheet' || e.target.closest('a')) $('#more-sheet').hidden = true; });

  /* =========================================================
   * Dashboard
   * ======================================================= */
  function renderDashboard(view) {
    const today = summarize(todayKey(), todayKey());
    const month = summarize(monthStartKey(), todayKey());
    const debts = db.customers.reduce((s, c) => s + Math.max(0, c.balance || 0), 0);
    const low = lowStockProducts();
    const recent = [...db.invoices].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

    const onboarding = db.products.length === 0 ? `
      <div class="card" style="margin-bottom:16px">
        <h3>👋 أهلًا بيك!</h3>
        <p class="muted" style="margin-top:0">ابدأ بإضافة أصنافك عشان تقدر تبيع.</p>
        <div class="toolbar" style="margin:0">
          <a class="btn primary" href="#products">إضافة أصناف</a>
        </div>
      </div>` : '';

    view.innerHTML = `
      ${onboarding}
      <div class="grid stats">
        <div class="card stat"><div class="label">مبيعات اليوم</div><div class="value">${money(today.sales)}</div><div class="muted">${today.count} فاتورة</div></div>
        <div class="card stat ${signClass(today.profit)}"><div class="label">ربح اليوم</div><div class="value">${money(today.profit)}</div></div>
        <div class="card stat"><div class="label">مبيعات الشهر</div><div class="value">${money(month.sales)}</div><div class="muted">${month.count} فاتورة</div></div>
        <div class="card stat ${signClass(month.profit)}"><div class="label">صافي ربح الشهر</div><div class="value">${money(month.profit)}</div></div>
        <div class="card stat danger"><div class="label">ديون العملاء</div><div class="value">${money(debts)}</div></div>
        <div class="card stat danger"><div class="label">مستحق للموردين</div><div class="value">${money(db.suppliers.reduce((s, x) => s + Math.max(0, x.balance || 0), 0))}</div></div>
      </div>

      <div class="toolbar">
        <a class="btn primary lg grow" href="#pos">🛒 فاتورة بيع جديدة</a>
      </div>

      <div class="two-col">
        <div class="card">
          <h3>آخر الفواتير</h3>
          ${recent.length ? recent.map(i => `
            <div class="list-row" data-inv="${i.id}" style="cursor:pointer">
              <div>
                <div><b>#${i.no}</b> ${i.customerName ? '· ' + esc(i.customerName) : ''}</div>
                <div class="muted" style="font-size:13px">${fmtDateTime(i.date)}</div>
              </div>
              <div style="text-align:end">
                <div class="num"><b>${money(i.total)}</b></div>
                ${statusBadge(i)}
              </div>
            </div>`).join('') : emptyState('🧾', 'لا توجد فواتير بعد')}
        </div>
        <div class="card">
          <h3>تنبيهات المخزون ${low.length ? `<span class="badge danger">${low.length}</span>` : ''}</h3>
          ${low.length ? low.slice(0, 8).map(p => `
            <div class="list-row">
              <div>${esc(p.name)}</div>
              <span class="badge ${p.stock <= 0 ? 'danger' : 'warn'}">متبقي ${fmt(p.stock)}</span>
            </div>`).join('') : emptyState('✅', 'كل الأصناف متوفرة')}
        </div>
      </div>`;

    $$('[data-inv]', view).forEach(el => el.onclick = () => showInvoice(el.dataset.inv));
  }

  function statusBadge(inv) {
    if (inv.status === 'returned') return '<span class="badge muted">مرتجع</span>';
    const due = round2(inv.total - inv.paid);
    if (due > 0) return `<span class="badge warn">متبقي ${fmt(due)}</span>`;
    return '<span class="badge ok">مدفوعة</span>';
  }

  /* =========================================================
   * POS
   * ======================================================= */
  const pos = { cart: [], discount: 0, discountType: 'value', customerId: '', method: 'cash', paid: '', note: '', category: '', search: '' };

  function cartTotals() {
    const subtotal = round2(pos.cart.reduce((s, l) => s + l.price * l.qty, 0));
    let discount = pos.discountType === 'percent' ? subtotal * num(pos.discount) / 100 : num(pos.discount);
    discount = round2(Math.min(Math.max(discount, 0), subtotal));
    const tax = round2((subtotal - discount) * num(db.settings.taxRate) / 100);
    const total = round2(subtotal - discount + tax);
    return { subtotal, discount, tax, total, items: pos.cart.reduce((s, l) => s + l.qty, 0) };
  }

  function addToCart(product, qty = 1) {
    const line = pos.cart.find(l => l.productId === product.id);
    const inCart = line ? line.qty : 0;
    if (product.trackStock !== false && !db.settings.allowNegativeStock && inCart + qty > product.stock) {
      toast(`الكمية المتاحة من "${product.name}" هي ${fmt(product.stock)} فقط`, true);
      return false;
    }
    if (line) line.qty = round2(line.qty + qty);
    else pos.cart.push({ productId: product.id, name: product.name, price: product.price, cost: product.cost || 0, qty });
    return true;
  }

  function renderPOS(view) {
    const cats = categories();
    view.innerHTML = `
      <div class="pos" id="pos">
        <div>
          <div class="toolbar">
            <input class="input grow" id="pos-search" type="search" placeholder="🔍 ابحث بالاسم أو امسح الباركود ثم Enter" value="${esc(pos.search)}" autocomplete="off">
          </div>
          ${cats.length ? `<div class="chips" id="pos-cats">
            <button class="chip ${pos.category ? '' : 'active'}" data-cat="">الكل</button>
            ${cats.map(c => `<button class="chip ${pos.category === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
          </div>` : ''}
          <div class="products-grid" id="pos-products"></div>
          <div class="cart-fab-spacer"></div>
        </div>
        <div class="card cart" id="cart"></div>
        <button class="cart-fab" id="cart-fab" hidden></button>
      </div>`;

    const search = $('#pos-search', view);
    search.addEventListener('input', () => { pos.search = search.value; drawProducts(); });
    search.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = search.value.trim();
      if (!q) return;
      const exact = db.products.find(p => p.barcode && p.barcode === q);
      const matches = filteredProducts();
      const target = exact || (matches.length === 1 ? matches[0] : null);
      if (target) {
        if (addToCart(target)) toast(`أُضيف: ${target.name}`);
        search.value = ''; pos.search = '';
        drawProducts(); drawCart();
      } else if (!matches.length) {
        toast('لا يوجد صنف بهذا الكود', true);
      }
    });

    const catsEl = $('#pos-cats', view);
    if (catsEl) catsEl.addEventListener('click', e => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      pos.category = b.dataset.cat;
      $$('.chip', catsEl).forEach(c => c.classList.toggle('active', c === b));
      drawProducts();
    });

    $('#pos-products', view).addEventListener('click', e => {
      const t = e.target.closest('[data-pid]');
      if (!t) return;
      const p = byId(db.products, t.dataset.pid);
      if (p && addToCart(p)) drawCart();
    });

    $('#cart-fab', view).onclick = () => $('#cart').scrollIntoView({ behavior: 'smooth', block: 'start' });

    drawProducts();
    drawCart();
    if (window.matchMedia('(min-width: 801px)').matches) search.focus();
  }

  function filteredProducts() {
    const q = pos.search.trim().toLowerCase();
    return db.products.filter(p =>
      (!pos.category || p.category === pos.category) &&
      (!q || p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q))
    );
  }

  function drawProducts() {
    const el = $('#pos-products');
    if (!el) return;
    if (!db.products.length) {
      el.outerHTML = `<div id="pos-products">${emptyState('📦', 'لا توجد أصناف بعد', '<a class="btn primary" href="#products">أضف أول صنف</a>')}</div>`;
      return;
    }
    const list = filteredProducts();
    el.innerHTML = list.length ? list.map(p => {
      const out = p.trackStock !== false && p.stock <= 0;
      return `<button class="p-tile ${out ? 'out' : ''}" data-pid="${p.id}">
        <span class="name">${esc(p.name)}</span>
        <span class="stock">${p.trackStock === false ? 'خدمة' : out ? 'نفد المخزون' : 'متاح ' + fmt(p.stock)}</span>
        <span class="price num">${money(p.price)}</span>
      </button>`;
    }).join('') : `<div style="grid-column:1/-1">${emptyState('🔍', 'لا توجد نتائج')}</div>`;
  }

  function drawCart() {
    const el = $('#cart');
    if (!el) return;
    const t = cartTotals();
    const customers = [...db.customers].sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    el.innerHTML = `
      <h3 style="display:flex;justify-content:space-between;align-items:center">
        <span>الفاتورة ${t.items ? `<span class="badge muted">${fmt(t.items)} قطعة</span>` : ''}</span>
        ${pos.cart.length ? '<button class="btn sm danger" id="cart-clear">تفريغ</button>' : ''}
      </h3>
      <div class="cart-items">
        ${pos.cart.length ? pos.cart.map((l, i) => `
          <div class="cart-line">
            <div>
              <div class="name">${esc(l.name)}</div>
              <div class="sub num">
                <input class="input" style="min-height:30px;width:90px;padding:2px 6px;display:inline-block" type="number" step="any" min="0" inputmode="decimal" data-price="${i}" value="${l.price}" aria-label="السعر">
                × ${fmt(l.qty)} = <b>${money(l.price * l.qty)}</b>
              </div>
            </div>
            <div class="qty">
              <button data-dec="${i}" aria-label="نقص">−</button>
              <input type="number" step="any" min="0" inputmode="decimal" value="${l.qty}" data-qty="${i}" aria-label="الكمية">
              <button data-inc="${i}" aria-label="زيادة">+</button>
            </div>
          </div>`).join('') : emptyState('🛒', 'اختر الأصناف لإضافتها')}
      </div>

      <div class="form-row" style="margin-top:12px">
        <div class="field" style="margin:0">
          <label>الخصم</label>
          <div style="display:flex;gap:6px">
            <input class="input" id="pos-discount" type="number" step="any" min="0" inputmode="decimal" value="${esc(pos.discount || '')}" placeholder="0">
            <select class="input" id="pos-discount-type" style="width:80px">
              <option value="value" ${pos.discountType === 'value' ? 'selected' : ''}>${esc(db.settings.currency)}</option>
              <option value="percent" ${pos.discountType === 'percent' ? 'selected' : ''}>%</option>
            </select>
          </div>
        </div>
        <div class="field" style="margin:0">
          <label>العميل</label>
          <div style="display:flex;gap:6px">
            <select class="input" id="pos-customer">
              <option value="">عميل نقدي</option>
              ${customers.map(c => `<option value="${c.id}" ${pos.customerId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
            <button class="icon-btn" id="pos-new-customer" title="عميل جديد" aria-label="عميل جديد" style="height:44px;width:44px;flex-shrink:0">+</button>
          </div>
        </div>
      </div>

      <div class="totals num">
        <div class="row"><span>الإجمالي</span><span>${money(t.subtotal)}</span></div>
        ${t.discount ? `<div class="row"><span>الخصم</span><span>− ${money(t.discount)}</span></div>` : ''}
        ${t.tax ? `<div class="row"><span>الضريبة (${fmt(db.settings.taxRate)}%)</span><span>${money(t.tax)}</span></div>` : ''}
        <div class="row grand"><span>المطلوب</span><span>${money(t.total)}</span></div>
      </div>

      <div class="pay-methods" id="pos-methods">
        ${['cash', 'card', 'credit'].map(m => `<label><input type="radio" name="method" value="${m}" ${pos.method === m ? 'checked' : ''}><span>${methodLabel(m)}</span></label>`).join('')}
      </div>

      <div class="form-row">
        <div class="field">
          <label>المدفوع</label>
          <input class="input" id="pos-paid" type="number" step="any" min="0" inputmode="decimal" placeholder="${pos.method === 'credit' ? '0' : fmt(t.total)}" value="${esc(pos.paid)}">
        </div>
        <div class="field">
          <label id="pos-change-label">الباقي</label>
          <div class="input num" id="pos-change" style="display:flex;align-items:center;background:var(--surface-2)"></div>
        </div>
      </div>
      <div class="field">
        <input class="input" id="pos-note" placeholder="ملاحظة (اختياري)" value="${esc(pos.note)}">
      </div>

      <button class="btn primary lg block" id="pos-checkout" ${pos.cart.length ? '' : 'disabled'}>✔ حفظ الفاتورة</button>
    `;

    updateChange();

    el.onclick = e => {
      const inc = e.target.closest('[data-inc]');
      const dec = e.target.closest('[data-dec]');
      if (inc) {
        const l = pos.cart[+inc.dataset.inc];
        const p = byId(db.products, l.productId);
        if (p) addToCart(p); else l.qty++;
        drawCart();
      } else if (dec) {
        const i = +dec.dataset.dec;
        pos.cart[i].qty = round2(pos.cart[i].qty - 1);
        if (pos.cart[i].qty <= 0) pos.cart.splice(i, 1);
        drawCart();
      }
    };

    $$('[data-qty]', el).forEach(inp => inp.onchange = () => {
      const i = +inp.dataset.qty;
      const l = pos.cart[i];
      const q = num(inp.value);
      if (q <= 0) { pos.cart.splice(i, 1); drawCart(); return; }
      const p = byId(db.products, l.productId);
      if (p && p.trackStock !== false && !db.settings.allowNegativeStock && q > p.stock) {
        toast(`الكمية المتاحة ${fmt(p.stock)} فقط`, true);
        l.qty = p.stock;
      } else l.qty = q;
      drawCart();
    });
    $$('[data-price]', el).forEach(inp => inp.onchange = () => {
      pos.cart[+inp.dataset.price].price = Math.max(0, num(inp.value));
      drawCart();
    });

    const clear = $('#cart-clear', el);
    if (clear) clear.onclick = () => { resetPOS(); drawCart(); };

    $('#pos-discount', el).onchange = e => { pos.discount = e.target.value; drawCart(); };
    $('#pos-discount-type', el).onchange = e => { pos.discountType = e.target.value; drawCart(); };
    $('#pos-customer', el).onchange = e => { pos.customerId = e.target.value; };
    $('#pos-new-customer', el).onclick = () => editCustomer(null, c => { pos.customerId = c.id; drawCart(); });
    $('#pos-methods', el).onchange = e => {
      pos.method = e.target.value;
      if (pos.method === 'credit') pos.paid = '';
      drawCart();
    };
    $('#pos-paid', el).oninput = e => { pos.paid = e.target.value; updateChange(); };
    $('#pos-note', el).oninput = e => { pos.note = e.target.value; };
    $('#pos-checkout', el).onclick = checkout;

    const fab = $('#cart-fab');
    $('#pos').classList.toggle('has-cart', pos.cart.length > 0);
    fab.hidden = !pos.cart.length;
    fab.innerHTML = `<span>🛒 ${fmt(t.items)} صنف</span><span>${money(t.total)}</span>`;
  }

  function effectivePaid(total) {
    if (pos.paid === '' || pos.paid == null) return pos.method === 'credit' ? 0 : total;
    return Math.max(0, num(pos.paid));
  }

  function updateChange() {
    const t = cartTotals();
    const paid = effectivePaid(t.total);
    const diff = round2(paid - t.total);
    const label = $('#pos-change-label');
    const out = $('#pos-change');
    if (!out) return;
    if (diff >= 0) { label.textContent = 'الباقي للعميل'; out.innerHTML = money(diff); out.style.color = ''; }
    else { label.textContent = 'متبقي (آجل)'; out.innerHTML = money(-diff); out.style.color = 'var(--danger)'; }
  }

  function resetPOS() {
    Object.assign(pos, { cart: [], discount: 0, discountType: 'value', customerId: '', method: 'cash', paid: '', note: '' });
  }

  function checkout() {
    if (!pos.cart.length) return;
    const t = cartTotals();
    const paidInput = effectivePaid(t.total);
    const paid = round2(Math.min(paidInput, t.total));
    const due = round2(t.total - paid);
    const customer = pos.customerId ? byId(db.customers, pos.customerId) : null;

    if (due > 0 && !customer) {
      toast('لازم تختار عميل لو فيه مبلغ متبقي (آجل)', true);
      $('#pos-customer').focus();
      return;
    }

    // Re-check stock just before saving
    if (!db.settings.allowNegativeStock) {
      for (const l of pos.cart) {
        const p = byId(db.products, l.productId);
        if (p && p.trackStock !== false && l.qty > p.stock) {
          toast(`المخزون غير كافٍ: ${p.name}`, true);
          return;
        }
      }
    }

    const inv = {
      id: uid(),
      no: db.counters.invoice++,
      date: new Date().toISOString(),
      items: pos.cart.map(l => ({ ...l })),
      subtotal: t.subtotal,
      discount: t.discount,
      tax: t.tax,
      total: t.total,
      paid,
      change: round2(Math.max(0, paidInput - t.total)),
      method: pos.method,
      customerId: customer ? customer.id : '',
      customerName: customer ? customer.name : '',
      note: pos.note,
      status: 'paid'
    };

    for (const l of inv.items) {
      const p = byId(db.products, l.productId);
      if (p && p.trackStock !== false) {
        p.stock = round2(p.stock - l.qty);
        logMove(p, -l.qty, 'sale', 'فاتورة #' + inv.no);
      }
    }
    if (customer && due > 0) customer.balance = round2((customer.balance || 0) + due);

    db.invoices.push(inv);
    save();
    resetPOS();
    drawProducts();
    drawCart();
    toast(`تم حفظ الفاتورة #${inv.no}`);
    showInvoice(inv.id, true);
  }

  /* =========================================================
   * Invoices
   * ======================================================= */
  const invFilter = { q: '', from: '', to: '', status: '' };

  function renderInvoices(view) {
    view.innerHTML = `
      <div class="toolbar">
        <input class="input grow" type="search" id="inv-q" placeholder="🔍 رقم الفاتورة أو اسم العميل" value="${esc(invFilter.q)}">
        <input class="input" type="date" id="inv-from" value="${invFilter.from}" style="width:auto" aria-label="من">
        <input class="input" type="date" id="inv-to" value="${invFilter.to}" style="width:auto" aria-label="إلى">
        <select class="input" id="inv-status" style="width:auto">
          <option value="">كل الحالات</option>
          <option value="paid" ${invFilter.status === 'paid' ? 'selected' : ''}>مدفوعة</option>
          <option value="due" ${invFilter.status === 'due' ? 'selected' : ''}>عليها متبقي</option>
          <option value="returned" ${invFilter.status === 'returned' ? 'selected' : ''}>مرتجع</option>
        </select>
        ${EMBED ? '' : '<button class="btn" id="inv-csv">⬇ Excel</button>'}
      </div>
      <div id="inv-summary" class="muted" style="margin-bottom:10px"></div>
      <div class="card"><div class="table-wrap" id="inv-list"></div></div>`;

    const bind = (id, key, ev = 'input') => $(id, view).addEventListener(ev, e => { invFilter[key] = e.target.value; drawInvoices(); });
    bind('#inv-q', 'q'); bind('#inv-from', 'from', 'change'); bind('#inv-to', 'to', 'change'); bind('#inv-status', 'status', 'change');
    if (!EMBED) $('#inv-csv', view).onclick = () => exportInvoicesCSV(filteredInvoices());
    drawInvoices();
  }

  function filteredInvoices() {
    const q = invFilter.q.trim().toLowerCase();
    return [...db.invoices]
      .filter(i => {
        if (q && !(String(i.no) === q.replace('#', '') || (i.customerName || '').toLowerCase().includes(q))) return false;
        if (!inRange(i.date, invFilter.from, invFilter.to)) return false;
        const due = round2(i.total - i.paid) > 0;
        if (invFilter.status === 'returned' && i.status !== 'returned') return false;
        if (invFilter.status === 'paid' && (i.status === 'returned' || due)) return false;
        if (invFilter.status === 'due' && (i.status === 'returned' || !due)) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  function drawInvoices() {
    const list = filteredInvoices();
    const total = list.filter(i => i.status !== 'returned').reduce((s, i) => s + i.total, 0);
    $('#inv-summary').innerHTML = `${list.length} فاتورة · الإجمالي <b class="num">${money(total)}</b>`;
    const el = $('#inv-list');
    if (!list.length) { el.innerHTML = emptyState('🧾', 'لا توجد فواتير'); return; }
    el.innerHTML = `
      <table class="table responsive">
        <thead><tr><th>رقم</th><th>التاريخ</th><th>العميل</th><th>الدفع</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${list.map(i => `
          <tr>
            <td data-label="رقم"><b>#${i.no}</b></td>
            <td data-label="التاريخ">${fmtDateTime(i.date)}</td>
            <td data-label="العميل">${esc(i.customerName) || '<span class="muted">نقدي</span>'}</td>
            <td data-label="الدفع">${methodLabel(i.method)}</td>
            <td data-label="الإجمالي" class="num"><b>${money(i.total)}</b></td>
            <td data-label="الحالة">${statusBadge(i)}</td>
            <td class="actions"><button class="btn sm" data-view="${i.id}">عرض</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    $$('[data-view]', el).forEach(b => b.onclick = () => showInvoice(b.dataset.view));
  }

  function showInvoice(id, justCreated) {
    const inv = byId(db.invoices, id);
    if (!inv) return;
    const due = round2(inv.total - inv.paid);
    modal.open(`فاتورة #${inv.no}`, `
      ${justCreated ? '<div class="badge ok" style="margin-bottom:10px">✔ تم الحفظ بنجاح</div>' : ''}
      <div class="muted" style="margin-bottom:8px">${fmtDateTime(inv.date)} · ${methodLabel(inv.method)} ${inv.customerName ? '· ' + esc(inv.customerName) : ''}</div>
      <table class="table">
        <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
        <tbody>${inv.items.map(it => `<tr><td>${esc(it.name)}</td><td class="num">${fmt(it.qty)}</td><td class="num">${fmt(it.price)}</td><td class="num">${fmt(it.price * it.qty)}</td></tr>`).join('')}</tbody>
      </table>
      <div class="totals num">
        <div class="row"><span>الإجمالي</span><span>${money(inv.subtotal)}</span></div>
        ${inv.discount ? `<div class="row"><span>الخصم</span><span>− ${money(inv.discount)}</span></div>` : ''}
        ${inv.tax ? `<div class="row"><span>الضريبة</span><span>${money(inv.tax)}</span></div>` : ''}
        <div class="row grand"><span>الصافي</span><span>${money(inv.total)}</span></div>
        <div class="row"><span>المدفوع</span><span>${money(inv.paid)}</span></div>
        ${due > 0 ? `<div class="row" style="color:var(--danger)"><span>المتبقي</span><span>${money(due)}</span></div>` : ''}
        ${inv.change ? `<div class="row"><span>الباقي للعميل</span><span>${money(inv.change)}</span></div>` : ''}
      </div>
      ${inv.note ? `<p class="muted">📝 ${esc(inv.note)}</p>` : ''}
      ${inv.status === 'returned' ? `<p><span class="badge muted">تم الإرجاع ${inv.returnedAt ? fmtDateTime(inv.returnedAt) : ''}</span></p>` : ''}
      <div class="form-actions">
        ${inv.status !== 'returned' ? '<button class="btn danger" id="inv-return">↩ مرتجع</button>' : ''}
        <button class="btn ${EMBED ? 'primary' : ''}" id="inv-share">${EMBED ? 'نسخ الفاتورة' : 'مشاركة'}</button>
        ${EMBED ? '' : '<button class="btn primary" id="inv-print">🖨 طباعة</button>'}
      </div>`, body => {
      const printBtn = $('#inv-print', body);
      if (printBtn) printBtn.onclick = () => printInvoice(inv);
      $('#inv-share', body).onclick = () => shareInvoice(inv);
      const ret = $('#inv-return', body);
      if (ret) ret.onclick = () => confirmBox(`إرجاع الفاتورة #${inv.no} بالكامل؟ سيتم إرجاع الكميات للمخزون${due > 0 ? ' وخصم المتبقي من حساب العميل' : ''}.`, () => {
        returnInvoice(inv);
        toast('تم إرجاع الفاتورة');
        render();
      }, 'إرجاع');
    });
  }

  function returnInvoice(inv) {
    for (const it of inv.items) {
      const p = byId(db.products, it.productId);
      if (p && p.trackStock !== false) {
        p.stock = round2(p.stock + it.qty);
        logMove(p, it.qty, 'sale_return', 'فاتورة #' + inv.no);
      }
    }
    const due = round2(inv.total - inv.paid);
    const c = inv.customerId && byId(db.customers, inv.customerId);
    if (c && due > 0) c.balance = round2((c.balance || 0) - due);
    inv.status = 'returned';
    inv.returnedAt = new Date().toISOString();
    save();
  }

  function invoiceText(inv) {
    const s = db.settings;
    const lines = [
      s.storeName, s.phone, `فاتورة #${inv.no} - ${fmtDateTime(inv.date)}`, '----------------',
      ...inv.items.map(it => `${it.name}  ${fmt(it.qty)} × ${fmt(it.price)} = ${fmt(it.qty * it.price)}`),
      '----------------',
      inv.discount ? `الخصم: ${fmt(inv.discount)}` : '',
      inv.tax ? `الضريبة: ${fmt(inv.tax)}` : '',
      `الإجمالي: ${fmt(inv.total)} ${s.currency}`,
      round2(inv.total - inv.paid) > 0 ? `المتبقي: ${fmt(inv.total - inv.paid)} ${s.currency}` : '',
      s.footer,
      CREDIT
    ];
    return lines.filter(Boolean).join('\n');
  }

  async function shareInvoice(inv) {
    const text = invoiceText(inv);
    if (EMBED) { copyText(text, 'تم نسخ الفاتورة — الصقها في واتساب', 'نص الفاتورة'); return; }
    try {
      if (navigator.share) { await navigator.share({ title: `فاتورة #${inv.no}`, text }); return; }
      await navigator.clipboard.writeText(text);
      toast('تم نسخ الفاتورة — الصقها في واتساب');
    } catch (e) {
      if (e && e.name !== 'AbortError') {
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
      }
    }
  }

  async function copyText(text, okMsg, title) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch (e) {
      modal.open(title, `<p class="muted" style="margin-top:0">انسخ النص يدويًا:</p><textarea class="input" id="copy-text" style="min-height:220px" readonly>${esc(text)}</textarea>`,
        body => { const t = $('#copy-text', body); t.focus(); t.select(); });
    }
  }

  function printInvoice(inv) {
    const s = db.settings;
    const due = round2(inv.total - inv.paid);
    $('#print-area').innerHTML = `
      <div class="receipt" dir="rtl">
        <h2>${esc(s.storeName)}</h2>
        ${s.address ? `<div class="c">${esc(s.address)}</div>` : ''}
        ${s.phone ? `<div class="c">${esc(s.phone)}</div>` : ''}
        <hr>
        <div>فاتورة رقم: <b>${inv.no}</b></div>
        <div>التاريخ: ${fmtDateTime(inv.date)}</div>
        ${inv.customerName ? `<div>العميل: ${esc(inv.customerName)}</div>` : ''}
        <div>الدفع: ${methodLabel(inv.method)}</div>
        <hr>
        <table>
          <tr><th>الصنف</th><th class="r">ك</th><th class="r">سعر</th><th class="r">إجمالي</th></tr>
          ${inv.items.map(it => `<tr><td>${esc(it.name)}</td><td class="r">${fmt(it.qty)}</td><td class="r">${fmt(it.price)}</td><td class="r">${fmt(it.price * it.qty)}</td></tr>`).join('')}
        </table>
        <hr>
        <table>
          <tr><td>الإجمالي</td><td class="r">${fmt(inv.subtotal)}</td></tr>
          ${inv.discount ? `<tr><td>الخصم</td><td class="r">${fmt(inv.discount)}</td></tr>` : ''}
          ${inv.tax ? `<tr><td>الضريبة</td><td class="r">${fmt(inv.tax)}</td></tr>` : ''}
          <tr class="big"><td>الصافي</td><td class="r">${fmt(inv.total)} ${esc(s.currency)}</td></tr>
          <tr><td>المدفوع</td><td class="r">${fmt(inv.paid + (inv.change || 0))}</td></tr>
          ${inv.change ? `<tr><td>الباقي</td><td class="r">${fmt(inv.change)}</td></tr>` : ''}
          ${due > 0 ? `<tr><td>متبقي آجل</td><td class="r">${fmt(due)}</td></tr>` : ''}
        </table>
        ${inv.status === 'returned' ? '<hr><div class="c big">*** مرتجع ***</div>' : ''}
        <hr>
        <div class="c">${esc(s.footer)}</div>
        <div class="c" style="font-size:10px;margin-top:4px">${CREDIT}</div>
      </div>`;
    window.print();
  }

  function csvDownload(filename, rows) {
    const csv = '﻿' + rows.map(r => r.map(v => {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function exportInvoicesCSV(list) {
    csvDownload(`invoices-${todayKey()}.csv`, [
      ['رقم', 'التاريخ', 'العميل', 'طريقة الدفع', 'الإجمالي قبل الخصم', 'الخصم', 'الضريبة', 'الصافي', 'المدفوع', 'المتبقي', 'الحالة', 'الأصناف'],
      ...list.map(i => [i.no, fmtDateTime(i.date), i.customerName, methodLabel(i.method), i.subtotal, i.discount, i.tax, i.total, i.paid,
        round2(i.total - i.paid), i.status === 'returned' ? 'مرتجع' : 'تم', i.items.map(it => `${it.name} x${it.qty}`).join(' | ')])
    ]);
  }

  /* =========================================================
   * Products
   * ======================================================= */
  const prodFilter = { q: '', category: '', low: false };

  function renderProducts(view) {
    const cats = categories();
    const stockValue = db.products.reduce((s, p) => s + (p.trackStock === false ? 0 : Math.max(0, p.stock) * (p.cost || 0)), 0);
    view.innerHTML = `
      <div class="grid stats">
        <div class="card stat"><div class="label">عدد الأصناف</div><div class="value">${db.products.length}</div></div>
        <div class="card stat"><div class="label">قيمة المخزون (بالتكلفة)</div><div class="value">${money(stockValue)}</div></div>
        <div class="card stat danger"><div class="label">أصناف ناقصة</div><div class="value">${lowStockProducts().length}</div></div>
      </div>
      <div class="toolbar">
        <input class="input grow" type="search" id="p-q" placeholder="🔍 ابحث بالاسم أو الباركود" value="${esc(prodFilter.q)}">
        <select class="input" id="p-cat" style="width:auto">
          <option value="">كل الأقسام</option>
          ${cats.map(c => `<option ${prodFilter.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <label class="btn"><input type="checkbox" id="p-low" ${prodFilter.low ? 'checked' : ''}> الناقص فقط</label>
        ${EMBED ? '' : '<button class="btn" id="p-csv">⬇ Excel</button>'}
        <button class="btn primary" id="p-add">+ صنف جديد</button>
      </div>
      <div class="card"><div class="table-wrap" id="p-list"></div></div>`;

    $('#p-q', view).oninput = e => { prodFilter.q = e.target.value; drawProductsTable(); };
    $('#p-cat', view).onchange = e => { prodFilter.category = e.target.value; drawProductsTable(); };
    $('#p-low', view).onchange = e => { prodFilter.low = e.target.checked; drawProductsTable(); };
    $('#p-add', view).onclick = () => editProduct(null);
    if (!EMBED) $('#p-csv', view).onclick = () => csvDownload(`products-${todayKey()}.csv`, [
      ['الاسم', 'الباركود', 'القسم', 'سعر الشراء', 'سعر البيع', 'المخزون', 'حد الطلب'],
      ...db.products.map(p => [p.name, p.barcode, p.category, p.cost, p.price, p.trackStock === false ? '' : p.stock, p.minStock])
    ]);
    drawProductsTable();
  }

  function drawProductsTable() {
    const q = prodFilter.q.trim().toLowerCase();
    const lowIds = new Set(lowStockProducts().map(p => p.id));
    const list = db.products
      .filter(p => (!q || p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q)) &&
        (!prodFilter.category || p.category === prodFilter.category) &&
        (!prodFilter.low || lowIds.has(p.id)))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    const el = $('#p-list');
    if (!list.length) {
      el.innerHTML = emptyState('📦', db.products.length ? 'لا توجد نتائج' : 'لا توجد أصناف بعد', db.products.length ? '' : '<button class="btn primary" id="p-add2">+ أضف أول صنف</button>');
      const b = $('#p-add2'); if (b) b.onclick = () => editProduct(null);
      return;
    }
    el.innerHTML = `
      <table class="table responsive">
        <thead><tr><th>الصنف</th><th>القسم</th><th>سعر الشراء</th><th>سعر البيع</th><th>المخزون</th><th></th></tr></thead>
        <tbody>${list.map(p => `
          <tr>
            <td data-label="الصنف"><b>${esc(p.name)}</b>${p.barcode ? `<div class="muted" style="font-size:12px">${esc(p.barcode)}</div>` : ''}</td>
            <td data-label="القسم">${esc(p.category) || '<span class="muted">—</span>'}</td>
            <td data-label="سعر الشراء" class="num">${fmt(p.cost || 0)}</td>
            <td data-label="سعر البيع" class="num"><b>${fmt(p.price)}</b></td>
            <td data-label="المخزون">${p.trackStock === false ? '<span class="badge muted">خدمة</span>' :
              `<span class="badge ${p.stock <= 0 ? 'danger' : lowIds.has(p.id) ? 'warn' : 'ok'}">${fmt(p.stock)}</span>`}</td>
            <td class="actions">
              ${p.trackStock === false ? '' : `<button class="btn sm" data-stock="${p.id}">± مخزون</button>`}
              <button class="btn sm" data-edit="${p.id}">تعديل</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    $$('[data-edit]', el).forEach(b => b.onclick = () => editProduct(b.dataset.edit));
    $$('[data-stock]', el).forEach(b => b.onclick = () => adjustStock(b.dataset.stock));
  }

  function editProduct(id, onSaved, hideOpening) {
    const p = id ? byId(db.products, id) : null;
    const cats = categories();
    modal.open(p ? 'تعديل صنف' : 'صنف جديد', `
      <form id="p-form" autocomplete="off">
        <div class="field"><label>اسم الصنف *</label><input class="input" name="name" required value="${esc(p ? p.name : '')}"></div>
        <div class="form-row">
          <div class="field"><label>الباركود / الكود</label><input class="input" name="barcode" value="${esc(p ? p.barcode : '')}"></div>
          <div class="field"><label>القسم</label>
            <input class="input" name="category" list="cat-list" value="${esc(p ? p.category : '')}">
            <datalist id="cat-list">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
          </div>
        </div>
        <div class="form-row">
          <div class="field"><label>سعر الشراء (التكلفة)</label><input class="input" name="cost" type="number" step="any" min="0" inputmode="decimal" value="${p ? p.cost : ''}"></div>
          <div class="field"><label>سعر البيع *</label><input class="input" name="price" type="number" step="any" min="0" inputmode="decimal" required value="${p ? p.price : ''}"></div>
        </div>
        <label style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
          <input type="checkbox" name="service" ${p && p.trackStock === false ? 'checked' : ''}> خدمة (بدون مخزون)
        </label>
        <div class="form-row" id="stock-fields">
          <div class="field" ${hideOpening ? 'hidden' : ''}><label>${p ? 'الكمية الحالية' : 'الكمية الافتتاحية'}</label><input class="input" name="stock" type="number" step="any" inputmode="decimal" value="${p ? p.stock : ''}"></div>
          <div class="field"><label>تنبيه عند وصول الكمية إلى</label><input class="input" name="minStock" type="number" step="any" min="0" inputmode="decimal" value="${p ? p.minStock : ''}"></div>
        </div>
        <div class="form-actions">
          ${p ? '<button type="button" class="btn danger" id="p-del" style="margin-inline-end:auto">حذف</button>' : ''}
          <button type="button" class="btn" data-close>إلغاء</button>
          <button class="btn primary">حفظ</button>
        </div>
      </form>`, body => {
      const form = $('#p-form', body);
      const toggleStock = () => { $('#stock-fields', body).style.display = form.service.checked ? 'none' : ''; };
      form.service.onchange = toggleStock; toggleStock();
      form.onsubmit = e => {
        e.preventDefault();
        const d = formData(form);
        if (!d.name) return;
        if (d.barcode && db.products.some(x => x.barcode === d.barcode && x.id !== id)) {
          toast('الباركود مستخدم لصنف آخر', true); return;
        }
        const data = {
          name: d.name, barcode: d.barcode, category: d.category,
          cost: num(d.cost), price: num(d.price),
          trackStock: !form.service.checked,
          stock: num(d.stock), minStock: num(d.minStock)
        };
        let saved = p;
        if (p) {
          const diff = round2(data.stock - p.stock);
          Object.assign(p, data);
          if (data.trackStock) logMove(p, diff, 'edit');
        } else {
          saved = { id: uid(), createdAt: new Date().toISOString(), ...data };
          db.products.push(saved);
          if (data.trackStock) logMove(saved, data.stock, 'opening');
        }
        save(); modal.close();
        if (onSaved) onSaved(saved); else render();
        toast(p ? 'تم تعديل الصنف' : 'تمت إضافة الصنف');
      };
      const del = $('#p-del', body);
      if (del) del.onclick = () => confirmBox(`حذف "${esc(p.name)}"؟ الفواتير القديمة لن تتأثر.`, () => {
        db.products = db.products.filter(x => x.id !== p.id);
        save(); render(); toast('تم الحذف');
      }, 'حذف');
    });
  }

  function adjustStock(id) {
    const p = byId(db.products, id);
    modal.open(`تعديل مخزون: ${p.name}`, `
      <p class="muted" style="margin-top:0">الكمية الحالية: <b class="num">${fmt(p.stock)}</b></p>
      <form id="s-form">
        <div class="pay-methods" style="grid-template-columns:1fr 1fr">
          <label><input type="radio" name="type" value="in" checked><span>➕ إضافة (شراء)</span></label>
          <label><input type="radio" name="type" value="out"><span>➖ خصم (تالف/فاقد)</span></label>
        </div>
        <div class="form-row">
          <div class="field"><label>الكمية</label><input class="input" name="qty" type="number" step="any" min="0" inputmode="decimal" required></div>
          <div class="field"><label>سعر الشراء الجديد (اختياري)</label><input class="input" name="cost" type="number" step="any" min="0" inputmode="decimal" placeholder="${fmt(p.cost || 0)}"></div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn" data-close>إلغاء</button>
          <button class="btn primary">حفظ</button>
        </div>
      </form>`, body => {
      const form = $('#s-form', body);
      form.onsubmit = e => {
        e.preventDefault();
        const d = formData(form);
        const q = num(d.qty);
        if (q <= 0) return;
        if (d.type === 'in' && d.cost !== '' && d.cost != null) {
          // weighted average cost
          const newCost = num(d.cost);
          const oldQty = Math.max(0, p.stock);
          p.cost = round2((oldQty * (p.cost || 0) + q * newCost) / (oldQty + q));
        }
        p.stock = round2(p.stock + (d.type === 'in' ? q : -q));
        logMove(p, d.type === 'in' ? q : -q, d.type === 'in' ? 'adjust_in' : 'adjust_out');
        save(); modal.close(); render();
        toast('تم تحديث المخزون');
      };
    });
  }

  /* =========================================================
   * Stock movements
   * ======================================================= */
  const moveLabels = {
    opening: 'رصيد افتتاحي', sale: 'بيع', sale_return: 'مرتجع بيع', purchase: 'شراء', purchase_return: 'مرتجع شراء',
    adjust_in: 'إضافة يدوية', adjust_out: 'تالف / فاقد', edit: 'تعديل يدوي', count: 'جرد'
  };

  function logMove(product, qty, type, ref, date) {
    if (!product || product.trackStock === false || !qty) return;
    db.movements.push({
      id: uid(), date: date || new Date().toISOString(), productId: product.id, name: product.name,
      qty: round2(qty), balance: product.stock, type, ref: ref || ''
    });
  }

  /* =========================================================
   * Suppliers
   * ======================================================= */
  let supQ = '';

  function renderSuppliers(view) {
    const owed = db.suppliers.reduce((s, x) => s + Math.max(0, x.balance || 0), 0);
    view.innerHTML = `
      <div class="grid stats">
        <div class="card stat"><div class="label">عدد الموردين</div><div class="value">${db.suppliers.length}</div></div>
        <div class="card stat danger"><div class="label">مستحق للموردين</div><div class="value">${money(owed)}</div></div>
      </div>
      <div class="toolbar">
        <input class="input grow" type="search" id="s-q" placeholder="🔍 الاسم أو الموبايل" value="${esc(supQ)}">
        <button class="btn primary" id="s-add">+ مورد جديد</button>
      </div>
      <div class="card"><div class="table-wrap" id="s-list"></div></div>`;
    $('#s-q', view).oninput = e => { supQ = e.target.value; drawSuppliers(); };
    $('#s-add', view).onclick = () => editSupplier(null, () => render());
    drawSuppliers();
  }

  function drawSuppliers() {
    const q = supQ.trim().toLowerCase();
    const list = db.suppliers
      .filter(x => !q || x.name.toLowerCase().includes(q) || (x.phone || '').includes(q) || (x.company || '').toLowerCase().includes(q))
      .sort((a, b) => (b.balance || 0) - (a.balance || 0) || a.name.localeCompare(b.name, 'ar'));
    const el = $('#s-list');
    if (!list.length) { el.innerHTML = emptyState('🏭', db.suppliers.length ? 'لا توجد نتائج' : 'لا يوجد موردين بعد'); return; }
    el.innerHTML = `
      <table class="table responsive">
        <thead><tr><th>المورد</th><th>الموبايل</th><th>المشتريات</th><th>المستحق له</th><th></th></tr></thead>
        <tbody>${list.map(x => {
          const total = db.purchases.filter(p => p.supplierId === x.id && p.status !== 'returned').reduce((s, p) => s + p.total, 0);
          return `<tr>
            <td data-label="المورد"><b>${esc(x.name)}</b>${x.company ? `<div class="muted" style="font-size:12px">${esc(x.company)}</div>` : ''}</td>
            <td data-label="الموبايل">${x.phone ? `<a href="tel:${esc(x.phone)}">${esc(x.phone)}</a>` : '<span class="muted">—</span>'}</td>
            <td data-label="المشتريات" class="num">${money(total)}</td>
            <td data-label="المستحق له">${(x.balance || 0) > 0 ? `<span class="badge danger">${money(x.balance)}</span>` : (x.balance || 0) < 0 ? `<span class="badge ok">لنا عنده ${money(-x.balance)}</span>` : '<span class="badge ok">لا يوجد</span>'}</td>
            <td class="actions">
              <button class="btn sm" data-statement="${x.id}">كشف حساب</button>
              ${(x.balance || 0) > 0 ? `<button class="btn sm primary" data-pay="${x.id}">سداد</button>` : ''}
            </td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
    $$('[data-pay]', el).forEach(b => b.onclick = () => paySupplier(b.dataset.pay));
    $$('[data-statement]', el).forEach(b => b.onclick = () => supplierStatement(b.dataset.statement));
  }

  function editSupplier(id, onSaved) {
    const x = id ? byId(db.suppliers, id) : null;
    modal.open(x ? 'تعديل مورد' : 'مورد جديد', `
      <form id="sup-form" autocomplete="off">
        <div class="form-row">
          <div class="field"><label>اسم المورد *</label><input class="input" name="name" required value="${esc(x ? x.name : '')}"></div>
          <div class="field"><label>الشركة</label><input class="input" name="company" value="${esc(x ? x.company : '')}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label>الموبايل</label><input class="input" name="phone" type="tel" inputmode="tel" value="${esc(x ? x.phone : '')}"></div>
          <div class="field"><label>العنوان</label><input class="input" name="address" value="${esc(x ? x.address : '')}"></div>
        </div>
        ${x ? '' : `<div class="field"><label>رصيد سابق مستحق له (اختياري)</label><input class="input" name="balance" type="number" step="any" inputmode="decimal"></div>`}
        <div class="form-actions">
          ${x ? '<button type="button" class="btn danger" id="sup-del" style="margin-inline-end:auto">حذف</button>' : ''}
          <button type="button" class="btn" data-close>إلغاء</button>
          <button class="btn primary">حفظ</button>
        </div>
      </form>`, body => {
      $('#sup-form', body).onsubmit = e => {
        e.preventDefault();
        const d = formData(e.target);
        if (!d.name) return;
        let saved;
        if (x) { Object.assign(x, { name: d.name, company: d.company, phone: d.phone, address: d.address }); saved = x; }
        else {
          saved = { id: uid(), name: d.name, company: d.company, phone: d.phone, address: d.address, balance: num(d.balance), createdAt: new Date().toISOString() };
          db.suppliers.push(saved);
        }
        save(); modal.close();
        toast(x ? 'تم تعديل المورد' : 'تمت إضافة المورد');
        if (onSaved) onSaved(saved);
      };
      const del = $('#sup-del', body);
      if (del) del.onclick = () => {
        if ((x.balance || 0) > 0) { toast('لا يمكن حذف مورد له رصيد مستحق', true); return; }
        confirmBox(`حذف المورد "${esc(x.name)}"؟`, () => {
          db.suppliers = db.suppliers.filter(s => s.id !== x.id);
          save(); render(); toast('تم الحذف');
        }, 'حذف');
      };
    });
  }

  function paySupplier(id) {
    const x = byId(db.suppliers, id);
    modal.open(`سداد إلى ${x.name}`, `
      <p class="muted" style="margin-top:0">المستحق له: <b class="num" style="color:var(--danger)">${money(x.balance)}</b></p>
      <form id="sp-form">
        <div class="field"><label>المبلغ المدفوع</label><input class="input" name="amount" type="number" step="any" min="0" inputmode="decimal" required value="${x.balance}"></div>
        <div class="field"><label>ملاحظة</label><input class="input" name="note"></div>
        <div class="form-actions">
          <button type="button" class="btn" data-close>إلغاء</button>
          <button class="btn primary">سداد</button>
        </div>
      </form>`, body => {
      $('#sp-form', body).onsubmit = e => {
        e.preventDefault();
        const d = formData(e.target);
        const amount = round2(num(d.amount));
        if (amount <= 0) return;
        x.balance = round2((x.balance || 0) - amount);
        db.supplierPayments.push({ id: uid(), supplierId: x.id, amount, note: d.note, date: new Date().toISOString() });
        save(); modal.close(); render();
        toast(`تم سداد ${fmt(amount)}`);
      };
    });
  }

  function supplierStatement(id) {
    const x = byId(db.suppliers, id);
    const rows = [
      ...db.purchases.filter(p => p.supplierId === x.id).map(p => ({
        date: p.date, text: `فاتورة شراء #${p.no}${p.ref ? ' (' + p.ref + ')' : ''}${p.status === 'returned' ? ' — مرتجع' : ''}`,
        amount: p.total, paid: p.paid, returned: p.status === 'returned'
      })),
      ...db.supplierPayments.filter(p => p.supplierId === x.id).map(p => ({ date: p.date, text: 'سداد' + (p.note ? ' — ' + p.note : ''), amount: 0, paid: p.amount }))
    ].sort((a, b) => b.date.localeCompare(a.date));
    modal.open(`كشف حساب: ${x.name}`, `
      <div class="grid stats" style="grid-template-columns:1fr 1fr">
        <div class="card stat"><div class="label">الموبايل</div><div class="value" style="font-size:16px">${esc(x.phone) || '—'}</div></div>
        <div class="card stat danger"><div class="label">المستحق له</div><div class="value" style="font-size:18px">${money(x.balance || 0)}</div></div>
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>التاريخ</th><th>البيان</th><th>له</th><th>مدفوع</th></tr></thead>
        <tbody>${rows.map(r => `<tr style="${r.returned ? 'opacity:.5' : ''}"><td>${fmtDate(r.date)}</td><td>${esc(r.text)}</td><td class="num">${r.amount ? fmt(r.amount) : ''}</td><td class="num">${r.paid ? fmt(r.paid) : ''}</td></tr>`).join('')}</tbody>
      </table></div>` : emptyState('📄', 'لا توجد حركات')}
      <div class="form-actions">
        <button class="btn" id="ss-edit">تعديل البيانات</button>
        ${(x.balance || 0) > 0 ? '<button class="btn primary" id="ss-pay">سداد</button>' : ''}
      </div>`, body => {
      $('#ss-edit', body).onclick = () => editSupplier(x.id, () => render());
      const pay = $('#ss-pay', body); if (pay) pay.onclick = () => paySupplier(x.id);
    });
  }

  /* =========================================================
   * Purchases
   * ======================================================= */
  const pur = { open: false, lines: [], supplierId: '', ref: '', date: '', discount: '', paid: '', note: '', q: '' };
  const purFilter = { q: '', from: '', to: '' };

  function newPurchase() {
    Object.assign(pur, { open: true, lines: [], supplierId: '', ref: '', date: todayKey(), discount: '', paid: '', note: '', q: '' });
    render();
  }

  function purchaseTotals() {
    const subtotal = round2(pur.lines.reduce((s, l) => s + l.cost * l.qty, 0));
    const discount = round2(Math.min(Math.max(num(pur.discount), 0), subtotal));
    const total = round2(subtotal - discount);
    const paid = pur.paid === '' ? total : round2(Math.min(Math.max(num(pur.paid), 0), total));
    return { subtotal, discount, total, paid, due: round2(total - paid) };
  }

  function renderPurchases(view) {
    if (pur.open) { drawPurchaseEditor(view); return; }
    const owed = db.suppliers.reduce((s, x) => s + Math.max(0, x.balance || 0), 0);
    const month = db.purchases.filter(p => p.status !== 'returned' && inRange(p.date, monthStartKey(), todayKey())).reduce((s, p) => s + p.total, 0);
    view.innerHTML = `
      <div class="grid stats">
        <div class="card stat"><div class="label">مشتريات الشهر</div><div class="value">${money(month)}</div></div>
        <div class="card stat danger"><div class="label">مستحق للموردين</div><div class="value">${money(owed)}</div></div>
      </div>
      <div class="toolbar">
        <button class="btn primary lg grow" id="pu-new">🚚 فاتورة شراء جديدة</button>
      </div>
      <div class="toolbar">
        <input class="input grow" type="search" id="pu-q" placeholder="🔍 رقم الفاتورة أو المورد" value="${esc(purFilter.q)}">
        <input class="input" type="date" id="pu-from" value="${purFilter.from}" style="width:auto" aria-label="من">
        <input class="input" type="date" id="pu-to" value="${purFilter.to}" style="width:auto" aria-label="إلى">
      </div>
      <div class="card"><div class="table-wrap" id="pu-list"></div></div>`;
    $('#pu-new', view).onclick = newPurchase;
    $('#pu-q', view).oninput = e => { purFilter.q = e.target.value; drawPurchaseList(); };
    $('#pu-from', view).onchange = e => { purFilter.from = e.target.value; drawPurchaseList(); };
    $('#pu-to', view).onchange = e => { purFilter.to = e.target.value; drawPurchaseList(); };
    drawPurchaseList();
  }

  function drawPurchaseList() {
    const q = purFilter.q.trim().toLowerCase().replace('#', '');
    const list = db.purchases
      .filter(p => (!q || String(p.no) === q || (p.supplierName || '').toLowerCase().includes(q) || (p.ref || '').toLowerCase().includes(q)) &&
        inRange(p.date, purFilter.from, purFilter.to))
      .sort((a, b) => b.date.localeCompare(a.date));
    const el = $('#pu-list');
    if (!list.length) { el.innerHTML = emptyState('🚚', db.purchases.length ? 'لا توجد نتائج' : 'لا توجد فواتير شراء بعد'); return; }
    el.innerHTML = `
      <table class="table responsive">
        <thead><tr><th>رقم</th><th>التاريخ</th><th>المورد</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${list.map(p => `
          <tr>
            <td data-label="رقم"><b>#${p.no}</b>${p.ref ? `<div class="muted" style="font-size:12px">${esc(p.ref)}</div>` : ''}</td>
            <td data-label="التاريخ">${fmtDate(p.date)}</td>
            <td data-label="المورد">${esc(p.supplierName) || '<span class="muted">—</span>'}</td>
            <td data-label="الإجمالي" class="num"><b>${money(p.total)}</b></td>
            <td data-label="الحالة">${statusBadge(p)}</td>
            <td class="actions"><button class="btn sm" data-view="${p.id}">عرض</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    $$('[data-view]', el).forEach(b => b.onclick = () => showPurchase(b.dataset.view));
  }

  function addPurchaseLine(p) {
    const line = pur.lines.find(l => l.productId === p.id);
    if (line) line.qty = round2(line.qty + 1);
    else pur.lines.push({ productId: p.id, name: p.name, qty: 1, cost: p.cost || 0 });
    pur.q = '';
  }

  function drawPurchaseEditor(view) {
    const suppliers = [...db.suppliers].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    view.innerHTML = `
      <div class="toolbar">
        <button class="btn" id="pe-back">→ رجوع</button>
        <h3 style="margin:0" class="grow">فاتورة شراء جديدة</h3>
      </div>
      <div class="card">
        <div class="form-row">
          <div class="field"><label>المورد</label>
            <div style="display:flex;gap:6px">
              <select class="input" id="pe-supplier">
                <option value="">بدون مورد</option>
                ${suppliers.map(x => `<option value="${x.id}" ${pur.supplierId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
              </select>
              <button class="icon-btn" id="pe-new-sup" title="مورد جديد" aria-label="مورد جديد" style="height:44px;width:44px;flex-shrink:0">+</button>
            </div>
          </div>
          <div class="form-row" style="gap:8px">
            <div class="field"><label>رقم فاتورة المورد</label><input class="input" id="pe-ref" value="${esc(pur.ref)}"></div>
            <div class="field"><label>التاريخ</label><input class="input" id="pe-date" type="date" value="${pur.date}"></div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>الأصناف</h3>
        <div class="toolbar" style="margin-bottom:6px">
          <input class="input grow" id="pe-q" type="search" placeholder="🔍 ابحث عن صنف أو امسح الباركود" value="${esc(pur.q)}" autocomplete="off">
          <button class="btn" id="pe-new-prod">+ صنف جديد</button>
        </div>
        <div id="pe-results"></div>
        <div id="pe-lines"></div>
      </div>
      <div class="card" id="pe-summary"></div>`;

    $('#pe-back', view).onclick = () => {
      const leave = () => { pur.open = false; render(); };
      if (pur.lines.length) confirmBox('الخروج بدون حفظ الفاتورة؟', leave, 'خروج'); else leave();
    };
    $('#pe-supplier', view).onchange = e => { pur.supplierId = e.target.value; };
    $('#pe-new-sup', view).onclick = () => editSupplier(null, x => { pur.supplierId = x.id; render(); });
    $('#pe-ref', view).oninput = e => { pur.ref = e.target.value; };
    $('#pe-date', view).onchange = e => { pur.date = e.target.value; };
    $('#pe-new-prod', view).onclick = () => editProduct(null, p => { addPurchaseLine(p); render(); }, true);
    const q = $('#pe-q', view);
    q.oninput = () => { pur.q = q.value; drawPurchaseResults(); };
    q.onkeydown = e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = q.value.trim();
      const hit = db.products.find(p => p.barcode && p.barcode === v) || (purchaseMatches().length === 1 ? purchaseMatches()[0] : null);
      if (hit) { addPurchaseLine(hit); q.value = ''; drawPurchaseResults(); drawPurchaseLines(); }
      else if (v) toast('لا يوجد صنف بهذا الكود — أضفه كصنف جديد', true);
    };
    drawPurchaseResults();
    drawPurchaseLines();
  }

  function purchaseMatches() {
    const q = pur.q.trim().toLowerCase();
    if (!q) return [];
    return db.products.filter(p => p.trackStock !== false &&
      (p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q))).slice(0, 8);
  }

  function drawPurchaseResults() {
    const el = $('#pe-results');
    const list = purchaseMatches();
    el.innerHTML = list.length ? `<div class="results">${list.map(p => `
      <button class="list-row result" data-add="${p.id}">
        <span>${esc(p.name)} <span class="muted" style="font-size:12px">متاح ${fmt(p.stock)}</span></span>
        <span class="num muted">تكلفة ${fmt(p.cost || 0)}</span>
      </button>`).join('')}</div>` : (pur.q.trim() ? '<p class="muted">لا توجد نتائج</p>' : '');
    $$('[data-add]', el).forEach(b => b.onclick = () => {
      addPurchaseLine(byId(db.products, b.dataset.add));
      $('#pe-q').value = '';
      drawPurchaseResults(); drawPurchaseLines();
    });
  }

  function drawPurchaseLines() {
    const el = $('#pe-lines');
    el.innerHTML = pur.lines.length ? `
      <div class="table-wrap"><table class="table responsive">
        <thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الشراء</th><th>الإجمالي</th><th></th></tr></thead>
        <tbody>${pur.lines.map((l, i) => `
          <tr>
            <td data-label="الصنف"><b>${esc(l.name)}</b></td>
            <td data-label="الكمية"><input class="input num" style="width:90px;min-height:36px" type="number" step="any" min="0" inputmode="decimal" data-qty="${i}" value="${l.qty}"></td>
            <td data-label="سعر الشراء"><input class="input num" style="width:100px;min-height:36px" type="number" step="any" min="0" inputmode="decimal" data-cost="${i}" value="${l.cost}"></td>
            <td data-label="الإجمالي" class="num"><b>${fmt(l.qty * l.cost)}</b></td>
            <td class="actions"><button class="btn sm danger" data-rm="${i}" aria-label="حذف">✕</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : emptyState('📦', 'ابحث عن صنف وأضفه للفاتورة');
    $$('[data-qty]', el).forEach(inp => inp.onchange = () => {
      const q = num(inp.value);
      if (q <= 0) pur.lines.splice(+inp.dataset.qty, 1); else pur.lines[+inp.dataset.qty].qty = q;
      drawPurchaseLines();
    });
    $$('[data-cost]', el).forEach(inp => inp.onchange = () => { pur.lines[+inp.dataset.cost].cost = Math.max(0, num(inp.value)); drawPurchaseLines(); });
    $$('[data-rm]', el).forEach(b => b.onclick = () => { pur.lines.splice(+b.dataset.rm, 1); drawPurchaseLines(); });
    drawPurchaseSummary();
  }

  function drawPurchaseSummary() {
    const el = $('#pe-summary');
    const t = purchaseTotals();
    el.innerHTML = `
      <div class="form-row">
        <div class="field"><label>خصم من المورد</label><input class="input" id="pe-discount" type="number" step="any" min="0" inputmode="decimal" placeholder="0" value="${esc(pur.discount)}"></div>
        <div class="field"><label>المدفوع للمورد</label><input class="input" id="pe-paid" type="number" step="any" min="0" inputmode="decimal" placeholder="${fmt(t.total)}" value="${esc(pur.paid)}"></div>
      </div>
      <div class="totals num">
        <div class="row"><span>الإجمالي</span><span>${money(t.subtotal)}</span></div>
        ${t.discount ? `<div class="row"><span>الخصم</span><span>− ${money(t.discount)}</span></div>` : ''}
        <div class="row grand"><span>الصافي</span><span>${money(t.total)}</span></div>
        ${t.due > 0 ? `<div class="row" style="color:var(--danger)"><span>متبقي للمورد (آجل)</span><span>${money(t.due)}</span></div>` : ''}
      </div>
      <div class="field" style="margin-top:10px"><input class="input" id="pe-note" placeholder="ملاحظة (اختياري)" value="${esc(pur.note)}"></div>
      <button class="btn primary lg block" id="pe-save" ${pur.lines.length ? '' : 'disabled'}>✔ حفظ فاتورة الشراء</button>`;
    $('#pe-discount', el).onchange = e => { pur.discount = e.target.value; drawPurchaseSummary(); };
    $('#pe-paid', el).onchange = e => { pur.paid = e.target.value; drawPurchaseSummary(); };
    $('#pe-note', el).oninput = e => { pur.note = e.target.value; };
    $('#pe-save', el).onclick = () => {
      const t2 = purchaseTotals();
      if (t2.due > 0 && !pur.supplierId) { toast('اختار المورد لو فيه مبلغ متبقي (آجل)', true); return; }
      const p = savePurchase({
        supplierId: pur.supplierId, ref: pur.ref, lines: pur.lines, discount: num(pur.discount),
        paid: pur.paid === '' ? null : num(pur.paid), note: pur.note,
        date: pur.date && pur.date !== todayKey() ? new Date(pur.date + 'T12:00:00').toISOString() : new Date().toISOString()
      });
      pur.open = false;
      render();
      toast(`تم حفظ فاتورة الشراء #${p.no}`);
      showPurchase(p.id);
    };
  }

  // Records a purchase: adds stock, updates average cost and the supplier's balance.
  function savePurchase({ supplierId, ref, lines, discount, paid, note, date }) {
    const subtotal = round2(lines.reduce((s, l) => s + l.cost * l.qty, 0));
    discount = round2(Math.min(Math.max(discount || 0, 0), subtotal));
    const total = round2(subtotal - discount);
    paid = paid == null ? total : round2(Math.min(Math.max(paid, 0), total));
    const supplier = supplierId ? byId(db.suppliers, supplierId) : null;
    const ratio = subtotal ? total / subtotal : 1;
    const purchase = {
      id: uid(), no: db.counters.purchase++, date, ref: ref || '',
      supplierId: supplier ? supplier.id : '', supplierName: supplier ? supplier.name : '',
      items: lines.map(l => ({ ...l })), subtotal, discount, total, paid, note: note || '', status: 'done'
    };
    for (const l of purchase.items) {
      const p = byId(db.products, l.productId);
      if (!p || p.trackStock === false) continue;
      const unit = l.cost * ratio;
      const oldQty = Math.max(0, p.stock);
      p.cost = round2((oldQty * (p.cost || 0) + l.qty * unit) / (oldQty + l.qty));
      p.stock = round2(p.stock + l.qty);
      logMove(p, l.qty, 'purchase', 'شراء #' + purchase.no, date);
    }
    if (supplier && total - paid > 0) supplier.balance = round2((supplier.balance || 0) + total - paid);
    db.purchases.push(purchase);
    save();
    return purchase;
  }

  function showPurchase(id) {
    const p = byId(db.purchases, id);
    if (!p) return;
    const due = round2(p.total - p.paid);
    modal.open(`فاتورة شراء #${p.no}`, `
      <div class="muted" style="margin-bottom:8px">${fmtDate(p.date)} ${p.supplierName ? '· ' + esc(p.supplierName) : ''} ${p.ref ? '· فاتورة المورد ' + esc(p.ref) : ''}</div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
        <tbody>${p.items.map(it => `<tr><td>${esc(it.name)}</td><td class="num">${fmt(it.qty)}</td><td class="num">${fmt(it.cost)}</td><td class="num">${fmt(it.cost * it.qty)}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="totals num">
        <div class="row"><span>الإجمالي</span><span>${money(p.subtotal)}</span></div>
        ${p.discount ? `<div class="row"><span>الخصم</span><span>− ${money(p.discount)}</span></div>` : ''}
        <div class="row grand"><span>الصافي</span><span>${money(p.total)}</span></div>
        <div class="row"><span>المدفوع</span><span>${money(p.paid)}</span></div>
        ${due > 0 ? `<div class="row" style="color:var(--danger)"><span>المتبقي للمورد</span><span>${money(due)}</span></div>` : ''}
      </div>
      ${p.note ? `<p class="muted">📝 ${esc(p.note)}</p>` : ''}
      ${p.status === 'returned' ? `<p><span class="badge muted">تم الإرجاع ${p.returnedAt ? fmtDateTime(p.returnedAt) : ''}</span></p>` : ''}
      <div class="form-actions">
        ${p.status !== 'returned' ? '<button class="btn danger" id="pu-return">↩ مرتجع للمورد</button>' : ''}
        <button class="btn" data-close>إغلاق</button>
      </div>`, body => {
      const ret = $('#pu-return', body);
      if (ret) ret.onclick = () => confirmBox(`إرجاع فاتورة الشراء #${p.no} بالكامل للمورد؟ سيتم خصم الكميات من المخزون${due > 0 ? ' وخصم المتبقي من حساب المورد' : ''}.`, () => {
        for (const it of p.items) {
          const prod = byId(db.products, it.productId);
          if (prod && prod.trackStock !== false) {
            prod.stock = round2(prod.stock - it.qty);
            logMove(prod, -it.qty, 'purchase_return', 'شراء #' + p.no);
          }
        }
        const s = p.supplierId && byId(db.suppliers, p.supplierId);
        if (s && due > 0) s.balance = round2((s.balance || 0) - due);
        p.status = 'returned';
        p.returnedAt = new Date().toISOString();
        save(); render(); toast('تم إرجاع فاتورة الشراء');
      }, 'إرجاع');
    });
  }

  /* =========================================================
   * Inventory
   * ======================================================= */
  const inv = { tab: 'stock', q: '', low: false, type: '' };

  function renderInventory(view) {
    const tracked = db.products.filter(p => p.trackStock !== false);
    const atCost = tracked.reduce((s, p) => s + Math.max(0, p.stock) * (p.cost || 0), 0);
    const atPrice = tracked.reduce((s, p) => s + Math.max(0, p.stock) * p.price, 0);
    const out = tracked.filter(p => p.stock <= 0).length;
    view.innerHTML = `
      <div class="grid stats">
        <div class="card stat"><div class="label">قيمة المخزون بالتكلفة</div><div class="value">${money(atCost)}</div></div>
        <div class="card stat"><div class="label">قيمة المخزون بسعر البيع</div><div class="value">${money(atPrice)}</div></div>
        <div class="card stat ok"><div class="label">الربح المتوقع</div><div class="value">${money(atPrice - atCost)}</div></div>
        <div class="card stat danger"><div class="label">ناقص / نفد</div><div class="value">${lowStockProducts().length} / ${out}</div></div>
      </div>
      <div class="toolbar">
        <div class="chips" style="margin:0">
          <button class="chip ${inv.tab === 'stock' ? 'active' : ''}" data-tab="stock">أرصدة الأصناف</button>
          <button class="chip ${inv.tab === 'moves' ? 'active' : ''}" data-tab="moves">حركة المخزون</button>
        </div>
        <span class="grow"></span>
        <button class="btn" id="inv-count">📋 جرد</button>
        <a class="btn primary" href="#purchases">🚚 شراء</a>
      </div>
      <div class="toolbar">
        <input class="input grow" type="search" id="inv-q" placeholder="🔍 اسم الصنف أو الباركود" value="${esc(inv.q)}">
        ${inv.tab === 'stock'
          ? `<label class="btn"><input type="checkbox" id="inv-low" ${inv.low ? 'checked' : ''}> الناقص فقط</label>`
          : `<select class="input" id="inv-type" style="width:auto"><option value="">كل الحركات</option>${Object.entries(moveLabels).map(([k, v]) => `<option value="${k}" ${inv.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`}
      </div>
      <div class="card"><div class="table-wrap" id="inv-body"></div></div>`;
    $$('[data-tab]', view).forEach(b => b.onclick = () => { inv.tab = b.dataset.tab; renderInventory(view); });
    $('#inv-q', view).oninput = e => { inv.q = e.target.value; drawInventory(); };
    const low = $('#inv-low', view); if (low) low.onchange = e => { inv.low = e.target.checked; drawInventory(); };
    const type = $('#inv-type', view); if (type) type.onchange = e => { inv.type = e.target.value; drawInventory(); };
    $('#inv-count', view).onclick = stockCount;
    drawInventory();
  }

  function drawInventory() {
    const el = $('#inv-body');
    const q = inv.q.trim().toLowerCase();
    if (inv.tab === 'stock') {
      const lowIds = new Set(lowStockProducts().map(p => p.id));
      const list = db.products
        .filter(p => p.trackStock !== false && (!q || p.name.toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q)) && (!inv.low || lowIds.has(p.id)))
        .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name, 'ar'));
      if (!list.length) { el.innerHTML = emptyState('🏷️', db.products.length ? 'لا توجد نتائج' : 'لا توجد أصناف بعد'); return; }
      el.innerHTML = `
        <table class="table responsive">
          <thead><tr><th>الصنف</th><th>الرصيد</th><th>حد الطلب</th><th>متوسط التكلفة</th><th>القيمة</th><th></th></tr></thead>
          <tbody>${list.map(p => `
            <tr>
              <td data-label="الصنف"><b>${esc(p.name)}</b>${p.category ? `<div class="muted" style="font-size:12px">${esc(p.category)}</div>` : ''}</td>
              <td data-label="الرصيد"><span class="badge ${p.stock <= 0 ? 'danger' : lowIds.has(p.id) ? 'warn' : 'ok'}">${fmt(p.stock)}</span></td>
              <td data-label="حد الطلب" class="num">${fmt(p.minStock || 0)}</td>
              <td data-label="متوسط التكلفة" class="num">${fmt(p.cost || 0)}</td>
              <td data-label="القيمة" class="num"><b>${fmt(Math.max(0, p.stock) * (p.cost || 0))}</b></td>
              <td class="actions">
                <button class="btn sm" data-moves="${p.id}">الحركة</button>
                <button class="btn sm" data-stock="${p.id}">± مخزون</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>`;
      $$('[data-stock]', el).forEach(b => b.onclick = () => adjustStock(b.dataset.stock));
      $$('[data-moves]', el).forEach(b => b.onclick = () => { inv.tab = 'moves'; inv.q = byId(db.products, b.dataset.moves).name; render(); });
      return;
    }
    const list = db.movements
      .filter(m => (!q || m.name.toLowerCase().includes(q) || ((byId(db.products, m.productId) || {}).barcode || '').includes(q)) && (!inv.type || m.type === inv.type))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 300);
    if (!list.length) { el.innerHTML = emptyState('🔄', 'لا توجد حركات مخزون مسجلة'); return; }
    el.innerHTML = `
      <table class="table responsive">
        <thead><tr><th>التاريخ</th><th>الصنف</th><th>الحركة</th><th>الكمية</th><th>الرصيد بعدها</th><th>المرجع</th></tr></thead>
        <tbody>${list.map(m => `
          <tr>
            <td data-label="التاريخ">${fmtDateTime(m.date)}</td>
            <td data-label="الصنف"><b>${esc(m.name)}</b></td>
            <td data-label="الحركة"><span class="badge ${m.qty > 0 ? 'ok' : 'warn'}">${moveLabels[m.type] || m.type}</span></td>
            <td data-label="الكمية" class="num" style="color:${m.qty > 0 ? 'var(--ok)' : 'var(--danger)'}"><bdi dir="ltr">${m.qty > 0 ? '+' : ''}${fmt(m.qty)}</bdi></td>
            <td data-label="الرصيد بعدها" class="num">${fmt(m.balance)}</td>
            <td data-label="المرجع">${esc(m.ref) || '<span class="muted">—</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function stockCount() {
    const list = db.products.filter(p => p.trackStock !== false).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    if (!list.length) { toast('لا توجد أصناف للجرد', true); return; }
    modal.open('جرد المخزون', `
      <p class="muted" style="margin-top:0">اكتب الكمية الفعلية الموجودة على الرف. الأصناف اللي تسيبها فاضية مش هتتغير.</p>
      <input class="input" id="cnt-q" type="search" placeholder="🔍 فلترة" style="margin-bottom:8px">
      <form id="cnt-form">
        <div class="count-list">${list.map(p => `
          <label class="list-row count-row" data-name="${esc(p.name.toLowerCase())}">
            <span>${esc(p.name)}<div class="muted" style="font-size:12px">بالنظام: ${fmt(p.stock)}</div></span>
            <input class="input num" style="width:100px" type="number" step="any" inputmode="decimal" name="${p.id}" placeholder="${fmt(p.stock)}">
          </label>`).join('')}
        </div>
        <div class="form-actions">
          <button type="button" class="btn" data-close>إلغاء</button>
          <button class="btn primary">حفظ الجرد</button>
        </div>
      </form>`, body => {
      $('#cnt-q', body).oninput = e => {
        const q = e.target.value.trim().toLowerCase();
        $$('.count-row', body).forEach(r => { r.hidden = q && !r.dataset.name.includes(q); });
      };
      $('#cnt-form', body).onsubmit = e => {
        e.preventDefault();
        const d = formData(e.target);
        let changed = 0;
        for (const p of list) {
          if (d[p.id] === '' || d[p.id] == null) continue;
          const diff = round2(num(d[p.id]) - p.stock);
          if (!diff) continue;
          p.stock = round2(num(d[p.id]));
          logMove(p, diff, 'count', 'جرد');
          changed++;
        }
        save(); modal.close(); render();
        toast(changed ? `تم تعديل ${changed} صنف بعد الجرد` : 'لا توجد فروقات');
      };
    });
  }

  /* =========================================================
   * Customers
   * ======================================================= */
  let custQ = '';

  function renderCustomers(view) {
    const debts = db.customers.reduce((s, c) => s + Math.max(0, c.balance || 0), 0);
    view.innerHTML = `
      <div class="grid stats">
        <div class="card stat"><div class="label">عدد العملاء</div><div class="value">${db.customers.length}</div></div>
        <div class="card stat danger"><div class="label">إجمالي الديون</div><div class="value">${money(debts)}</div></div>
      </div>
      <div class="toolbar">
        <input class="input grow" type="search" id="c-q" placeholder="🔍 الاسم أو الموبايل" value="${esc(custQ)}">
        <button class="btn primary" id="c-add">+ عميل جديد</button>
      </div>
      <div class="card"><div class="table-wrap" id="c-list"></div></div>`;
    $('#c-q', view).oninput = e => { custQ = e.target.value; drawCustomers(); };
    $('#c-add', view).onclick = () => editCustomer(null, () => render());
    drawCustomers();
  }

  function drawCustomers() {
    const q = custQ.trim().toLowerCase();
    const list = db.customers
      .filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
      .sort((a, b) => (b.balance || 0) - (a.balance || 0) || a.name.localeCompare(b.name, 'ar'));
    const el = $('#c-list');
    if (!list.length) { el.innerHTML = emptyState('👥', db.customers.length ? 'لا توجد نتائج' : 'لا يوجد عملاء بعد'); return; }
    el.innerHTML = `
      <table class="table responsive">
        <thead><tr><th>العميل</th><th>الموبايل</th><th>عدد الفواتير</th><th>الرصيد المستحق</th><th></th></tr></thead>
        <tbody>${list.map(c => {
          const count = db.invoices.filter(i => i.customerId === c.id && i.status !== 'returned').length;
          return `<tr>
            <td data-label="العميل"><b>${esc(c.name)}</b></td>
            <td data-label="الموبايل">${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '<span class="muted">—</span>'}</td>
            <td data-label="عدد الفواتير" class="num">${count}</td>
            <td data-label="الرصيد المستحق">${(c.balance || 0) > 0 ? `<span class="badge danger">${money(c.balance)}</span>` : (c.balance || 0) < 0 ? `<span class="badge ok">له عندنا ${money(-c.balance)}</span>` : '<span class="badge ok">لا يوجد</span>'}</td>
            <td class="actions">
              <button class="btn sm" data-statement="${c.id}">كشف حساب</button>
              ${(c.balance || 0) > 0 ? `<button class="btn sm primary" data-pay="${c.id}">تحصيل</button>` : ''}
            </td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
    $$('[data-pay]', el).forEach(b => b.onclick = () => collectPayment(b.dataset.pay));
    $$('[data-statement]', el).forEach(b => b.onclick = () => customerStatement(b.dataset.statement));
  }

  function editCustomer(id, onSaved) {
    const c = id ? byId(db.customers, id) : null;
    modal.open(c ? 'تعديل عميل' : 'عميل جديد', `
      <form id="c-form" autocomplete="off">
        <div class="field"><label>الاسم *</label><input class="input" name="name" required value="${esc(c ? c.name : '')}"></div>
        <div class="form-row">
          <div class="field"><label>الموبايل</label><input class="input" name="phone" type="tel" inputmode="tel" value="${esc(c ? c.phone : '')}"></div>
          <div class="field"><label>العنوان</label><input class="input" name="address" value="${esc(c ? c.address : '')}"></div>
        </div>
        ${c ? '' : `<div class="field"><label>رصيد سابق مستحق (اختياري)</label><input class="input" name="balance" type="number" step="any" inputmode="decimal"></div>`}
        <div class="form-actions">
          ${c ? '<button type="button" class="btn danger" id="c-del" style="margin-inline-end:auto">حذف</button>' : ''}
          <button type="button" class="btn" data-close>إلغاء</button>
          <button class="btn primary">حفظ</button>
        </div>
      </form>`, body => {
      const form = $('#c-form', body);
      form.onsubmit = e => {
        e.preventDefault();
        const d = formData(form);
        if (!d.name) return;
        let saved;
        if (c) { Object.assign(c, { name: d.name, phone: d.phone, address: d.address }); saved = c; }
        else {
          saved = { id: uid(), name: d.name, phone: d.phone, address: d.address, balance: num(d.balance), createdAt: new Date().toISOString() };
          db.customers.push(saved);
        }
        save(); modal.close();
        toast(c ? 'تم تعديل العميل' : 'تمت إضافة العميل');
        if (onSaved) onSaved(saved);
      };
      const del = $('#c-del', body);
      if (del) del.onclick = () => {
        if ((c.balance || 0) > 0) { toast('لا يمكن حذف عميل عليه رصيد مستحق', true); return; }
        confirmBox(`حذف العميل "${esc(c.name)}"؟`, () => {
          db.customers = db.customers.filter(x => x.id !== c.id);
          save(); render(); toast('تم الحذف');
        }, 'حذف');
      };
    });
  }

  function collectPayment(id) {
    const c = byId(db.customers, id);
    modal.open(`تحصيل من ${c.name}`, `
      <p class="muted" style="margin-top:0">الرصيد المستحق: <b class="num" style="color:var(--danger)">${money(c.balance)}</b></p>
      <form id="pay-form">
        <div class="field"><label>المبلغ المحصل</label><input class="input" name="amount" type="number" step="any" min="0" inputmode="decimal" required value="${c.balance}"></div>
        <div class="field"><label>ملاحظة</label><input class="input" name="note"></div>
        <div class="form-actions">
          <button type="button" class="btn" data-close>إلغاء</button>
          <button class="btn primary">تحصيل</button>
        </div>
      </form>`, body => {
      $('#pay-form', body).onsubmit = e => {
        e.preventDefault();
        const d = formData(e.target);
        const amount = round2(num(d.amount));
        if (amount <= 0) return;
        c.balance = round2((c.balance || 0) - amount);
        db.payments.push({ id: uid(), customerId: c.id, amount, note: d.note, date: new Date().toISOString() });
        save(); modal.close(); render();
        toast(`تم تحصيل ${fmt(amount)}`);
      };
    });
  }

  function customerStatement(id) {
    const c = byId(db.customers, id);
    const rows = [
      ...db.invoices.filter(i => i.customerId === c.id).map(i => ({
        date: i.date, text: `فاتورة #${i.no}${i.status === 'returned' ? ' (مرتجع)' : ''}`,
        amount: i.total, paid: i.paid, returned: i.status === 'returned'
      })),
      ...db.payments.filter(p => p.customerId === c.id).map(p => ({ date: p.date, text: 'تحصيل' + (p.note ? ' — ' + p.note : ''), amount: 0, paid: p.amount }))
    ].sort((a, b) => b.date.localeCompare(a.date));
    modal.open(`كشف حساب: ${c.name}`, `
      <div class="grid stats" style="grid-template-columns:1fr 1fr">
        <div class="card stat"><div class="label">الموبايل</div><div class="value" style="font-size:16px">${esc(c.phone) || '—'}</div></div>
        <div class="card stat danger"><div class="label">المستحق</div><div class="value" style="font-size:18px">${money(c.balance || 0)}</div></div>
      </div>
      ${rows.length ? `<table class="table">
        <thead><tr><th>التاريخ</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead>
        <tbody>${rows.map(r => `<tr style="${r.returned ? 'opacity:.5' : ''}"><td>${fmtDate(r.date)}</td><td>${esc(r.text)}</td><td class="num">${r.amount ? fmt(r.amount) : ''}</td><td class="num">${r.paid ? fmt(r.paid) : ''}</td></tr>`).join('')}</tbody>
      </table>` : emptyState('📄', 'لا توجد حركات')}
      <div class="form-actions">
        <button class="btn" id="cs-edit">تعديل البيانات</button>
        ${(c.balance || 0) > 0 ? '<button class="btn primary" id="cs-pay">تحصيل</button>' : ''}
      </div>`, body => {
      $('#cs-edit', body).onclick = () => editCustomer(c.id, () => render());
      const pay = $('#cs-pay', body); if (pay) pay.onclick = () => collectPayment(c.id);
    });
  }

  /* =========================================================
   * Expenses
   * ======================================================= */
  const expFilter = { from: monthStartKey(), to: '' };

  function renderExpenses(view) {
    view.innerHTML = `
      <div class="toolbar">
        <label class="muted">من</label><input class="input" type="date" id="e-from" value="${expFilter.from}" style="width:auto">
        <label class="muted">إلى</label><input class="input" type="date" id="e-to" value="${expFilter.to}" style="width:auto">
        <span class="grow"></span>
        <button class="btn primary" id="e-add">+ مصروف جديد</button>
      </div>
      <div id="e-summary" class="muted" style="margin-bottom:10px"></div>
      <div class="card"><div class="table-wrap" id="e-list"></div></div>`;
    $('#e-from', view).onchange = e => { expFilter.from = e.target.value; drawExpenses(); };
    $('#e-to', view).onchange = e => { expFilter.to = e.target.value; drawExpenses(); };
    $('#e-add', view).onclick = () => editExpense(null);
    drawExpenses();
  }

  function drawExpenses() {
    const list = db.expenses.filter(e => inRange(e.date, expFilter.from, expFilter.to)).sort((a, b) => b.date.localeCompare(a.date));
    const total = list.reduce((s, e) => s + e.amount, 0);
    $('#e-summary').innerHTML = `${list.length} مصروف · الإجمالي <b class="num">${money(total)}</b>`;
    const el = $('#e-list');
    if (!list.length) { el.innerHTML = emptyState('💸', 'لا توجد مصروفات في هذه الفترة'); return; }
    el.innerHTML = `
      <table class="table responsive">
        <thead><tr><th>التاريخ</th><th>البيان</th><th>البند</th><th>المبلغ</th><th></th></tr></thead>
        <tbody>${list.map(e => `
          <tr>
            <td data-label="التاريخ">${fmtDate(e.date)}</td>
            <td data-label="البيان"><b>${esc(e.title)}</b></td>
            <td data-label="البند">${esc(e.category) || '<span class="muted">—</span>'}</td>
            <td data-label="المبلغ" class="num"><b>${money(e.amount)}</b></td>
            <td class="actions"><button class="btn sm" data-edit="${e.id}">تعديل</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    $$('[data-edit]', el).forEach(b => b.onclick = () => editExpense(b.dataset.edit));
  }

  function editExpense(id) {
    const ex = id ? byId(db.expenses, id) : null;
    const cats = [...new Set(['إيجار', 'كهرباء', 'مرتبات', 'نقل', 'صيانة', ...db.expenses.map(e => e.category).filter(Boolean)])];
    modal.open(ex ? 'تعديل مصروف' : 'مصروف جديد', `
      <form id="e-form" autocomplete="off">
        <div class="field"><label>البيان *</label><input class="input" name="title" required value="${esc(ex ? ex.title : '')}"></div>
        <div class="form-row">
          <div class="field"><label>المبلغ *</label><input class="input" name="amount" type="number" step="any" min="0" inputmode="decimal" required value="${ex ? ex.amount : ''}"></div>
          <div class="field"><label>التاريخ</label><input class="input" name="date" type="date" value="${ex ? dayKey(ex.date) : todayKey()}"></div>
        </div>
        <div class="field"><label>البند</label>
          <input class="input" name="category" list="ecat" value="${esc(ex ? ex.category : '')}">
          <datalist id="ecat">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        </div>
        <div class="form-actions">
          ${ex ? '<button type="button" class="btn danger" id="e-del" style="margin-inline-end:auto">حذف</button>' : ''}
          <button type="button" class="btn" data-close>إلغاء</button>
          <button class="btn primary">حفظ</button>
        </div>
      </form>`, body => {
      $('#e-form', body).onsubmit = e => {
        e.preventDefault();
        const d = formData(e.target);
        const date = d.date ? new Date(d.date + 'T12:00:00').toISOString() : new Date().toISOString();
        const data = { title: d.title, amount: round2(num(d.amount)), category: d.category, date };
        if (ex) Object.assign(ex, data); else db.expenses.push({ id: uid(), ...data });
        save(); modal.close(); render(); toast('تم الحفظ');
      };
      const del = $('#e-del', body);
      if (del) del.onclick = () => confirmBox('حذف هذا المصروف؟', () => {
        db.expenses = db.expenses.filter(x => x.id !== ex.id);
        save(); render(); toast('تم الحذف');
      }, 'حذف');
    });
  }

  /* =========================================================
   * Reports
   * ======================================================= */
  const repFilter = { from: monthStartKey(), to: todayKey() };

  function renderReports(view) {
    const presets = [
      ['اليوم', todayKey(), todayKey()],
      ['آخر 7 أيام', dayKey(Date.now() - 6 * 864e5), todayKey()],
      ['هذا الشهر', monthStartKey(), todayKey()],
      ['هذه السنة', `${new Date().getFullYear()}-01-01`, todayKey()],
      ['الكل', '', '']
    ];
    view.innerHTML = `
      <div class="chips">${presets.map((p, i) => `<button class="chip ${repFilter.from === p[1] && repFilter.to === p[2] ? 'active' : ''}" data-preset="${i}">${p[0]}</button>`).join('')}</div>
      <div class="toolbar">
        <label class="muted">من</label><input class="input" type="date" id="r-from" value="${repFilter.from}" style="width:auto">
        <label class="muted">إلى</label><input class="input" type="date" id="r-to" value="${repFilter.to}" style="width:auto">
      </div>
      <div id="r-body"></div>`;
    $$('[data-preset]', view).forEach(b => b.onclick = () => {
      const p = presets[+b.dataset.preset];
      repFilter.from = p[1]; repFilter.to = p[2];
      renderReports(view);
    });
    $('#r-from', view).onchange = e => { repFilter.from = e.target.value; renderReports(view); };
    $('#r-to', view).onchange = e => { repFilter.to = e.target.value; renderReports(view); };
    drawReport();
  }

  function drawReport() {
    const s = summarize(repFilter.from, repFilter.to);

    // Top products
    const prodMap = {};
    s.invs.forEach(inv => {
      const ratio = inv.subtotal ? (inv.subtotal - inv.discount) / inv.subtotal : 1;
      inv.items.forEach(it => {
        const k = it.productId || it.name;
        prodMap[k] = prodMap[k] || { name: it.name, qty: 0, sales: 0, profit: 0 };
        prodMap[k].qty += it.qty;
        prodMap[k].sales += it.price * it.qty * ratio;
        prodMap[k].profit += (it.price * ratio - it.cost) * it.qty;
      });
    });
    const top = Object.values(prodMap).sort((a, b) => b.sales - a.sales).slice(0, 10);

    // Daily chart: last up to 14 days of the range
    const end = repFilter.to ? new Date(repFilter.to + 'T12:00:00') : new Date();
    const startLimit = repFilter.from ? new Date(repFilter.from + 'T12:00:00') : null;
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(end.getTime() - i * 864e5);
      if (startLimit && d < startLimit) continue;
      days.push(dayKey(d));
    }
    const perDay = days.map(k => ({ k, v: s.invs.filter(i => dayKey(i.date) === k).reduce((a, i) => a + i.total, 0) }));
    const max = Math.max(1, ...perDay.map(d => d.v));

    // Payment methods
    const methods = ['cash', 'card', 'credit'].map(m => ({ m, v: s.invs.filter(i => i.method === m).reduce((a, i) => a + i.total, 0) }));

    $('#r-body').innerHTML = `
      <div class="grid stats">
        <div class="card stat"><div class="label">المبيعات</div><div class="value">${money(s.sales)}</div><div class="muted">${s.count} فاتورة</div></div>
        <div class="card stat"><div class="label">تكلفة البضاعة</div><div class="value">${money(s.cost)}</div></div>
        <div class="card stat ${signClass(s.gross)}"><div class="label">مجمل الربح</div><div class="value">${money(s.gross)}</div></div>
        <div class="card stat danger"><div class="label">المصروفات</div><div class="value">${money(s.expenses)}</div></div>
        <div class="card stat ${signClass(s.profit)}"><div class="label">صافي الربح</div><div class="value">${money(s.profit)}</div></div>
        <div class="card stat"><div class="label">متوسط الفاتورة</div><div class="value">${money(s.count ? s.sales / s.count : 0)}</div></div>
        <div class="card stat"><div class="label">المشتريات</div><div class="value">${money(s.purchases)}</div><div class="muted">${s.purchaseCount} فاتورة شراء</div></div>
      </div>
      <div class="card">
        <h3>المبيعات اليومية</h3>
        <div class="bars">${perDay.map(d => `
          <div class="bar" title="${d.k}: ${fmt(d.v)}">
            <span class="val num">${d.v ? fmt(d.v) : ''}</span>
            <div class="fill" style="height:${(d.v / max) * 100}%"></div>
            <span class="lbl">${d.k.slice(8)}/${d.k.slice(5, 7)}</span>
          </div>`).join('')}
        </div>
      </div>
      <div class="two-col" style="margin-top:16px">
        <div class="card">
          <h3>الأكثر مبيعًا</h3>
          ${top.length ? `<table class="table">
            <thead><tr><th>الصنف</th><th>الكمية</th><th>المبيعات</th><th>الربح</th></tr></thead>
            <tbody>${top.map(t => `<tr><td>${esc(t.name)}</td><td class="num">${fmt(t.qty)}</td><td class="num">${fmt(t.sales)}</td><td class="num">${fmt(t.profit)}</td></tr>`).join('')}</tbody>
          </table>` : emptyState('📊', 'لا توجد مبيعات في هذه الفترة')}
        </div>
        <div class="card">
          <h3>طرق الدفع</h3>
          ${methods.map(m => `<div class="list-row"><span>${methodLabel(m.m)}</span><b class="num">${money(m.v)}</b></div>`).join('')}
          ${s.tax ? `<div class="list-row"><span>ضرائب محصلة</span><b class="num">${money(s.tax)}</b></div>` : ''}
        </div>
      </div>`;
  }

  /* =========================================================
   * Settings & backup
   * ======================================================= */
  function renderSettings(view) {
    const s = db.settings;
    view.innerHTML = `
      <div class="card">
        <h3>بيانات المحل</h3>
        <form id="set-form">
          <div class="form-row">
            <div class="field"><label>اسم المحل</label><input class="input" name="storeName" value="${esc(s.storeName)}"></div>
            <div class="field"><label>التليفون</label><input class="input" name="phone" type="tel" value="${esc(s.phone)}"></div>
          </div>
          <div class="field"><label>العنوان</label><input class="input" name="address" value="${esc(s.address)}"></div>
          <div class="form-row">
            <div class="field"><label>العملة</label><input class="input" name="currency" value="${esc(s.currency)}"></div>
            <div class="field"><label>نسبة الضريبة %</label><input class="input" name="taxRate" type="number" step="any" min="0" inputmode="decimal" value="${s.taxRate}"></div>
          </div>
          <div class="field"><label>رسالة أسفل الفاتورة</label><input class="input" name="footer" value="${esc(s.footer)}"></div>
          <div class="form-row">
            <div class="field"><label>المظهر</label>
              <select class="input" name="theme">
                <option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>تلقائي</option>
                <option value="light" ${s.theme === 'light' ? 'selected' : ''}>فاتح</option>
                <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>داكن</option>
              </select>
            </div>
            <div class="field"><label>البيع بدون رصيد مخزون</label>
              <select class="input" name="allowNegativeStock">
                <option value="0" ${!s.allowNegativeStock ? 'selected' : ''}>غير مسموح</option>
                <option value="1" ${s.allowNegativeStock ? 'selected' : ''}>مسموح</option>
              </select>
            </div>
          </div>
          <div class="form-actions"><button class="btn primary">حفظ الإعدادات</button></div>
        </form>
      </div>

      <div class="card">
        <h3>النسخ الاحتياطي</h3>
        <p class="muted" style="margin-top:0">البيانات محفوظة على هذا الجهاز فقط. خذ نسخة احتياطية باستمرار وانقلها لأي جهاز آخر.</p>
        <div class="toolbar" style="margin:0">
          <button class="btn primary" id="backup">${EMBED ? 'نسخ النسخة الاحتياطية' : '⬇ تنزيل نسخة احتياطية'}</button>
          <label class="btn">⬆ استرجاع نسخة<input type="file" id="restore" accept=".json,application/json" hidden></label>
        </div>
        <p class="muted" style="font-size:13px">آخر نسخة: ${s.lastBackup ? fmtDateTime(s.lastBackup) : 'لم يتم بعد'}</p>
      </div>

      <div class="card">
        <h3>الحساب</h3>
        <p class="muted" style="margin-top:0">اسم المستخدم الحالي: <b>${esc(s.auth.user)}</b></p>
        <form id="auth-form" autocomplete="off">
          <div class="field"><label>كلمة المرور الحالية *</label><input class="input" name="current" type="password" required autocomplete="current-password"></div>
          <div class="form-row">
            <div class="field"><label>اسم المستخدم الجديد</label><input class="input" name="user" value="${esc(s.auth.user)}" autocapitalize="off"></div>
            <div class="field"><label>كلمة المرور الجديدة</label><input class="input" name="pass" type="password" autocomplete="new-password" placeholder="اتركها فاضية لو مش هتغيرها"></div>
          </div>
          <div class="form-actions" style="justify-content:space-between">
            <button type="button" class="btn danger" id="logout">تسجيل خروج</button>
            <button class="btn primary">حفظ بيانات الدخول</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h3>أخرى</h3>
        <div class="toolbar" style="margin:0">
          <button class="btn danger" id="wipe">مسح كل البيانات</button>
        </div>
      </div>`;

    $('#set-form', view).onsubmit = e => {
      e.preventDefault();
      const d = formData(e.target);
      Object.assign(db.settings, {
        storeName: d.storeName, phone: d.phone, address: d.address, currency: d.currency || 'ج.م',
        taxRate: Math.max(0, num(d.taxRate)), footer: d.footer, theme: d.theme,
        allowNegativeStock: d.allowNegativeStock === '1'
      });
      save(); applyTheme(); applyBrand(); toast('تم حفظ الإعدادات');
    };

    $('#backup', view).onclick = () => {
      db.settings.lastBackup = new Date().toISOString();
      save();
      const json = JSON.stringify(db, null, 2);
      if (EMBED) {
        render();
        copyText(json, 'تم نسخ النسخة الاحتياطية — احفظها في ملف .json', 'النسخة الاحتياطية');
        return;
      }
      downloadBlob(new Blob([json], { type: 'application/json' }), `sales-backup-${todayKey()}.json`);
      render();
    };

    $('#restore', view).onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data || !Array.isArray(data.products) || !Array.isArray(data.invoices)) throw new Error('bad');
          confirmBox('سيتم استبدال كل البيانات الحالية بالنسخة الاحتياطية. متأكد؟', () => {
            const base = defaultDB();
            db = Object.assign(base, data, {
              settings: Object.assign(base.settings, data.settings || {}),
              counters: Object.assign(base.counters, data.counters || {})
            });
            save(); applyTheme(); applyBrand(); render(); toast('تم استرجاع النسخة الاحتياطية');
          }, 'استرجاع');
        } catch (err) {
          toast('الملف غير صالح', true);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    };

    $('#auth-form', view).onsubmit = async e => {
      e.preventDefault();
      const d = formData(e.target);
      if (!(await checkLogin(db.settings.auth.user, d.current))) { toast('كلمة المرور الحالية غلط', true); return; }
      if (!d.user) { toast('اكتب اسم المستخدم', true); return; }
      if (d.pass && d.pass.length < 4) { toast('كلمة المرور لازم تكون 4 حروف أو أرقام على الأقل', true); return; }
      db.settings.auth = { user: d.user, hash: d.pass ? await sha256(d.pass) : db.settings.auth.hash };
      save(); render(); toast('تم حفظ بيانات الدخول');
    };
    $('#logout', view).onclick = logout;

    $('#wipe', view).onclick = () => confirmBox('<b>سيتم حذف كل البيانات نهائيًا!</b> يُفضل أخذ نسخة احتياطية أولًا.', () => {
      db = defaultDB(); save(); resetPOS(); applyTheme(); applyBrand(); location.hash = '#dashboard'; render(); toast('تم مسح البيانات');
    }, 'مسح الكل');
  }

  function seedDemo() {
    const items = [
      ['مياه معدنية 1.5 لتر', 'مشروبات', 6, 8, 120], ['بيبسي كانز', 'مشروبات', 9, 12, 80], ['عصير مانجو', 'مشروبات', 7, 10, 60],
      ['شيبسي كبير', 'تسالي', 8, 10, 90], ['بسكويت شوكولاتة', 'تسالي', 4, 5, 150], ['شوكولاتة كيت كات', 'تسالي', 12, 15, 4],
      ['أرز 1 كجم', 'بقالة', 28, 34, 50], ['سكر 1 كجم', 'بقالة', 30, 36, 3], ['مكرونة 400 جم', 'بقالة', 11, 14, 70],
      ['زيت 1 لتر', 'بقالة', 62, 72, 25], ['صابون', 'منظفات', 14, 18, 40], ['مسحوق غسيل', 'منظفات', 45, 55, 20]
    ];
    const newProducts = items.map(([name, category, cost, price, stock], i) => ({
      id: uid(), name, category, cost, price, stock, minStock: 5, trackStock: true,
      barcode: String(622100000000 + i), createdAt: new Date().toISOString()
    }));
    db.products.push(...newProducts);
    newProducts.forEach(p => logMove(p, p.stock, 'opening'));
    const custs = [['أحمد محمد', '01001234567'], ['محمود علي', '01112345678'], ['سارة حسن', '01223456789']]
      .map(([name, phone]) => ({ id: uid(), name, phone, address: '', balance: 0, createdAt: new Date().toISOString() }));
    db.customers.push(...custs);

    // Random invoices over the last 10 days
    for (let d = 9; d >= 0; d--) {
      const n = 2 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const lines = [];
        const count = 1 + Math.floor(Math.random() * 3);
        for (let j = 0; j < count; j++) {
          const p = newProducts[Math.floor(Math.random() * newProducts.length)];
          if (lines.some(l => l.productId === p.id)) continue;
          lines.push({ productId: p.id, name: p.name, price: p.price, cost: p.cost, qty: 1 + Math.floor(Math.random() * 3) });
        }
        const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
        const credit = Math.random() < 0.15;
        const cust = credit ? custs[Math.floor(Math.random() * custs.length)] : null;
        const date = new Date(Date.now() - d * 864e5);
        date.setHours(9 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60));
        const paid = credit ? round2(subtotal / 2) : subtotal;
        if (cust) cust.balance = round2(cust.balance + subtotal - paid);
        db.invoices.push({
          id: uid(), no: db.counters.invoice++, date: date.toISOString(), items: lines,
          subtotal, discount: 0, tax: 0, total: subtotal, paid, change: 0,
          method: credit ? 'credit' : (Math.random() < 0.25 ? 'card' : 'cash'),
          customerId: cust ? cust.id : '', customerName: cust ? cust.name : '', note: '', status: 'paid'
        });
      }
    }
    db.expenses.push(
      { id: uid(), title: 'إيجار المحل', amount: 3000, category: 'إيجار', date: new Date(monthStartKey() + 'T12:00:00').toISOString() },
      { id: uid(), title: 'فاتورة كهرباء', amount: 450, category: 'كهرباء', date: new Date().toISOString() }
    );
    const sups = [['شركة النيل للتوزيع', '01005556677'], ['مخازن الأمل', '01114443322']]
      .map(([name, phone]) => ({ id: uid(), name, phone, company: '', address: '', balance: 0, createdAt: new Date().toISOString() }));
    db.suppliers.push(...sups);
    savePurchase({
      supplierId: sups[0].id, ref: 'INV-1042', paid: 300, discount: 0, note: '',
      lines: [newProducts[0], newProducts[1], newProducts[3]].map(p => ({ productId: p.id, name: p.name, qty: 24, cost: p.cost })),
      date: new Date(Date.now() - 3 * 864e5).toISOString()
    });
    savePurchase({
      supplierId: sups[1].id, ref: '', paid: null, discount: 20, note: '',
      lines: [newProducts[6], newProducts[7]].map(p => ({ productId: p.id, name: p.name, qty: 20, cost: p.cost })),
      date: new Date(Date.now() - 1 * 864e5).toISOString()
    });
    save();
  }

  /* =========================================================
   * Login
   * Everything runs in the browser, so this keeps casual users out;
   * it is not protection against someone who can read the page code.
   * ======================================================= */
  const SESSION_KEY = 'salesApp.session';
  let memorySession = false;

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function checkLogin(user, pass) {
    const auth = db.settings.auth;
    return user.trim().toLowerCase() === auth.user.toLowerCase() && (await sha256(pass)) === auth.hash;
  }

  function isLoggedIn() {
    try { return localStorage.getItem(SESSION_KEY) === '1'; } catch (e) { return memorySession; }
  }

  function setSession(on) {
    memorySession = on;
    try { on ? localStorage.setItem(SESSION_KEY, '1') : localStorage.removeItem(SESSION_KEY); } catch (e) { /* in-memory only */ }
  }

  function showLogin() {
    $('.app').hidden = true;
    $('#login').hidden = false;
    $('#login-store').textContent = db.settings.storeName || 'برنامج المبيعات';
    const form = $('#login-form');
    form.reset();
    $('#login-error').hidden = true;
    form.onsubmit = async e => {
      e.preventDefault();
      if (await checkLogin(form.user.value, form.pass.value)) {
        setSession(true);
        $('#login').hidden = true;
        $('.app').hidden = false;
        render();
      } else {
        $('#login-error').hidden = false;
        form.pass.value = '';
        form.pass.focus();
      }
    };
    form.user.focus();
  }

  function logout() {
    setSession(false);
    modal.close();
    $('#view').innerHTML = '';
    showLogin();
  }

  /* =========================================================
   * Boot
   * ======================================================= */
  function applyTheme() {
    const t = db.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  function applyBrand() {
    $('#brand-name').textContent = db.settings.storeName || 'برنامج المبيعات';
  }

  $('#today').textContent = new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
  let firstVisit = false;
  try { firstVisit = !localStorage.getItem(STORAGE_KEY); } catch (e) { firstVisit = true; }
  if (EMBED && firstVisit && !db.products.length) seedDemo();
  applyTheme();
  applyBrand();
  if (isLoggedIn()) render(); else showLogin();
  if (EMBED && firstVisit) toast('تم تحميل بيانات تجريبية — امسحها من الإعدادات');

  // Offline support when served over http(s) (service workers don't run on file://)
  if (!EMBED && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
