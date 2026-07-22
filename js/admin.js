// ===== 인디고44 관리자 페이지 =====

const CERT_LABELS = {
  vegan: '비건 인증',
  'skin-test': '피부자극 테스트 인증',
  'heavy-metal-free': '무중금속 인증',
  antibacterial: '항균테스트 인증'
};

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

  document.getElementById('addCategoryBtn').addEventListener('click', () => openCategoryModal());
  document.getElementById('addProductBtn').addEventListener('click', () => openProductModal());
  document.getElementById('productCategoryFilter').addEventListener('change', renderProductList);

  document.getElementById('categoryForm').addEventListener('submit', onCategorySubmit);
  document.getElementById('productForm').addEventListener('submit', onProductSubmit);
  document.getElementById('productImageFile').addEventListener('change', (e) => onImageFileChange(e, 'productImagePreview'));

  document.getElementById('addFaqBtn').addEventListener('click', () => openFaqModal());
  document.getElementById('faqForm').addEventListener('submit', onFaqSubmit);

  document.getElementById('addReviewBtn').addEventListener('click', () => openReviewModal());
  document.getElementById('reviewForm').addEventListener('submit', onReviewSubmit);
  document.getElementById('reviewImageFile').addEventListener('change', (e) => onImageFileChange(e, 'reviewImagePreview'));

  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModals());
  });
}

function closeModals() {
  document.getElementById('categoryModal').hidden = true;
  document.getElementById('productModal').hidden = true;
  document.getElementById('faqModal').hidden = true;
  document.getElementById('reviewModal').hidden = true;
}

// ===== 인증 =====

async function onLoginSubmit(e) {
  e.preventDefault();
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
        <strong>${cat.name}</strong>
        <span class="admin-row-sub">${cat.slug} · ${cat.status === 'active' ? '판매중' : '준비중'} · 순서 ${cat.sort_order}</span>
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
  const options = state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
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
  modal.hidden = false;
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
  if (!confirm('이 카테고리를 삭제하면 소속된 제품도 함께 삭제돼요. 계속할까요?')) return;
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
        <img class="admin-thumb" src="${product.image_url || 'assets/images/placeholder-product.svg'}" alt="${product.name}">
        <div>
          <strong>${product.name}</strong>
          <span class="admin-row-sub">${product.price.toLocaleString('ko-KR')}원 ${tags ? '· ' + tags : ''}</span>
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
  document.getElementById('productSortOrder').value = product ? product.sort_order : 0;

  const certs = (product && product.certifications) || [];
  document.getElementById('certVegan').checked = certs.includes('vegan');
  document.getElementById('certSkinTest').checked = certs.includes('skin-test');
  document.getElementById('certHeavyMetalFree').checked = certs.includes('heavy-metal-free');
  document.getElementById('certAntibacterial').checked = certs.includes('antibacterial');

  document.getElementById('productImageFile').value = '';
  const preview = document.getElementById('productImagePreview');
  if (product && product.image_url) {
    preview.src = product.image_url;
    preview.hidden = false;
  } else {
    preview.hidden = true;
  }

  modal.dataset.currentImageUrl = (product && product.image_url) || '';
  modal.hidden = false;
}

function onImageFileChange(e, previewId) {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById(previewId);
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
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
      sort_order: Number(document.getElementById('productSortOrder').value) || 0,
      certifications,
      image_url: imageUrl,
    };

    const query = id
      ? supabaseClient.from('products').update(payload).eq('id', id)
      : supabaseClient.from('products').insert(payload);

    const { error } = await query;
    if (error) throw error;

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
  if (!confirm('이 제품을 삭제할까요?')) return;
  const { error } = await supabaseClient.from('products').delete().eq('id', id);
  if (error) {
    setStatus('제품 삭제 실패: ' + error.message, true);
    return;
  }
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
        <strong>${faq.question}</strong>
        <span class="admin-row-sub">${faq.answer}</span>
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
  document.getElementById('faqFormError').hidden = true;
  modal.hidden = false;
}

async function onFaqSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('faqId').value;
  const payload = {
    question: document.getElementById('faqQuestion').value.trim(),
    answer: document.getElementById('faqAnswer').value.trim(),
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
  if (!confirm('이 FAQ를 삭제할까요?')) return;
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
    row.innerHTML = `
      <div class="admin-row-main admin-row-with-thumb">
        ${review.image_url ? `<img class="admin-thumb" src="${review.image_url}" alt="${review.author}">` : ''}
        <div>
          <strong>${review.author}</strong> · ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}
          <span class="admin-row-sub">${review.review_text}</span>
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
  document.getElementById('reviewRating').value = review ? review.rating : 5;
  document.getElementById('reviewSortOrder').value = review ? review.sort_order : state.reviews.length;
  document.getElementById('reviewImageFile').value = '';
  document.getElementById('reviewFormError').hidden = true;

  const preview = document.getElementById('reviewImagePreview');
  if (review && review.image_url) {
    preview.src = review.image_url;
    preview.hidden = false;
  } else {
    preview.hidden = true;
  }

  modal.dataset.currentImageUrl = (review && review.image_url) || '';
  modal.hidden = false;
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
    let imageUrl = document.getElementById('reviewModal').dataset.currentImageUrl || '';
    const file = document.getElementById('reviewImageFile').files[0];
    if (file) {
      imageUrl = await uploadImage(file);
    }

    const payload = {
      author: document.getElementById('reviewAuthor').value.trim(),
      review_text: document.getElementById('reviewText').value.trim(),
      rating: Number(document.getElementById('reviewRating').value) || 5,
      sort_order: Number(document.getElementById('reviewSortOrder').value) || 0,
      image_url: imageUrl,
    };

    const query = id
      ? supabaseClient.from('reviews').update(payload).eq('id', id)
      : supabaseClient.from('reviews').insert(payload);

    const { error } = await query;
    if (error) throw error;

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
  if (!confirm('이 후기를 삭제할까요?')) return;
  const { error } = await supabaseClient.from('reviews').delete().eq('id', id);
  if (error) {
    setStatus('후기 삭제 실패: ' + error.message, true);
    return;
  }
  setStatus('후기를 삭제했어요.');
  loadDashboard();
}
