// ===== 인디고포포 홈페이지 인터랙션 =====

const CERT_LABELS = {
  vegan: '비건 인증',
  'skin-test': '피부자극 테스트 인증',
  'heavy-metal-free': '무중금속 인증',
  antibacterial: '항균테스트 인증'
};

const FALLBACK_CATEGORIES = [
  { id: 'fallback-cat-soap', name: '고체비누', status: 'active', sort_order: 0 },
  { id: 'fallback-cat-care', name: '바디케어', status: 'active', sort_order: 1 }
];

const FALLBACK_PRODUCTS = [
  {
    id: 'fallback-product-1',
    category_id: 'fallback-cat-soap',
    name: '오가닉 샴푸바',
    description: '부드러운 거품과 깔끔한 세정감으로 일상에 자연스럽게 더해보세요.',
    ingredients: '코코넛오일, 라벤더 추출물, 소듐코코일글루타메이트',
    price: 18000,
    purchase_url: 'https://smartstore.naver.com/indigo44',
    certifications: ['vegan', 'heavy-metal-free'],
    image_url: 'assets/images/placeholder-product.svg',
    sort_order: 0
  },
  {
    id: 'fallback-product-2',
    category_id: 'fallback-cat-soap',
    name: '클린 바디바',
    description: '피부에 자극이 덜 가도록 순한 성분만 담아 만든 바디바입니다.',
    ingredients: '유기농 코코넛오일, 글리세린, 베이비오일',
    price: 16000,
    purchase_url: 'https://smartstore.naver.com/indigo44',
    certifications: ['skin-test', 'antibacterial'],
    image_url: 'assets/images/placeholder-product.svg',
    sort_order: 1
  },
  {
    id: 'fallback-product-3',
    category_id: 'fallback-cat-care',
    name: '비건 핸드바',
    description: '손을 자주 씻는 일상에 맞춰 가볍고 편안한 사용감을 제공합니다.',
    ingredients: '올리브오일, 소듐 하이드록사이드, 향료',
    price: 14000,
    purchase_url: 'https://smartstore.naver.com/indigo44',
    certifications: ['vegan', 'antibacterial'],
    image_url: 'assets/images/placeholder-product.svg',
    sort_order: 0
  }
];

document.addEventListener('DOMContentLoaded', () => {
  initNavToggle();
  initFaqAccordion();
  loadProducts();
  loadFaqs();
  loadReviews();
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
  const list = document.getElementById('faqList');
  list.addEventListener('click', (e) => {
    const question = e.target.closest('.faq-question');
    if (!question) return;
    const item = question.closest('.faq-item');
    const isOpen = item.classList.contains('open');
    list.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
    if (!isOpen) item.classList.add('open');
  });
}

async function loadFaqs() {
  const listEl = document.getElementById('faqList');
  const { data, error } = await supabaseClient
    .from('faqs')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error || !data || data.length === 0) {
    if (error) console.error('FAQ를 불러오는 중 오류가 발생했습니다.', error);
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = data.map(faq => `
    <div class="faq-item">
      <button class="faq-question">${faq.question} <span class="plus">+</span></button>
      <div class="faq-answer"><p>${faq.answer}</p></div>
    </div>
  `).join('');
}

async function loadReviews() {
  const gridEl = document.getElementById('reviewGrid');
  const { data, error } = await supabaseClient
    .from('reviews')
    .select('*')
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('후기를 불러오는 중 오류가 발생했습니다.', error);
    gridEl.innerHTML = '<p class="category-empty">후기를 불러오지 못했습니다.</p>';
    return;
  }

  if (!data || data.length === 0) {
    gridEl.innerHTML = '<p class="category-empty">아직 등록된 후기가 없어요. 첫 후기를 기다리고 있어요!</p>';
    return;
  }

  gridEl.innerHTML = data.map((review, i) => `
    <div class="review-card" data-review-index="${i}" role="button" tabindex="0" aria-label="${review.author} 후기 전체 보기">
      ${review.image_url ? `
        <div class="review-img"><img src="${review.image_url}" alt="${review.author} 후기 이미지" loading="lazy"></div>
      ` : `
        <div class="stars">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>
      `}
      <p class="review-text">${review.review_text}</p>
      <p class="review-author">${review.author}</p>
    </div>
  `).join('');

  const openFromEvent = (e) => {
    const card = e.target.closest('.review-card');
    if (!card) return;
    openReviewModal(data[Number(card.dataset.reviewIndex)]);
  };
  gridEl.addEventListener('click', openFromEvent);
  gridEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFromEvent(e); }
  });

  initReviewCarousel(gridEl);
}

// 후기 좌우 슬라이드: 데스크톱에선 화살표, 모바일에선 스와이프
function initReviewCarousel(track) {
  const carousel = track.closest('.review-carousel');
  if (!carousel) return;

  const prev = carousel.querySelector('.review-nav-prev');
  const next = carousel.querySelector('.review-nav-next');
  if (!prev || !next) return;

  const updateNav = () => {
    const scrollable = track.scrollWidth - track.clientWidth > 4;
    const hasArrows = window.matchMedia('(min-width: 721px)').matches;
    const atStart = track.scrollLeft <= 2;
    const atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
    prev.hidden = !scrollable || !hasArrows || atStart;
    next.hidden = !scrollable || !hasArrows || atEnd;
  };

  const step = () => Math.max(track.clientWidth * 0.8, 200);
  prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
  next.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));

  track.addEventListener('scroll', updateNav, { passive: true });
  window.addEventListener('resize', updateNav);
  updateNav();
}

function openReviewModal(review) {
  if (!review) return;
  const modal = document.getElementById('reviewViewModal');

  document.getElementById('reviewViewStars').textContent =
    '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
  document.getElementById('reviewViewText').textContent = review.review_text;
  document.getElementById('reviewViewAuthor').textContent = review.author;

  const imgWrap = document.getElementById('reviewViewImgWrap');
  const img = document.getElementById('reviewViewImg');
  if (review.image_url) {
    img.src = review.image_url;
    img.alt = review.author + ' 후기 이미지';
    imgWrap.hidden = false;
  } else {
    img.removeAttribute('src');
    imgWrap.hidden = true;
  }

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeReviewModal() {
  const modal = document.getElementById('reviewViewModal');
  modal.hidden = true;
  document.body.style.overflow = '';
}

document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('reviewViewModal');
  if (!modal) return;
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-close-review]')) closeReviewModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeReviewModal();
  });
});

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
  try {
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

    const resolvedCategories = (categories && categories.length) ? categories : FALLBACK_CATEGORIES;
    const resolvedProducts = (products && products.length) ? products : FALLBACK_PRODUCTS;

    return resolvedCategories.map(cat => ({
      ...cat,
      products: resolvedProducts.filter(p => p.category_id === cat.id)
    }));
  } catch (err) {
    console.warn('제품 데이터를 불러오지 못해 기본 예시를 표시합니다.', err);
    return FALLBACK_CATEGORIES.map(cat => ({
      ...cat,
      products: FALLBACK_PRODUCTS.filter(p => p.category_id === cat.id)
    }));
  }
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
