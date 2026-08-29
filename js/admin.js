// ===== 인디고44 관리자 페이지 =====

const CERT_LABELS = {
  vegan: '비건 인증',
  'skin-test': '피부자극 테스트 인증',
  'heavy-metal-free': '무중금속 인증',
  antibacterial: '항균테스트 인증'
};

// 관리자 입력값을 innerHTML로 렌더링하기 전 이스케이프합니다 (저장형 XSS 방지).
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function clampRating(n) {
  const r = Math.round(Number(n));
  return Math.min(5, Math.max(0, Number.isFinite(r) ? r : 0));
}

const PRODUCT_STATUS_LABELS = {
  active: '판매중',
  'sold-out': '품절',
  'coming-soon': '준비중',
  hidden: '비공개'
};

// ===== Storage 이미지 정리 =====

const STORAGE_BUCKET = 'product-images';

// 업로드한 이미지의 공개 URL에서 버킷 내 경로만 추출합니다. 로컬 플레이스홀더 등
// 이 버킷 소속이 아닌 URL은 null을 반환해 삭제 시도를 건너뜁니다.
function storagePathFromUrl(url) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

async function deleteStorageImage(url) {
  const path = storagePathFromUrl(url);
  if (!path) return;
  const { error } = await supabaseClient.storage.from(STORAGE_BUCKET).remove([path]);
  if (error) console.warn('Storage 이미지 삭제 실패:', error.message);
}

const views = {
  login: document.getElementById('loginView'),
  setPassword: document.getElementById('setPasswordView'),
  dashboard: document.getElementById('dashboardView'),
};

let state = { categories: [], products: [], faqs: [], reviews: [] };

// 초대/복구 링크로 들어온 경우 supabase-js가 세션을 만들자마자 해시를 지워버리므로,
// 처리되기 전에 미리 읽어둔다 (type=invite 또는 type=recovery면 비밀번호 설정 화면을 보여줘야 함).
const initialLinkType = getUrlHashParam('type');

document.addEventListener('DOMContentLoaded', () => {
  bindStaticEvents();

  if (!supabaseClient) {
    showView('login');
    const errEl = document.getElementById('loginError');
    errEl.textContent = '관리자 페이지를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침해주세요.';
    errEl.hidden = false;
    return;
  }

  supabaseClient.auth.onAuthStateChange((event, session) => {
    const needsPasswordSetup = event === 'PASSWORD_RECOVERY'
      || (session && (initialLinkType === 'invite' || initialLinkType === 'recovery'));

    if (needsPasswordSetup) {
      showView('setPassword');
    } else if (session) {
      showView('dashboard');
      loadDashboard();
    } else {
      showView('login');
    }
  });
});

function getUrlHashParam(key) {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(hash).get(key);
}

function showView(name) {
  Object.entries(views).forEach(([key, el]) => { el.hidden = key !== name; });
  document.getElementById('logoutBtn').hidden = name !== 'dashboard';
}

function setStatus(msg, isError) {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.hidden = !msg;
  el.classList.toggle('admin-error', !!isError);
}

function bindStaticEvents() {
  document.getElementById('loginForm').addEventListener('submit', onLoginSubmit);
  document.getElementById('setPasswordForm').addEventListener('submit', onSetPasswordSubmit);
  document.getElementById('logoutBtn').addEventListener('click', () => supabaseClient.auth.signOut());
  document.getElementById('forgotPasswordBtn').addEventListener('click', onForgotPassword);

  document.getElementById('addCategoryBtn').addEventListener('click', () => openCategoryModal());
  document.getElementById('addProductBtn').addEventListener('click', () => openProductModal());
  document.getElementById('productCategoryFilter').addEventListener('change', renderProductList);

  document.getElementById('categoryForm').addEventListener('submit', onCategorySubmit);
  document.getElementById('productForm').addEventListener('submit', onProductSubmit);
  document.getElementById('productImageFile').addEventListener('change', (e) => onImageFileChange(e, 'productImagePreview', 'productImageRemoveBtn'));
  document.getElementById('productImageRemoveBtn').addEventListener('click', () => onImageRemoveClick('productModal', 'productImageFile', 'productImagePreview', 'productImageRemoveBtn'));

  document.getElementById('addFaqBtn').addEventListener('click', () => openFaqModal());
  document.getElementById('faqForm').addEventListener('submit', onFaqSubmit);

  document.getElementById('addReviewBtn').addEventListener('click', () => openReviewModal());
  document.getElementById('reviewForm').addEventListener('submit', onReviewSubmit);
  document.getElementById('reviewImageFile').addEventListener('change', (e) => onImageFileChange(e, 'reviewImagePreview', 'reviewImageRemoveBtn'));
  document.getElementById('reviewImageRemoveBtn').addEventListener('click', () => onImageRemoveClick('reviewModal', 'reviewImageFile', 'reviewImagePreview', 'reviewImageRemoveBtn'));

  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModals());
  });

  document.addEventListener('keydown', onModalKeydown);
}

const MODAL_FOCUSABLE_SELECTOR = 'input, select, textarea, button, [href]';
let modalLastFocus = null;

function getOpenModal() {
  return document.querySelector('.admin-modal:not([hidden])');
}

function openModal(modal) {
  modalLastFocus = document.activeElement;
  modal.hidden = false;
  const focusable = modal.querySelectorAll(MODAL_FOCUSABLE_SELECTOR);
  if (focusable.length) focusable[0].focus();
}

function closeModals() {
  document.getElementById('categoryModal').hidden = true;
  document.getElementById('productModal').hidden = true;
  document.getElementById('faqModal').hidden = true;
  document.getElementById('reviewModal').hidden = true;
  if (modalLastFocus) {
    modalLastFocus.focus();
    modalLastFocus = null;
  }
}

function onModalKeydown(e) {
  const modal = getOpenModal();
  if (!modal) return;

  if (e.key === 'Escape') {
    closeModals();
    return;
  }

  if (e.key === 'Tab') {
    const focusable = Array.from(modal.querySelectorAll(MODAL_FOCUSABLE_SELECTOR));
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
}

// ===== 인증 =====

async function onLoginSubmit(e) {
  e.preventDefault();
  if (!supabaseClient) return;
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.hidden = true;

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    errEl.textContent = '로그인에 실패했습니다: ' + error.message;
    errEl.hidden = false;
  }
}

async function onSetPasswordSubmit(e) {
  e.preventDefault();
  if (!supabaseClient) return;
  const pw = document.getElementById('newPassword').value;
  const pwConfirm = document.getElementById('newPasswordConfirm').value;
  const errEl = document.getElementById('setPasswordError');
  errEl.hidden = true;

  if (pw !== pwConfirm) {
    errEl.textContent = '비밀번호가 서로 달라요. 다시 확인해주세요.';
    errEl.hidden = false;
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({ password: pw });
  if (error) {
    errEl.textContent = '비밀번호 설정에 실패했습니다: ' + error.message;
    errEl.hidden = false;
    return;
  }
  showView('dashboard');
  loadDashboard();
}

async function onForgotPassword() {
  if (!supabaseClient) return;
  const email = document.getElementById('loginEmail').value.trim();
  const msgEl = document.getElementById('forgotPasswordMsg');

  if (!email) {
    msgEl.textContent = '먼저 이메일을 입력해주세요.';
    msgEl.classList.add('admin-error');
    msgEl.hidden = false;
    return;
  }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });

  msgEl.classList.toggle('admin-error', !!error);
  msgEl.textContent = error
    ? '재설정 메일 발송에 실패했습니다: ' + error.message
    : '비밀번호 재설정 링크를 이메일로 보냈어요. 메일함을 확인해주세요.';
  msgEl.hidden = false;
}

// ===== 데이터 로딩 =====

async function loadDashboard() {
  const [
    { data: categories, error: catErr },
    { data: products, error: prodErr },
    { data: faqs, error: faqErr },
    { data: reviews, error: reviewErr },
  ] = await Promise.all([
    supabaseClient.from('categories').select('*').order('sort_order', { ascending: true }),
    supabaseClient.from('products').select('*').order('sort_order', { ascending: true }),
    supabaseClient.from('faqs').select('*').order('sort_order', { ascending: true }),
    supabaseClient.from('reviews').select('*').order('sort_order', { ascending: true }),
  ]);

  const err = catErr || prodErr || faqErr || reviewErr;
  if (err) {
    setStatus('데이터를 불러오지 못했습니다: ' + err.message, true);
    return;
  }

  state.categories = categories;
  state.products = products;
  state.faqs = faqs;
  state.reviews = reviews;
  renderCategoryList();
  renderCategorySelects();
  renderProductList();
  renderFaqAdminList();
  renderReviewAdminList();
}

// ===== 카테고리 렌더링 =====

function renderCategoryList() {
  const el = document.getElementById('categoryList');
  el.innerHTML = '';
  state.categories.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'admin-row';
    row.innerHTML = `
      <div class="admin-row-main">
        <strong>${escapeHtml(cat.name)}</strong>
        <span class="admin-row-sub">${escapeHtml(cat.slug)} · ${cat.status === 'active' ? '판매중' : '준비중'} · 순서 ${cat.sort_order}</span>
      </div>
      <div class="admin-row-actions">
        <button class="btn btn-outline btn-sm" data-edit-category="${cat.id}">수정</button>
        <button class="btn btn-outline btn-sm" data-delete-category="${cat.id}">삭제</button>
      </div>
    `;
    el.appendChild(row);
  });

  el.querySelectorAll('[data-edit-category]').forEach(btn => {
    btn.addEventListener('click', () => openCategoryModal(btn.dataset.editCategory));
  });
  el.querySelectorAll('[data-delete-category]').forEach(btn => {
    btn.addEventListener('click', () => deleteCategory(btn.dataset.deleteCategory));
  });
}

function renderCategorySelects() {
  const filterEl = document.getElementById('productCategoryFilter');
  const formEl = document.getElementById('productCategoryId');
  const options = state.categories.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  const prevFilter = filterEl.value;
  filterEl.innerHTML = options;
  formEl.innerHTML = options;
  if (prevFilter && state.categories.some(c => c.id === prevFilter)) {
    filterEl.value = prevFilter;
  }
}

function openCategoryModal(id) {
  const modal = document.getElementById('categoryModal');
  const cat = state.categories.find(c => c.id === id);
  document.getElementById('categoryModalTitle').textContent = cat ? '카테고리 수정' : '카테고리 추가';
  document.getElementById('categoryId').value = id || '';
  document.getElementById('categoryName').value = cat ? cat.name : '';
  document.getElementById('categorySlug').value = cat ? cat.slug : '';
  document.getElementById('categoryStatus').value = cat ? cat.status : 'active';
  document.getElementById('categorySortOrder').value = cat ? cat.sort_order : state.categories.length;
  openModal(modal);
}

async function onCategorySubmit(e) {
  e.preventDefault();
  const id = document.getElementById('categoryId').value;
  const payload = {
    name: document.getElementById('categoryName').value.trim(),
    slug: document.getElementById('categorySlug').value.trim(),
    status: document.getElementById('categoryStatus').value,
    sort_order: Number(document.getElementById('categorySortOrder').value) || 0,
  };

  const query = id
    ? supabaseClient.from('categories').update(payload).eq('id', id)
    : supabaseClient.from('categories').insert(payload);

  const { error } = await query;
  if (error) {
    setStatus('카테고리 저장 실패: ' + error.message, true);
    return;
  }
  closeModals();
  setStatus('카테고리를 저장했어요.');
  loadDashboard();
}

async function deleteCategory(id) {
  const cat = state.categories.find(c => c.id === id);
  const hasProducts = state.products.some(p => p.category_id === id);
  if (hasProducts) {
    setStatus('이 카테고리에 속한 제품이 있어 삭제할 수 없어요. 먼저 제품을 다른 카테고리로 옮기거나 비공개로 전환해주세요.', true);
    return;
  }
  if (!confirm(`"${cat ? cat.name : ''}" 카테고리를 삭제할까요?`)) return;
  const { error } = await supabaseClient.from('categories').delete().eq('id', id);
  if (error) {
    setStatus('카테고리 삭제 실패: ' + error.message, true);
    return;
  }
  setStatus('카테고리를 삭제했어요.');
  loadDashboard();
}

// ===== 제품 렌더링 =====

function renderProductList() {
  const el = document.getElementById('productList');
  const filterId = document.getElementById('productCategoryFilter').value;
  el.innerHTML = '';

  state.products.filter(p => p.category_id === filterId).forEach(product => {
    const tags = (product.certifications || []).map(c => CERT_LABELS[c] || c).join(', ');
    const row = document.createElement('div');
    row.className = 'admin-row';
    row.innerHTML = `
      <div class="admin-row-main admin-row-with-thumb">
        <img class="admin-thumb" src="${escapeHtml(product.image_url || 'assets/images/placeholder-product.svg')}" alt="${escapeHtml(product.name)}">
        <div>
          <strong>${escapeHtml(product.name)}</strong>
          <span class="admin-row-sub">${(Number(product.price) || 0).toLocaleString('ko-KR')}원 · ${PRODUCT_STATUS_LABELS[product.status] || '판매중'} ${tags ? '· ' + escapeHtml(tags) : ''}</span>
        </div>
      </div>
      <div class="admin-row-actions">
        <button class="btn btn-outline btn-sm" data-edit-product="${product.id}">수정</button>
        <button class="btn btn-outline btn-sm" data-delete-product="${product.id}">삭제</button>
      </div>
    `;
    el.appendChild(row);
  });

  el.querySelectorAll('[data-edit-product]').forEach(btn => {
    btn.addEventListener('click', () => openProductModal(btn.dataset.editProduct));
  });
  el.querySelectorAll('[data-delete-product]').forEach(btn => {
    btn.addEventListener('click', () => deleteProduct(btn.dataset.deleteProduct));
  });
}

function openProductModal(id) {
  const modal = document.getElementById('productModal');
  const product = state.products.find(p => p.id === id);

  document.getElementById('productModalTitle').textContent = product ? '제품 수정' : '제품 추가';
  document.getElementById('productId').value = id || '';
  document.getElementById('productFormError').hidden = true;

  const defaultCategoryId = document.getElementById('productCategoryFilter').value;
  document.getElementById('productCategoryId').value = product ? product.category_id : defaultCategoryId;
  document.getElementById('productName').value = product ? product.name : '';
  document.getElementById('productDescription').value = product ? product.description : '';
  document.getElementById('productIngredients').value = product ? product.ingredients : '';
  document.getElementById('productPrice').value = product ? product.price : '';
  document.getElementById('productPurchaseUrl').value = product ? product.purchase_url : 'https://smartstore.naver.com/indigo44';
  document.getElementById('productStatus').value = product ? (product.status || 'active') : 'active';
  document.getElementById('productSortOrder').value = product ? product.sort_order : 0;

  const certs = (product && product.certifications) || [];
  document.getElementById('certVegan').checked = certs.includes('vegan');
  document.getElementById('certSkinTest').checked = certs.includes('skin-test');
  document.getElementById('certHeavyMetalFree').checked = certs.includes('heavy-metal-free');
  document.getElementById('certAntibacterial').checked = certs.includes('antibacterial');

  document.getElementById('productImageFile').value = '';
  const preview = document.getElementById('productImagePreview');
  const removeBtn = document.getElementById('productImageRemoveBtn');
  if (product && product.image_url) {
    preview.src = product.image_url;
    preview.hidden = false;
    removeBtn.hidden = false;
  } else {
    preview.hidden = true;
    removeBtn.hidden = true;
  }

  modal.dataset.currentImageUrl = (product && product.image_url) || '';
  // 저장 시 이전 Storage 파일을 지우려면, "이미지 삭제" 버튼으로 currentImageUrl이
  // 비워져도 원래 값을 알 수 있어야 한다 — 모달을 여는 시점에만 고정해둔다.
  modal.dataset.originalImageUrl = (product && product.image_url) || '';
  openModal(modal);
}

function onImageFileChange(e, previewId, removeBtnId) {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById(previewId);
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  document.getElementById(removeBtnId).hidden = false;
}

function onImageRemoveClick(modalId, fileInputId, previewId, removeBtnId) {
  document.getElementById(fileInputId).value = '';
  const preview = document.getElementById(previewId);
  preview.hidden = true;
  preview.removeAttribute('src');
  document.getElementById(removeBtnId).hidden = true;
  document.getElementById(modalId).dataset.currentImageUrl = '';
}

async function onProductSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('productId').value;
  const errEl = document.getElementById('productFormError');
  const saveBtn = document.getElementById('productSaveBtn');
  errEl.hidden = true;
  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';

  try {
    const originalImageUrl = document.getElementById('productModal').dataset.originalImageUrl || '';
    let imageUrl = document.getElementById('productModal').dataset.currentImageUrl || '';
    const file = document.getElementById('productImageFile').files[0];
    if (file) {
      imageUrl = await uploadImage(file);
    }

    const certifications = [];
    if (document.getElementById('certVegan').checked) certifications.push('vegan');
    if (document.getElementById('certSkinTest').checked) certifications.push('skin-test');
    if (document.getElementById('certHeavyMetalFree').checked) certifications.push('heavy-metal-free');
    if (document.getElementById('certAntibacterial').checked) certifications.push('antibacterial');

    const payload = {
      category_id: document.getElementById('productCategoryId').value,
      name: document.getElementById('productName').value.trim(),
      description: document.getElementById('productDescription').value.trim(),
      ingredients: document.getElementById('productIngredients').value.trim(),
      price: Number(document.getElementById('productPrice').value) || 0,
      purchase_url: document.getElementById('productPurchaseUrl').value.trim(),
      status: document.getElementById('productStatus').value,
      sort_order: Number(document.getElementById('productSortOrder').value) || 0,
      certifications,
      image_url: imageUrl,
    };

    const query = id
      ? supabaseClient.from('products').update(payload).eq('id', id)
      : supabaseClient.from('products').insert(payload);

    const { error } = await query;
    if (error) throw error;

    if (originalImageUrl && originalImageUrl !== imageUrl) {
      await deleteStorageImage(originalImageUrl);
    }

    closeModals();
    setStatus('제품을 저장했어요.');
    loadDashboard();
  } catch (err) {
    errEl.textContent = '저장 실패: ' + err.message;
    errEl.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '저장';
  }
}

async function uploadImage(file) {
  const ext = file.name.split('.').pop();
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseClient.storage.from('product-images').upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabaseClient.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl;
}

async function deleteProduct(id) {
  const product = state.products.find(p => p.id === id);
  if (!confirm(`"${product ? product.name : ''}" 제품을 삭제할까요? 삭제 대신 '비공개'로 전환할 수도 있어요.`)) return;
  const { error } = await supabaseClient.from('products').delete().eq('id', id);
  if (error) {
    setStatus('제품 삭제 실패: ' + error.message, true);
    return;
  }
  if (product) await deleteStorageImage(product.image_url);
  setStatus('제품을 삭제했어요.');
  loadDashboard();
}

// ===== FAQ 렌더링 =====

function renderFaqAdminList() {
  const el = document.getElementById('faqAdminList');
  el.innerHTML = '';

  state.faqs.forEach(faq => {
    const row = document.createElement('div');
    row.className = 'admin-row';
    row.innerHTML = `
      <div class="admin-row-main">
        <strong>${escapeHtml(faq.question)}</strong>
        <span class="admin-row-sub">${faq.published === false ? '비공개 · ' : ''}${escapeHtml(faq.answer)}</span>
      </div>
      <div class="admin-row-actions">
        <button class="btn btn-outline btn-sm" data-edit-faq="${faq.id}">수정</button>
        <button class="btn btn-outline btn-sm" data-delete-faq="${faq.id}">삭제</button>
      </div>
    `;
    el.appendChild(row);
  });

  el.querySelectorAll('[data-edit-faq]').forEach(btn => {
    btn.addEventListener('click', () => openFaqModal(btn.dataset.editFaq));
  });
  el.querySelectorAll('[data-delete-faq]').forEach(btn => {
    btn.addEventListener('click', () => deleteFaq(btn.dataset.deleteFaq));
  });
}

function openFaqModal(id) {
  const modal = document.getElementById('faqModal');
  const faq = state.faqs.find(f => f.id === id);
  document.getElementById('faqModalTitle').textContent = faq ? 'FAQ 수정' : 'FAQ 추가';
  document.getElementById('faqId').value = id || '';
  document.getElementById('faqQuestion').value = faq ? faq.question : '';
  document.getElementById('faqAnswer').value = faq ? faq.answer : '';
  document.getElementById('faqSortOrder').value = faq ? faq.sort_order : state.faqs.length;
  document.getElementById('faqPublished').checked = faq ? faq.published !== false : true;
  document.getElementById('faqFormError').hidden = true;
  openModal(modal);
}

async function onFaqSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('faqId').value;
  const payload = {
    question: document.getElementById('faqQuestion').value.trim(),
    answer: document.getElementById('faqAnswer').value.trim(),
    published: document.getElementById('faqPublished').checked,
    sort_order: Number(document.getElementById('faqSortOrder').value) || 0,
  };

  const query = id
    ? supabaseClient.from('faqs').update(payload).eq('id', id)
    : supabaseClient.from('faqs').insert(payload);

  const { error } = await query;
  if (error) {
    document.getElementById('faqFormError').textContent = '저장 실패: ' + error.message;
    document.getElementById('faqFormError').hidden = false;
    return;
  }
  closeModals();
  setStatus('FAQ를 저장했어요.');
  loadDashboard();
}

async function deleteFaq(id) {
  const faq = state.faqs.find(f => f.id === id);
  if (!confirm(`"${faq ? faq.question : ''}" FAQ를 삭제할까요? 삭제 대신 '비공개'로 전환할 수도 있어요.`)) return;
  const { error } = await supabaseClient.from('faqs').delete().eq('id', id);
  if (error) {
    setStatus('FAQ 삭제 실패: ' + error.message, true);
    return;
  }
  setStatus('FAQ를 삭제했어요.');
  loadDashboard();
}

// ===== 후기 렌더링 =====

function renderReviewAdminList() {
  const el = document.getElementById('reviewAdminList');
  el.innerHTML = '';

  state.reviews.forEach(review => {
    const row = document.createElement('div');
    row.className = 'admin-row';
    const rating = clampRating(review.rating);
    row.innerHTML = `
      <div class="admin-row-main admin-row-with-thumb">
        ${review.image_url ? `<img class="admin-thumb" src="${escapeHtml(review.image_url)}" alt="${escapeHtml(review.author)}">` : ''}
        <div>
          <strong>${escapeHtml(review.author)}</strong> · ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}${review.published === false ? ' · 비공개' : ''}
          <span class="admin-row-sub">${escapeHtml(review.review_text)}</span>
        </div>
      </div>
      <div class="admin-row-actions">
        <button class="btn btn-outline btn-sm" data-edit-review="${review.id}">수정</button>
        <button class="btn btn-outline btn-sm" data-delete-review="${review.id}">삭제</button>
      </div>
    `;
    el.appendChild(row);
  });

  el.querySelectorAll('[data-edit-review]').forEach(btn => {
    btn.addEventListener('click', () => openReviewModal(btn.dataset.editReview));
  });
  el.querySelectorAll('[data-delete-review]').forEach(btn => {
    btn.addEventListener('click', () => deleteReview(btn.dataset.deleteReview));
  });
}

function openReviewModal(id) {
  const modal = document.getElementById('reviewModal');
  const review = state.reviews.find(r => r.id === id);

  document.getElementById('reviewModalTitle').textContent = review ? '후기 수정' : '후기 추가';
  document.getElementById('reviewId').value = id || '';
  document.getElementById('reviewAuthor').value = review ? review.author : '';
  document.getElementById('reviewText').value = review ? review.review_text : '';
  document.getElementById('reviewRating').value = review ? clampRating(review.rating) : 5;
  document.getElementById('reviewSortOrder').value = review ? review.sort_order : state.reviews.length;
  document.getElementById('reviewPublished').checked = review ? review.published !== false : true;
  document.getElementById('reviewImageFile').value = '';
  document.getElementById('reviewFormError').hidden = true;

  const preview = document.getElementById('reviewImagePreview');
  const removeBtn = document.getElementById('reviewImageRemoveBtn');
  if (review && review.image_url) {
    preview.src = review.image_url;
    preview.hidden = false;
    removeBtn.hidden = false;
  } else {
    preview.hidden = true;
    removeBtn.hidden = true;
  }

  modal.dataset.currentImageUrl = (review && review.image_url) || '';
  modal.dataset.originalImageUrl = (review && review.image_url) || '';
  openModal(modal);
}

async function onReviewSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('reviewId').value;
  const errEl = document.getElementById('reviewFormError');
  const saveBtn = document.getElementById('reviewSaveBtn');
  errEl.hidden = true;
  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';

  try {
    const originalImageUrl = document.getElementById('reviewModal').dataset.originalImageUrl || '';
    let imageUrl = document.getElementById('reviewModal').dataset.currentImageUrl || '';
    const file = document.getElementById('reviewImageFile').files[0];
    if (file) {
      imageUrl = await uploadImage(file);
    }

    const payload = {
      author: document.getElementById('reviewAuthor').value.trim(),
      review_text: document.getElementById('reviewText').value.trim(),
      rating: Number(document.getElementById('reviewRating').value) || 5,
      published: document.getElementById('reviewPublished').checked,
      sort_order: Number(document.getElementById('reviewSortOrder').value) || 0,
      image_url: imageUrl,
    };

    const query = id
      ? supabaseClient.from('reviews').update(payload).eq('id', id)
      : supabaseClient.from('reviews').insert(payload);

    const { error } = await query;
    if (error) throw error;

    if (originalImageUrl && originalImageUrl !== imageUrl) {
      await deleteStorageImage(originalImageUrl);
    }

    closeModals();
    setStatus('후기를 저장했어요.');
    loadDashboard();
  } catch (err) {
    errEl.textContent = '저장 실패: ' + err.message;
    errEl.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '저장';
  }
}

async function deleteReview(id) {
  const review = state.reviews.find(r => r.id === id);
  if (!confirm(`"${review ? review.author : ''}" 님의 후기를 삭제할까요? 삭제 대신 '비공개'로 전환할 수도 있어요.`)) return;
  const { error } = await supabaseClient.from('reviews').delete().eq('id', id);
  if (error) {
    setStatus('후기 삭제 실패: ' + error.message, true);
    return;
  }
  if (review) await deleteStorageImage(review.image_url);
  setStatus('후기를 삭제했어요.');
  loadDashboard();
}
