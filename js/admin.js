// ===== 인디고44 관리자 페이지 =====

const CERT_LABELS = {
  vegan: '비건 인증',
  'skin-test': '피부자극 테스트 인증',
  'heavy-metal-free': '무중금속 인증',
  antibacterial: '항균테스트 인증',
  'mild-acidic': '약산성'
};

const PRODUCT_STATUS_LABELS = {
  active: '판매중',
  'sold-out': '품절',
  'coming-soon': '준비중',
  hidden: '비공개'
};

const NOTICE_TYPE_LABELS = {
  general: '일반',
  shipping: '배송',
  product: '제품',
  event: '이벤트',
  important: '중요'
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

// ===== 이미지 업로드 최적화 =====

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 720;
const IMAGE_JPEG_QUALITY = 0.82;
const IMAGE_BACKGROUND_COLOR = '#F1EFE4'; // 홈페이지 배경색 (AGENTS.md --color-bg)

// 선택한 원본 파일을 검증한 뒤, 720px 이하로 축소하고 JPEG(품질 0.82)로 변환합니다.
// 투명 영역은 홈페이지 배경색으로 채우고, EXIF 방향은 createImageBitmap이 자동 보정합니다.
async function optimizeImage(file) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('JPEG, PNG, WebP 형식의 이미지만 업로드할 수 있어요.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('이미지 용량은 10MB를 넘을 수 없어요.');
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    throw new Error('이미지를 읽지 못했어요. 다른 파일을 선택해주세요.');
  }

  try {
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const targetW = Math.max(1, Math.round(bitmap.width * scale));
    const targetH = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = IMAGE_BACKGROUND_COLOR;
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('이미지 변환에 실패했어요.'))),
        'image/jpeg',
        IMAGE_JPEG_QUALITY
      );
    });

    return new File([blob], 'upload.jpg', { type: 'image/jpeg' });
  } finally {
    bitmap.close?.();
  }
}

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

// 성공 시 true, 삭제 대상이 아니었으면 true(스킵), 실패했으면 false를 반환합니다.
// 절대 throw하지 않습니다 — 호출부(onProductSubmit/onReviewSubmit)의 catch가
// "DB 저장 실패"로 오인해 이미 저장된 이미지를 잘못 지우는 일을 막기 위함입니다.
// storagePathFromUrl 호출(내부 decodeURIComponent가 깨진 URL에서 throw할 수 있음)부터
// Storage remove 완료까지 전체를 try로 감싸 이 함수 밖으로 예외가 새어나가지 않게 합니다.
async function deleteStorageImage(url) {
  try {
    const path = storagePathFromUrl(url);
    if (!path) return true;
    const { error } = await supabaseClient.storage.from(STORAGE_BUCKET).remove([path]);
    if (error) {
      console.warn('Storage 이미지 삭제 실패:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Storage 이미지 삭제 중 예외가 발생했습니다:', err && err.message);
    return false;
  }
}

async function uploadImage(file) {
  const path = `${crypto.randomUUID()}.jpg`;
  const { error } = await supabaseClient.storage.from(STORAGE_BUCKET).upload(path, file, {
    upsert: false,
    contentType: 'image/jpeg',
  });
  if (error) throw error;
  const { data } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// ===== 구매 링크 검증 =====

function isSafePurchaseUrl(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ===== 날짜 변환 (공지사항) =====

// datetime-local input은 로컬 타임존 기준 "YYYY-MM-DDTHH:mm" 문자열을 준다.
// new Date()에 그대로 넘기면 브라우저가 로컬 타임존으로 해석해 안전하게
// UTC ISO(timestamptz 저장용) 문자열로 바꿀 수 있다. 값이 비어 있으면 null.
function datetimeLocalToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// DB의 timestamptz(ISO)를 datetime-local input에 넣을 "YYYY-MM-DDTHH:mm" 문자열로 변환.
function isoToDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 목록에 보여줄 때는 Asia/Seoul 기준으로 읽기 쉽게 표시.
function formatNoticeDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

const views = {
  login: document.getElementById('loginView'),
  setPassword: document.getElementById('setPasswordView'),
  dashboard: document.getElementById('dashboardView'),
};

let state = { categories: [], products: [], faqs: [], reviews: [], notices: [] };

// 이번 세션에서 선택 후 최적화까지 끝낸 파일(모달별). 저장 시 업로드 대상입니다.
const pendingImageFile = { productModal: null, reviewModal: null };
// 미리보기에 사용 중인 Object URL(모달별). 정리 대상 추적용입니다.
const previewObjectUrls = { productModal: null, reviewModal: null };

function revokePreviewUrl(modalKey) {
  if (previewObjectUrls[modalKey]) {
    URL.revokeObjectURL(previewObjectUrls[modalKey]);
    previewObjectUrls[modalKey] = null;
  }
}

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
  el.setAttribute('role', isError ? 'alert' : 'status');
  el.setAttribute('aria-live', isError ? 'assertive' : 'polite');
}

function showFormError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

function hideFormError(el) {
  el.hidden = true;
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
  document.getElementById('productImageFile').addEventListener('change', (e) => onImageFileChange(e, 'productImagePreview', 'productImageRemoveBtn', 'productModal'));
  document.getElementById('productImageRemoveBtn').addEventListener('click', () => onImageRemoveClick('productModal', 'productImageFile', 'productImagePreview', 'productImageRemoveBtn'));

  document.getElementById('addFaqBtn').addEventListener('click', () => openFaqModal());
  document.getElementById('faqForm').addEventListener('submit', onFaqSubmit);

  document.getElementById('addReviewBtn').addEventListener('click', () => openReviewModal());
  document.getElementById('reviewForm').addEventListener('submit', onReviewSubmit);
  document.getElementById('reviewImageFile').addEventListener('change', (e) => onImageFileChange(e, 'reviewImagePreview', 'reviewImageRemoveBtn', 'reviewModal'));
  document.getElementById('reviewImageRemoveBtn').addEventListener('click', () => onImageRemoveClick('reviewModal', 'reviewImageFile', 'reviewImagePreview', 'reviewImageRemoveBtn'));

  document.getElementById('addNoticeBtn').addEventListener('click', () => openNoticeModal());
  document.getElementById('noticeForm').addEventListener('submit', onNoticeSubmit);

  document.getElementById('backupBtn').addEventListener('click', onBackupClick);

  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModals(false));
  });

  document.addEventListener('keydown', onModalKeydown);

  // 모달에 저장하지 않은 변경 사항이 있을 때만 실제 페이지 이탈을 경고합니다.
  // 정상 저장 후에는 모달이 닫히므로(getOpenModal() === null) 자동으로 해제됩니다.
  window.addEventListener('beforeunload', (e) => {
    const modal = getOpenModal();
    if (modal && isModalDirty(modal.id)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// hidden input(id 필드)·비활성/숨김 요소는 포커스 대상에서 제외하고,
// 실제로 보이고 사용 가능한 입력 요소만 남깁니다.
const MODAL_FOCUSABLE_SELECTOR = [
  'input:not([type="hidden"]):not([disabled]):not([hidden]):not([tabindex="-1"])',
  'select:not([disabled]):not([hidden]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([hidden]):not([tabindex="-1"])',
  'button:not([disabled]):not([hidden]):not([tabindex="-1"])',
  '[href]:not([hidden]):not([tabindex="-1"])',
].join(', ');
let modalLastFocus = null;

function getOpenModal() {
  return document.querySelector('.admin-modal:not([hidden])');
}

// ===== 저장하지 않은 변경 감지 (모든 모달 공통) =====

const modalBaseline = {};

function snapshotModalForm(modal) {
  const form = modal.querySelector('form');
  if (!form) return '';
  const parts = Array.from(form.elements).map(el => {
    if (!el.id) return '';
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? '1' : '0';
    if (el.type === 'file') return el.files && el.files.length ? `${el.files[0].name}:${el.files[0].size}` : '';
    return el.value;
  });
  parts.push('img:' + (modal.dataset.currentImageUrl || ''));
  return parts.join('§');
}

function setModalBaseline(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modalBaseline[modalId] = snapshotModalForm(modal);
}

function isModalDirty(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal || modal.hidden) return false;
  const baseline = modalBaseline[modalId];
  if (baseline == null) return false;
  return snapshotModalForm(modal) !== baseline;
}

function openModal(modal) {
  modalLastFocus = document.activeElement;
  modal.hidden = false;
  // 필드 값을 다 채운 뒤 모달이 보이는 시점의 상태를 "저장 기준선"으로 남긴다.
  setModalBaseline(modal.id);
  const focusable = modal.querySelectorAll(MODAL_FOCUSABLE_SELECTOR);
  if (focusable.length) focusable[0].focus();
}

// force=true면 변경 여부와 관계없이 확인창 없이 닫는다 (저장 성공 직후 등).
// 반환값 false는 "사용자가 닫기를 취소했다"는 뜻이다.
function closeModals(force) {
  const openModalEl = getOpenModal();
  if (openModalEl && !force && isModalDirty(openModalEl.id)) {
    if (!confirm('저장하지 않은 변경 사항이 있습니다. 닫을까요?')) return false;
  }

  document.getElementById('categoryModal').hidden = true;
  document.getElementById('productModal').hidden = true;
  document.getElementById('faqModal').hidden = true;
  document.getElementById('reviewModal').hidden = true;
  document.getElementById('noticeModal').hidden = true;

  revokePreviewUrl('productModal');
  revokePreviewUrl('reviewModal');
  pendingImageFile.productModal = null;
  pendingImageFile.reviewModal = null;

  if (modalLastFocus) {
    modalLastFocus.focus();
    modalLastFocus = null;
  }
  return true;
}

function onModalKeydown(e) {
  const modal = getOpenModal();
  if (!modal) return;

  if (e.key === 'Escape') {
    closeModals(false);
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
  hideFormError(errEl);

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    showFormError(errEl, '로그인에 실패했습니다: ' + error.message);
  }
}

async function onSetPasswordSubmit(e) {
  e.preventDefault();
  if (!supabaseClient) return;
  const pw = document.getElementById('newPassword').value;
  const pwConfirm = document.getElementById('newPasswordConfirm').value;
  const errEl = document.getElementById('setPasswordError');
  hideFormError(errEl);

  if (pw !== pwConfirm) {
    showFormError(errEl, '비밀번호가 서로 달라요. 다시 확인해주세요.');
    return;
  }

  const { error } = await supabaseClient.auth.updateUser({ password: pw });
  if (error) {
    showFormError(errEl, '비밀번호 설정에 실패했습니다: ' + error.message);
    return;
  }
  showView('dashboard');
  loadDashboard();
}

function isValidEmailFormat(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function onForgotPassword() {
  if (!supabaseClient) return;
  const btn = document.getElementById('forgotPasswordBtn');
  if (btn.disabled) return;

  const email = document.getElementById('loginEmail').value.trim();
  const msgEl = document.getElementById('forgotPasswordMsg');

  if (!email || !isValidEmailFormat(email)) {
    msgEl.textContent = email ? '올바른 이메일 형식을 입력해주세요.' : '먼저 이메일을 입력해주세요.';
    msgEl.classList.add('admin-error');
    msgEl.setAttribute('role', 'alert');
    msgEl.setAttribute('aria-live', 'assertive');
    msgEl.hidden = false;
    return;
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '발송 중...';

  try {
    // origin은 로컬 개발 서버에서는 현재 로컬 주소로, 운영 배포본에서는
    // https://indigo44.co.kr로 자동 해석되므로 별도 분기 없이 안전하게 동작합니다.
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });

    msgEl.classList.toggle('admin-error', !!error);
    msgEl.setAttribute('role', error ? 'alert' : 'status');
    msgEl.setAttribute('aria-live', error ? 'assertive' : 'polite');
    msgEl.textContent = error
      ? '재설정 메일 발송에 실패했습니다: ' + error.message
      : '비밀번호 재설정 링크를 이메일로 보냈어요. 메일함을 확인해주세요.';
    msgEl.hidden = false;
  } catch (err) {
    // 네트워크 예외 등 supabase-js가 error 객체 대신 예외를 던지는 경우까지 포함.
    msgEl.classList.add('admin-error');
    msgEl.setAttribute('role', 'alert');
    msgEl.setAttribute('aria-live', 'assertive');
    msgEl.textContent = '재설정 메일 발송 중 오류가 발생했습니다: ' + (err && err.message ? err.message : err);
    msgEl.hidden = false;
  } finally {
    // 성공하든 실패하든 버튼은 반드시 원래 상태로 돌아온다.
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// ===== 데이터 로딩 =====

let dashboardLoadToken = 0;
let isDashboardLoading = false;

const ROW_ACTION_SELECTOR = [
  '[data-edit-category]', '[data-delete-category]',
  '[data-edit-product]', '[data-delete-product]',
  '[data-edit-faq]', '[data-delete-faq]',
  '[data-edit-review]', '[data-delete-review]',
  '[data-edit-notice]', '[data-delete-notice]',
].join(', ');

function setDashboardLoading(isLoading) {
  isDashboardLoading = isLoading;
  document.getElementById('dashboardLoading').hidden = !isLoading;
  document.getElementById('addCategoryBtn').disabled = isLoading;
  document.getElementById('addFaqBtn').disabled = isLoading;
  document.getElementById('addReviewBtn').disabled = isLoading;
  if (isLoading) {
    // addProductBtn/addNoticeBtn은 로딩이 끝났다고 무조건 다시 켜면 안 된다
    // ("카테고리 없음"/"공지 테이블 없음" 같은 실패 상태를 되돌려버리므로).
    // 로딩 시작 시에만 강제로 끄고, 다시 켜는 책임은 각각
    // updateProductControlsAvailability()와 loadDashboard의 공지사항 처리
    // 분기(성공 시에만 활성화)에 맡긴다.
    document.getElementById('addProductBtn').disabled = true;
    document.getElementById('addNoticeBtn').disabled = true;
  }
  // 로딩 중에는 지금 화면에 남아 있는(다음 렌더 전) 기존 목록의 수정·삭제
  // 버튼도 눌리지 않게 막는다. 로딩이 끝나면 각 목록이 새로 렌더링되며
  // 자연스럽게 활성 상태로 돌아온다.
  document.querySelectorAll(ROW_ACTION_SELECTOR).forEach(btn => { btn.disabled = isLoading; });
}

// 카테고리가 하나도 없으면 제품 추가를 막고 안내 문구를 보여줍니다.
function updateProductControlsAvailability() {
  const noCategories = state.categories.length === 0;
  document.getElementById('addProductBtn').disabled = noCategories;
  document.getElementById('addProductHint').hidden = !noCategories;
  document.getElementById('productCategoryFilter').disabled = noCategories;
}

function renderLoadError() {
  const msg = '<p class="admin-empty admin-error" role="alert">데이터를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.</p>';
  document.getElementById('categoryList').innerHTML = msg;
  document.getElementById('productList').innerHTML = msg;
  document.getElementById('faqAdminList').innerHTML = msg;
  document.getElementById('reviewAdminList').innerHTML = msg;
  document.getElementById('noticeAdminList').innerHTML = msg;
}

// notices 테이블이 아직 생성되지 않은 경우(sql/2026-09-01-site-notices.sql 미적용)를
// 다른 오류와 구분해 안내한다.
function renderNoticeLoadIssue(err) {
  const el = document.getElementById('noticeAdminList');
  const missingTable = err && (
    err.code === '42P01' || err.code === 'PGRST205'
    || /relation .* does not exist/i.test(err.message || '')
    || /could not find the table/i.test(err.message || '')
  );
  el.innerHTML = missingTable
    ? '<p class="admin-empty admin-error" role="alert">공지사항 테이블이 아직 없습니다. sql/2026-09-01-site-notices.sql을 Supabase SQL Editor에서 실행해주세요.</p>'
    : `<p class="admin-empty admin-error" role="alert">공지사항을 불러오지 못했습니다: ${escapeHtml(err ? err.message : '')}</p>`;
  document.getElementById('addNoticeBtn').disabled = true;
  console.warn('공지사항 조회 실패:', err && err.message);
}

async function loadDashboard() {
  const token = ++dashboardLoadToken;
  setDashboardLoading(true);

  const [
    { data: categories, error: catErr },
    { data: products, error: prodErr },
    { data: faqs, error: faqErr },
    { data: reviews, error: reviewErr },
    { data: notices, error: noticeErr },
  ] = await Promise.all([
    supabaseClient.from('categories').select('*').order('sort_order', { ascending: true }),
    supabaseClient.from('products').select('*').order('sort_order', { ascending: true }),
    supabaseClient.from('faqs').select('*').order('sort_order', { ascending: true }),
    supabaseClient.from('reviews').select('*').order('sort_order', { ascending: true }),
    supabaseClient.from('site_notices').select('*').order('sort_order', { ascending: true }),
  ]);

  // 이 응답이 도착하는 사이 더 최신 loadDashboard 호출이 있었다면 이 결과는 버립니다.
  if (token !== dashboardLoadToken) return;

  const err = catErr || prodErr || faqErr || reviewErr;
  if (err) {
    setDashboardLoading(false);
    setStatus('데이터를 불러오지 못했습니다: ' + err.message, true);
    renderLoadError();
    return;
  }

  state.categories = categories || [];
  state.products = products || [];
  state.faqs = faqs || [];
  state.reviews = reviews || [];

  renderCategoryList();
  renderCategorySelects();
  renderProductList();
  renderFaqAdminList();
  renderReviewAdminList();

  if (noticeErr) {
    state.notices = [];
    renderNoticeLoadIssue(noticeErr);
  } else {
    state.notices = notices || [];
    document.getElementById('addNoticeBtn').disabled = false;
    renderNoticeAdminList();
  }

  updateProductControlsAvailability();
  setDashboardLoading(false);
}

// ===== 삭제 중복 클릭 방지 =====

const deleteInProgress = new Set();

// ===== 카테고리 렌더링 =====

function renderCategoryList() {
  const el = document.getElementById('categoryList');

  if (state.categories.length === 0) {
    el.innerHTML = '<p class="admin-empty">등록된 카테고리가 없습니다. 카테고리를 추가해주세요.</p>';
    return;
  }

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
  if (isDashboardLoading) return;
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
  const saveBtn = document.getElementById('categorySaveBtn');
  if (saveBtn.disabled) return;

  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';

  try {
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
    if (error) throw error;

    closeModals(true);
    setStatus('카테고리를 저장했어요.');
    loadDashboard();
  } catch (err) {
    setStatus('카테고리 저장 실패: ' + err.message, true);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '저장';
  }
}

async function deleteCategory(id) {
  if (isDashboardLoading || deleteInProgress.has(id)) return;
  const cat = state.categories.find(c => c.id === id);
  const hasProducts = state.products.some(p => p.category_id === id);
  if (hasProducts) {
    setStatus('이 카테고리에 속한 제품이 있어 삭제할 수 없어요. 먼저 제품을 다른 카테고리로 옮기거나 비공개로 전환해주세요.', true);
    return;
  }
  if (!confirm(`"${cat ? cat.name : ''}" 카테고리를 삭제할까요?`)) return;

  deleteInProgress.add(id);
  try {
    const { error } = await supabaseClient.from('categories').delete().eq('id', id);
    if (error) {
      setStatus('카테고리 삭제 실패: ' + error.message, true);
      return;
    }
    setStatus('카테고리를 삭제했어요.');
    loadDashboard();
  } finally {
    deleteInProgress.delete(id);
  }
}

// ===== 제품 렌더링 =====

function renderProductList() {
  const el = document.getElementById('productList');
  const filterId = document.getElementById('productCategoryFilter').value;

  if (state.categories.length === 0) {
    el.innerHTML = '<p class="admin-empty">먼저 카테고리를 추가해주세요.</p>';
    return;
  }

  const filtered = state.products.filter(p => p.category_id === filterId);
  if (filtered.length === 0) {
    el.innerHTML = '<p class="admin-empty">이 카테고리에 등록된 제품이 없습니다.</p>';
    return;
  }

  el.innerHTML = '';
  filtered.forEach(product => {
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
  if (isDashboardLoading) return;
  const modal = document.getElementById('productModal');
  const product = state.products.find(p => p.id === id);

  document.getElementById('productModalTitle').textContent = product ? '제품 수정' : '제품 추가';
  document.getElementById('productId').value = id || '';
  hideFormError(document.getElementById('productFormError'));

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
  document.getElementById('certMildAcidic').checked = certs.includes('mild-acidic');

  revokePreviewUrl('productModal');
  pendingImageFile.productModal = null;
  document.getElementById('productImageFile').value = '';
  const preview = document.getElementById('productImagePreview');
  const removeBtn = document.getElementById('productImageRemoveBtn');
  if (product && product.image_url) {
    preview.src = product.image_url;
    preview.hidden = false;
    removeBtn.hidden = false;
  } else {
    preview.hidden = true;
    preview.removeAttribute('src');
    removeBtn.hidden = true;
  }

  modal.dataset.currentImageUrl = (product && product.image_url) || '';
  // 저장 시 이전 Storage 파일을 지우려면, "이미지 삭제" 버튼으로 currentImageUrl이
  // 비워져도 원래 값을 알 수 있어야 한다 — 모달을 여는 시점에만 고정해둔다.
  modal.dataset.originalImageUrl = (product && product.image_url) || '';
  openModal(modal);
}

async function onImageFileChange(e, previewId, removeBtnId, modalKey) {
  const input = e.target;
  const file = input.files[0];
  if (!file) return;

  const errEl = document.getElementById(modalKey === 'productModal' ? 'productFormError' : 'reviewFormError');
  hideFormError(errEl);

  try {
    const optimized = await optimizeImage(file);
    revokePreviewUrl(modalKey);
    const url = URL.createObjectURL(optimized);
    previewObjectUrls[modalKey] = url;
    pendingImageFile[modalKey] = optimized;

    const preview = document.getElementById(previewId);
    preview.src = url;
    preview.hidden = false;
    document.getElementById(removeBtnId).hidden = false;
  } catch (err) {
    input.value = '';
    showFormError(errEl, err.message || '이미지를 처리하지 못했어요.');
  }
}

function onImageRemoveClick(modalId, fileInputId, previewId, removeBtnId) {
  document.getElementById(fileInputId).value = '';
  revokePreviewUrl(modalId);
  pendingImageFile[modalId] = null;
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
  if (saveBtn.disabled) return;
  hideFormError(errEl);

  const status = document.getElementById('productStatus').value;
  const purchaseUrl = document.getElementById('productPurchaseUrl').value.trim();

  if (status === 'active' && !purchaseUrl) {
    showFormError(errEl, '판매중 제품은 구매 링크가 꼭 필요해요.');
    return;
  }
  if (purchaseUrl && !isSafePurchaseUrl(purchaseUrl)) {
    showFormError(errEl, 'http:// 또는 https://로 시작하는 올바른 구매 링크를 입력해주세요.');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';

  let newUploadedUrl = null;
  // DB insert/update가 실제로 성공했는지 별도로 추적한다. deleteStorageImage는
  // 더 이상 throw하지 않지만, 혹시 이 시점 이후 다른 예외가 나더라도 이미
  // 저장에 성공한 새 이미지를 "실패 정리" 경로에서 실수로 지우지 않기 위함.
  let dbSaveSucceeded = false;
  try {
    const originalImageUrl = document.getElementById('productModal').dataset.originalImageUrl || '';
    let imageUrl = document.getElementById('productModal').dataset.currentImageUrl || '';
    const pendingFile = pendingImageFile.productModal;
    if (pendingFile) {
      imageUrl = await uploadImage(pendingFile);
      newUploadedUrl = imageUrl;
    }

    const certifications = [];
    if (document.getElementById('certVegan').checked) certifications.push('vegan');
    if (document.getElementById('certSkinTest').checked) certifications.push('skin-test');
    if (document.getElementById('certHeavyMetalFree').checked) certifications.push('heavy-metal-free');
    if (document.getElementById('certAntibacterial').checked) certifications.push('antibacterial');
    if (document.getElementById('certMildAcidic').checked) certifications.push('mild-acidic');

    const payload = {
      category_id: document.getElementById('productCategoryId').value,
      name: document.getElementById('productName').value.trim(),
      description: document.getElementById('productDescription').value.trim(),
      ingredients: document.getElementById('productIngredients').value.trim(),
      price: Number(document.getElementById('productPrice').value) || 0,
      purchase_url: purchaseUrl,
      status,
      sort_order: Number(document.getElementById('productSortOrder').value) || 0,
      certifications,
      image_url: imageUrl,
    };

    const query = id
      ? supabaseClient.from('products').update(payload).eq('id', id)
      : supabaseClient.from('products').insert(payload);

    const { error } = await query;
    if (error) throw error;
    dbSaveSucceeded = true;

    let cleanupWarning = false;
    if (originalImageUrl && originalImageUrl !== imageUrl) {
      const ok = await deleteStorageImage(originalImageUrl);
      if (!ok) cleanupWarning = true;
    }

    closeModals(true);
    setStatus(cleanupWarning ? '제품을 저장했지만 이전 이미지 정리에 실패했습니다.' : '제품을 저장했어요.', cleanupWarning);
    loadDashboard();
  } catch (err) {
    if (dbSaveSucceeded) {
      // DB 저장 자체는 성공한 뒤에 발생한 예외다 — 새로 올린 이미지는 이미
      // 저장된 값이므로 여기서 지우면 안 된다. "저장 실패"로 잘못 안내하지도 않는다.
      console.warn('제품 저장 후 처리 중 오류:', err);
      closeModals(true);
      setStatus('제품을 저장했지만 이후 처리 중 문제가 발생했습니다: ' + err.message, true);
      loadDashboard();
    } else {
      // DB 저장이 실패했다면, 이번 라운드에 새로 업로드한 파일만 정리한다.
      // 기존에 있던 이미지는 절대 건드리지 않는다.
      if (newUploadedUrl) {
        const cleanedUp = await deleteStorageImage(newUploadedUrl);
        if (!cleanedUp) {
          console.warn('신규 업로드 이미지 정리 실패:', newUploadedUrl);
          showFormError(errEl, '데이터 저장에 실패했고 업로드된 이미지 정리도 완료하지 못했습니다. Storage를 확인해주세요.');
          saveBtn.disabled = false;
          saveBtn.textContent = '저장';
          return;
        }
      }
      showFormError(errEl, '저장 실패: ' + err.message);
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '저장';
  }
}

async function deleteProduct(id) {
  if (isDashboardLoading || deleteInProgress.has(id)) return;
  const product = state.products.find(p => p.id === id);
  if (!confirm(`"${product ? product.name : ''}" 제품을 삭제할까요? 삭제 대신 '비공개'로 전환할 수도 있어요.`)) return;

  deleteInProgress.add(id);
  try {
    const { error } = await supabaseClient.from('products').delete().eq('id', id);
    if (error) {
      setStatus('제품 삭제 실패: ' + error.message, true);
      return;
    }
    let cleanupWarning = false;
    if (product && product.image_url) {
      const ok = await deleteStorageImage(product.image_url);
      if (!ok) cleanupWarning = true;
    }
    setStatus(cleanupWarning ? '데이터는 삭제됐지만 이미지 정리에 실패했습니다.' : '제품을 삭제했어요.', cleanupWarning);
    loadDashboard();
  } finally {
    deleteInProgress.delete(id);
  }
}

// ===== FAQ 렌더링 =====

function renderFaqAdminList() {
  const el = document.getElementById('faqAdminList');

  if (state.faqs.length === 0) {
    el.innerHTML = '<p class="admin-empty">등록된 FAQ가 없습니다.</p>';
    return;
  }

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
  if (isDashboardLoading) return;
  const modal = document.getElementById('faqModal');
  const faq = state.faqs.find(f => f.id === id);
  document.getElementById('faqModalTitle').textContent = faq ? 'FAQ 수정' : 'FAQ 추가';
  document.getElementById('faqId').value = id || '';
  document.getElementById('faqQuestion').value = faq ? faq.question : '';
  document.getElementById('faqAnswer').value = faq ? faq.answer : '';
  document.getElementById('faqSortOrder').value = faq ? faq.sort_order : state.faqs.length;
  document.getElementById('faqPublished').checked = faq ? faq.published !== false : true;
  hideFormError(document.getElementById('faqFormError'));
  openModal(modal);
}

async function onFaqSubmit(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('faqSaveBtn');
  if (saveBtn.disabled) return;
  const errEl = document.getElementById('faqFormError');
  hideFormError(errEl);

  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';

  try {
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
    if (error) throw error;

    closeModals(true);
    setStatus('FAQ를 저장했어요.');
    loadDashboard();
  } catch (err) {
    showFormError(errEl, '저장 실패: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '저장';
  }
}

async function deleteFaq(id) {
  if (isDashboardLoading || deleteInProgress.has(id)) return;
  const faq = state.faqs.find(f => f.id === id);
  if (!confirm(`"${faq ? faq.question : ''}" FAQ를 삭제할까요? 삭제 대신 '비공개'로 전환할 수도 있어요.`)) return;

  deleteInProgress.add(id);
  try {
    const { error } = await supabaseClient.from('faqs').delete().eq('id', id);
    if (error) {
      setStatus('FAQ 삭제 실패: ' + error.message, true);
      return;
    }
    setStatus('FAQ를 삭제했어요.');
    loadDashboard();
  } finally {
    deleteInProgress.delete(id);
  }
}

// ===== 후기 렌더링 =====

function renderReviewAdminList() {
  const el = document.getElementById('reviewAdminList');

  if (state.reviews.length === 0) {
    el.innerHTML = '<p class="admin-empty">등록된 후기가 없습니다.</p>';
    return;
  }

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
  if (isDashboardLoading) return;
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
  hideFormError(document.getElementById('reviewFormError'));

  revokePreviewUrl('reviewModal');
  pendingImageFile.reviewModal = null;

  const preview = document.getElementById('reviewImagePreview');
  const removeBtn = document.getElementById('reviewImageRemoveBtn');
  if (review && review.image_url) {
    preview.src = review.image_url;
    preview.hidden = false;
    removeBtn.hidden = false;
  } else {
    preview.hidden = true;
    preview.removeAttribute('src');
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
  if (saveBtn.disabled) return;
  hideFormError(errEl);

  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';

  let newUploadedUrl = null;
  // DB insert/update가 실제로 성공했는지 별도로 추적한다. deleteStorageImage는
  // 더 이상 throw하지 않지만, 혹시 이 시점 이후 다른 예외가 나더라도 이미
  // 저장에 성공한 새 이미지를 "실패 정리" 경로에서 실수로 지우지 않기 위함.
  let dbSaveSucceeded = false;
  try {
    const originalImageUrl = document.getElementById('reviewModal').dataset.originalImageUrl || '';
    let imageUrl = document.getElementById('reviewModal').dataset.currentImageUrl || '';
    const pendingFile = pendingImageFile.reviewModal;
    if (pendingFile) {
      imageUrl = await uploadImage(pendingFile);
      newUploadedUrl = imageUrl;
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
    dbSaveSucceeded = true;

    let cleanupWarning = false;
    if (originalImageUrl && originalImageUrl !== imageUrl) {
      const ok = await deleteStorageImage(originalImageUrl);
      if (!ok) cleanupWarning = true;
    }

    closeModals(true);
    setStatus(cleanupWarning ? '후기를 저장했지만 이전 이미지 정리에 실패했습니다.' : '후기를 저장했어요.', cleanupWarning);
    loadDashboard();
  } catch (err) {
    if (dbSaveSucceeded) {
      // DB 저장 자체는 성공한 뒤에 발생한 예외다 — 새로 올린 이미지는 이미
      // 저장된 값이므로 여기서 지우면 안 된다. "저장 실패"로 잘못 안내하지도 않는다.
      console.warn('후기 저장 후 처리 중 오류:', err);
      closeModals(true);
      setStatus('후기를 저장했지만 이후 처리 중 문제가 발생했습니다: ' + err.message, true);
      loadDashboard();
    } else {
      if (newUploadedUrl) {
        const cleanedUp = await deleteStorageImage(newUploadedUrl);
        if (!cleanedUp) {
          console.warn('신규 업로드 이미지 정리 실패:', newUploadedUrl);
          showFormError(errEl, '데이터 저장에 실패했고 업로드된 이미지 정리도 완료하지 못했습니다. Storage를 확인해주세요.');
          saveBtn.disabled = false;
          saveBtn.textContent = '저장';
          return;
        }
      }
      showFormError(errEl, '저장 실패: ' + err.message);
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '저장';
  }
}

async function deleteReview(id) {
  if (isDashboardLoading || deleteInProgress.has(id)) return;
  const review = state.reviews.find(r => r.id === id);
  if (!confirm(`"${review ? review.author : ''}" 님의 후기를 삭제할까요? 삭제 대신 '비공개'로 전환할 수도 있어요.`)) return;

  deleteInProgress.add(id);
  try {
    const { error } = await supabaseClient.from('reviews').delete().eq('id', id);
    if (error) {
      setStatus('후기 삭제 실패: ' + error.message, true);
      return;
    }
    let cleanupWarning = false;
    if (review && review.image_url) {
      const ok = await deleteStorageImage(review.image_url);
      if (!ok) cleanupWarning = true;
    }
    setStatus(cleanupWarning ? '데이터는 삭제됐지만 이미지 정리에 실패했습니다.' : '후기를 삭제했어요.', cleanupWarning);
    loadDashboard();
  } finally {
    deleteInProgress.delete(id);
  }
}

// ===== 공지사항 렌더링 =====

function renderNoticeAdminList() {
  const el = document.getElementById('noticeAdminList');

  if (state.notices.length === 0) {
    el.innerHTML = '<p class="admin-empty">등록된 공지사항이 없습니다.</p>';
    return;
  }

  el.innerHTML = '';
  state.notices.forEach(notice => {
    const row = document.createElement('div');
    row.className = 'admin-row';
    row.innerHTML = `
      <div class="admin-row-main">
        <strong>${escapeHtml(notice.title)}</strong>
        <span class="admin-row-sub">
          ${escapeHtml(NOTICE_TYPE_LABELS[notice.notice_type] || notice.notice_type)} ·
          ${notice.published ? '공개' : '비공개'}${notice.pinned ? ' · 상단 고정' : ''} · 순서 ${notice.sort_order}<br>
          게시 기간: ${formatNoticeDate(notice.starts_at)} ~ ${formatNoticeDate(notice.ends_at)}
        </span>
      </div>
      <div class="admin-row-actions">
        <button class="btn btn-outline btn-sm" data-edit-notice="${notice.id}">수정</button>
        <button class="btn btn-outline btn-sm" data-delete-notice="${notice.id}">삭제</button>
      </div>
    `;
    el.appendChild(row);
  });

  el.querySelectorAll('[data-edit-notice]').forEach(btn => {
    btn.addEventListener('click', () => openNoticeModal(btn.dataset.editNotice));
  });
  el.querySelectorAll('[data-delete-notice]').forEach(btn => {
    btn.addEventListener('click', () => deleteNotice(btn.dataset.deleteNotice));
  });
}

function openNoticeModal(id) {
  if (isDashboardLoading) return;
  const modal = document.getElementById('noticeModal');
  const notice = state.notices.find(n => n.id === id);

  document.getElementById('noticeModalTitle').textContent = notice ? '공지사항 수정' : '공지사항 추가';
  document.getElementById('noticeId').value = id || '';
  document.getElementById('noticeTitle').value = notice ? notice.title : '';
  document.getElementById('noticeContent').value = notice ? notice.content : '';
  document.getElementById('noticeType').value = notice ? notice.notice_type : 'general';
  document.getElementById('noticePublished').checked = notice ? !!notice.published : false;
  document.getElementById('noticePinned').checked = notice ? !!notice.pinned : false;
  document.getElementById('noticeStartsAt').value = notice ? isoToDatetimeLocal(notice.starts_at) : '';
  document.getElementById('noticeEndsAt').value = notice ? isoToDatetimeLocal(notice.ends_at) : '';
  document.getElementById('noticeSortOrder').value = notice ? notice.sort_order : state.notices.length;
  hideFormError(document.getElementById('noticeFormError'));
  openModal(modal);
}

async function onNoticeSubmit(e) {
  e.preventDefault();
  const saveBtn = document.getElementById('noticeSaveBtn');
  if (saveBtn.disabled) return;
  const errEl = document.getElementById('noticeFormError');
  hideFormError(errEl);

  const title = document.getElementById('noticeTitle').value.trim();
  const content = document.getElementById('noticeContent').value.trim();

  if (!title) {
    showFormError(errEl, '제목을 입력해주세요.');
    return;
  }
  if (!content) {
    showFormError(errEl, '본문을 입력해주세요.');
    return;
  }

  const startsAt = datetimeLocalToIso(document.getElementById('noticeStartsAt').value);
  const endsAt = datetimeLocalToIso(document.getElementById('noticeEndsAt').value);
  if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
    showFormError(errEl, '게시 종료일은 시작일보다 빠를 수 없어요.');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';

  try {
    const id = document.getElementById('noticeId').value;
    const payload = {
      title,
      content,
      notice_type: document.getElementById('noticeType').value,
      published: document.getElementById('noticePublished').checked,
      pinned: document.getElementById('noticePinned').checked,
      starts_at: startsAt,
      ends_at: endsAt,
      sort_order: Number(document.getElementById('noticeSortOrder').value) || 0,
    };

    const query = id
      ? supabaseClient.from('site_notices').update(payload).eq('id', id)
      : supabaseClient.from('site_notices').insert(payload);

    const { error } = await query;
    if (error) throw error;

    closeModals(true);
    setStatus('공지사항을 저장했어요.');
    loadDashboard();
  } catch (err) {
    showFormError(errEl, '저장 실패: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '저장';
  }
}

async function deleteNotice(id) {
  if (isDashboardLoading || deleteInProgress.has(id)) return;
  const notice = state.notices.find(n => n.id === id);
  if (!confirm(`"${notice ? notice.title : ''}" 공지사항을 삭제할까요? 삭제 대신 '비공개'로 전환하는 것을 권장해요.`)) return;

  deleteInProgress.add(id);
  try {
    const { error } = await supabaseClient.from('site_notices').delete().eq('id', id);
    if (error) {
      setStatus('공지사항 삭제 실패: ' + error.message, true);
      return;
    }
    setStatus('공지사항을 삭제했어요.');
    loadDashboard();
  } finally {
    deleteInProgress.delete(id);
  }
}

// ===== 데이터 백업 =====

let backupInProgress = false;

async function onBackupClick() {
  if (backupInProgress) return;
  const btn = document.getElementById('backupBtn');
  const msgEl = document.getElementById('backupStatus');
  backupInProgress = true;
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = '백업 생성 중...';
  msgEl.hidden = true;

  try {
    const [
      { data: categories, error: catErr },
      { data: products, error: prodErr },
      { data: faqs, error: faqErr },
      { data: reviews, error: reviewErr },
      { data: notices, error: noticeErr },
    ] = await Promise.all([
      supabaseClient.from('categories').select('*'),
      supabaseClient.from('products').select('*'),
      supabaseClient.from('faqs').select('*'),
      supabaseClient.from('reviews').select('*'),
      supabaseClient.from('site_notices').select('*'),
    ]);

    const err = catErr || prodErr || faqErr || reviewErr;
    if (err) throw err;

    if (noticeErr) {
      console.warn('백업 중 site_notices 테이블 조회 실패(테이블 미생성일 수 있음):', noticeErr.message);
    }

    const backup = {
      generated_at: new Date().toISOString(),
      source: 'indigo44-admin-backup',
      tables: {
        categories: categories || [],
        products: products || [],
        faqs: faqs || [],
        reviews: reviews || [],
        site_notices: noticeErr ? [] : (notices || []),
      },
    };

    const json = JSON.stringify(backup, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `indigo44-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    msgEl.textContent = '백업 파일을 다운로드했어요.' + (noticeErr ? ' (공지사항 테이블은 아직 준비되지 않아 제외됐어요.)' : '');
    msgEl.classList.remove('admin-error');
    msgEl.setAttribute('role', 'status');
    msgEl.setAttribute('aria-live', 'polite');
    msgEl.hidden = false;
  } catch (err) {
    msgEl.textContent = '백업 생성 실패: ' + err.message;
    msgEl.classList.add('admin-error');
    msgEl.setAttribute('role', 'alert');
    msgEl.setAttribute('aria-live', 'assertive');
    msgEl.hidden = false;
  } finally {
    backupInProgress = false;
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}
