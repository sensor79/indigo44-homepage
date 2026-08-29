// ===== 인디고포포 홈페이지 인터랙션 =====

const CERT_LABELS = {
  vegan: '비건 인증',
  'skin-test': '피부자극 테스트 인증',
  'heavy-metal-free': '무중금속 인증',
  antibacterial: '항균테스트 인증'
};

// 관리자 입력값(제품·FAQ·후기)을 innerHTML로 렌더링하기 전 이스케이프합니다.
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// 별점이 0~5 범위를 벗어나거나 비어 있어도 렌더링이 죽지 않도록 방어합니다.
function clampRating(n) {
  const r = Math.round(Number(n));
  return Math.min(5, Math.max(0, Number.isFinite(r) ? r : 0));
}

function formatPrice(price) {
  return (Number(price) || 0).toLocaleString('ko-KR');
}

const FALLBACK_FAQS = [
  {
    question: '배송은 얼마나 걸리나요?',
    answer: '주문 후 평균 2~3일 이내 출고됩니다. 자세한 배송 안내는 스마트스토어 페이지에서 확인해주세요.'
  },
  {
    question: '피부가 민감한데 사용해도 될까요?',
    answer: '제품마다 피부자극 테스트 인증 등 표기된 인증이 다르므로, 각 제품의 인증 정보와 성분을 먼저 확인해보시길 권해드립니다.'
  },
  {
    question: '보관은 어떻게 하나요?',
    answer: '물기가 잘 빠지는 트레이에 두어 건조하게 보관하시면 더 오래 사용하실 수 있습니다.'
  }
];

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
    status: 'active',
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
    status: 'active',
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
    status: 'active',
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
  const setOpen = (open) => {
    header.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
  };
  toggle.addEventListener('click', () => {
    setOpen(!header.classList.contains('menu-open'));
  });
  document.querySelectorAll('.nav-menu a').forEach(link => {
    link.addEventListener('click', () => setOpen(false));
  });
  window.addEventListener('resize', () => setOpen(false));
}

function initFaqAccordion() {
  const list = document.getElementById('faqList');
  list.addEventListener('click', (e) => {
    const question = e.target.closest('.faq-question');
    if (!question) return;
    const item = question.closest('.faq-item');
    const isOpen = item.classList.contains('open');
    list.querySelectorAll('.faq-item.open').forEach(el => {
      el.classList.remove('open');
      el.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
    });
    if (!isOpen) {
      item.classList.add('open');
      question.setAttribute('aria-expanded', 'true');
    }
  });
}

async function loadFaqs() {
  const listEl = document.getElementById('faqList');
  let data = null;
  let requestFailed = false;

  try {
    if (!supabaseClient) throw new Error('Supabase client not available');
    const res = await supabaseClient
      .from('faqs')
      .select('*')
      .eq('published', true)
      .order('sort_order', { ascending: true });
    if (res.error) throw res.error;
    data = res.data;
  } catch (err) {
    requestFailed = true;
    console.warn('FAQ를 불러오지 못해 기본 예시를 표시합니다.', err);
  }

  // 요청 자체가 실패했을 때만 예시 데이터를 보여준다. 정상 조회인데 결과가
  // 0건이면(전부 비공개 등) 예시가 아니라 빈 상태를 그대로 보여줘야 한다.
  const resolved = requestFailed ? FALLBACK_FAQS : (data || []);

  if (resolved.length === 0) {
    listEl.innerHTML = '<p class="category-empty">등록된 FAQ가 없어요.</p>';
    return;
  }

  listEl.innerHTML = resolved.map((faq, i) => `
    <div class="faq-item">
      <button class="faq-question" aria-expanded="false" aria-controls="faqAnswer-${i}">${escapeHtml(faq.question)} <span class="plus">+</span></button>
      <div class="faq-answer" id="faqAnswer-${i}"><p>${escapeHtml(faq.answer)}</p></div>
    </div>
  `).join('');
}

async function loadReviews() {
  const gridEl = document.getElementById('reviewGrid');
  let data, error;

  if (!supabaseClient) {
    error = new Error('Supabase client not available');
  } else {
    ({ data, error } = await supabaseClient
      .from('reviews')
      .select('*')
      .eq('published', true)
      .order('sort_order', { ascending: true }));
  }

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
    <div class="review-card" data-review-index="${i}" role="button" tabindex="0" aria-label="${escapeHtml(review.author)} 후기 전체 보기">
      ${review.image_url ? `
        <div class="review-img"><img src="${escapeHtml(review.image_url)}" alt="${escapeHtml(review.author)} 후기 이미지" loading="lazy" width="640" height="400"></div>
      ` : `
        <div class="stars">${'★'.repeat(clampRating(review.rating))}${'☆'.repeat(5 - clampRating(review.rating))}</div>
      `}
      <p class="review-text">${escapeHtml(review.review_text)}</p>
      <p class="review-author">${escapeHtml(review.author)}</p>
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

let reviewModalLastFocus = null;

function openReviewModal(review) {
  if (!review) return;
  const modal = document.getElementById('reviewViewModal');
  reviewModalLastFocus = document.activeElement;

  document.getElementById('reviewViewStars').textContent =
    '★'.repeat(clampRating(review.rating)) + '☆'.repeat(5 - clampRating(review.rating));
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
  modal.querySelector('.review-modal-close').focus();
}

function closeReviewModal() {
  const modal = document.getElementById('reviewViewModal');
  modal.hidden = true;
  document.body.style.overflow = '';
  if (reviewModalLastFocus) {
    reviewModalLastFocus.focus();
    reviewModalLastFocus = null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('reviewViewModal');
  if (!modal) return;
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-close-review]')) closeReviewModal();
  });
  document.addEventListener('keydown', (e) => {
    if (modal.hidden) return;
    if (e.key === 'Escape') {
      closeReviewModal();
      return;
    }
    if (e.key === 'Tab') {
      const focusable = Array.from(modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
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
    } else {
      gridEl.innerHTML = '<p class="category-empty">등록된 제품이 없어요.</p>';
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
      .neq('status', 'hidden')
      .order('sort_order', { ascending: true });
    if (prodErr) throw prodErr;

    // 요청이 성공했다면(빈 배열이라도) 실제 조회 결과를 그대로 쓴다.
    // 예시 데이터는 요청 자체가 실패했을 때(catch 블록)만 사용한다.
    return (categories || []).map(cat => ({
      ...cat,
      products: (products || []).filter(p => p.category_id === cat.id && p.status !== 'hidden')
    }));
  } catch (err) {
    console.warn('제품 데이터를 불러오지 못해 기본 예시를 표시합니다.', err);
    return FALLBACK_CATEGORIES.map(cat => ({
      ...cat,
      products: FALLBACK_PRODUCTS.filter(p => p.category_id === cat.id && p.status !== 'hidden')
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

    const isSoldOut = product.status === 'sold-out';
    const isComingSoon = product.status === 'coming-soon';
    const statusTag = isSoldOut ? '<span class="tag">품절</span>' : isComingSoon ? '<span class="tag">준비중</span>' : '';

    const tags = statusTag + (product.certifications || [])
      .map(c => `<span class="tag">${escapeHtml(CERT_LABELS[c] || c)}</span>`)
      .join('');

    const purchaseHtml = (isSoldOut || isComingSoon)
      ? `<span class="btn btn-outline btn-sm" aria-disabled="true">${isSoldOut ? '품절' : '준비중'}</span>`
      : `<a class="btn btn-primary btn-sm" href="${escapeHtml(product.purchase_url)}" target="_blank" rel="noopener">구매하기</a>`;

    card.innerHTML = `
      <div class="thumb">
        <img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}" loading="lazy" width="800" height="800">
      </div>
      <div class="product-body">
        <h3 class="product-name">${escapeHtml(product.name)}</h3>
        <p class="product-desc">${escapeHtml(product.description)}</p>
        <p class="product-ingredients">${escapeHtml(product.ingredients)}</p>
        ${tags ? `<div class="product-tags">${tags}</div>` : ''}
        <div class="product-footer">
          <span class="product-price">${formatPrice(product.price)}원</span>
          ${purchaseHtml}
        </div>
      </div>
    `;
    gridEl.appendChild(card);
  });
}
