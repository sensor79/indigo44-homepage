// ===== 인디고포포 홈페이지 인터랙션 =====

const CERT_LABELS = { vegan: '비건 인증', 'skin-test': '피부자극 테스트 인증' };

document.addEventListener('DOMContentLoaded', () => {
  initNavToggle();
  initFaqAccordion();
  loadProducts();
});

function initNavToggle() {
  const header = document.getElementById('siteHeader');
  const toggle = document.getElementById('navToggle');
  toggle.addEventListener('click', () => {
    header.classList.toggle('menu-open');
  });
  document.querySelectorAll('.nav-menu a').forEach(link => {
    link.addEventListener('click', () => header.classList.remove('menu-open'));
  });
}

function initFaqAccordion() {
  document.querySelectorAll('.faq-item').forEach(item => {
    const question = item.querySelector('.faq-question');
    question.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
  });
}

async function loadProducts() {
  const tabsEl = document.getElementById('categoryTabs');
  const gridEl = document.getElementById('productGrid');

  try {
    const categories = await fetchCategoriesWithProducts();

    categories.forEach((cat, i) => {
      const tab = document.createElement('button');
      tab.className = 'category-tab' + (i === 0 ? ' active' : '');
      tab.textContent = cat.name + (cat.status === 'coming-soon' ? ' (준비중)' : '');
      tab.dataset.categoryId = cat.id;
      tab.addEventListener('click', () => {
        document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderProducts(cat, gridEl);
      });
      tabsEl.appendChild(tab);
    });

    if (categories.length) {
      renderProducts(categories[0], gridEl);
    }
  } catch (err) {
    gridEl.innerHTML = '<p class="category-empty">제품 정보를 불러오지 못했습니다.</p>';
    console.error('제품 데이터를 불러오는 중 오류가 발생했습니다.', err);
  }
}

async function fetchCategoriesWithProducts() {
  const { data: categories, error: catErr } = await supabaseClient
    .from('categories')
    .select('*')
    .order('sort_order', { ascending: true });
  if (catErr) throw catErr;

  const { data: products, error: prodErr } = await supabaseClient
    .from('products')
    .select('*')
    .order('sort_order', { ascending: true });
  if (prodErr) throw prodErr;

  return categories.map(cat => ({
    ...cat,
    products: products.filter(p => p.category_id === cat.id)
  }));
}

function renderProducts(category, gridEl) {
  gridEl.innerHTML = '';

  if (!category.products || category.products.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'category-empty';
    empty.textContent = category.status === 'coming-soon'
      ? '준비 중인 제품군입니다. 곧 만나보실 수 있어요.'
      : '곧 새로운 제품으로 채워질 예정입니다.';
    gridEl.appendChild(empty);
    return;
  }

  category.products.forEach(product => {
    const card = document.createElement('div');
    card.className = 'product-card';

    const tags = (product.certifications || [])
      .map(c => `<span class="tag">${CERT_LABELS[c] || c}</span>`)
      .join('');

    card.innerHTML = `
      <div class="thumb">
        <img src="${product.image_url}" alt="${product.name}" loading="lazy">
      </div>
      <div class="product-body">
        <h3 class="product-name">${product.name}</h3>
        <p class="product-desc">${product.description}</p>
        <p class="product-ingredients">${product.ingredients}</p>
        ${tags ? `<div class="product-tags">${tags}</div>` : ''}
        <div class="product-footer">
          <span class="product-price">${product.price.toLocaleString('ko-KR')}원</span>
          <a class="btn btn-primary btn-sm" href="${product.purchase_url}" target="_blank" rel="noopener">구매하기</a>
        </div>
      </div>
    `;
    gridEl.appendChild(card);
  });
}
