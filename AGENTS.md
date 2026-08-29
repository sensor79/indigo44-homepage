# 인디고포포 홈페이지

친환경 고체비누 브랜드 '인디고포포(Indigo44)'의 브랜드 홈페이지입니다.

## 구조

빌드 도구 없는 순수 정적 사이트입니다. 파일을 저장하면 그게 곧 배포본입니다.

- `index.html` — 메인 페이지 (히어로 / 브랜드 이야기 / 제품 / 약속 / 사용법 / 후기 / FAQ)
- `admin.html` + `js/admin.js` + `css/admin.css` — 관리자 페이지 (제품·카테고리·FAQ·후기 CRUD)
- `css/style.css` — 메인 페이지 전체 스타일
- `js/main.js` — 제품·FAQ·후기 로딩, 후기 캐러셀/모달
- `js/supabase-client.js` — Supabase 연결 설정
- `assets/images/` — 로고, 약속 섹션 일러스트

React·Vue·번들러·npm 패키지를 도입하지 마세요. 의도적으로 배제한 구조입니다.

## 데이터

Supabase(Postgres + Auth + Storage)를 백엔드로 씁니다. 테이블: `categories`, `products`, `faqs`, `reviews`.

RLS 정책은 모든 테이블 동일 패턴입니다 — 읽기는 `using (true)`로 전체 공개, 쓰기는 `using (auth.role() = 'authenticated')`로 로그인 사용자만.

Supabase가 응답하지 않아도 페이지가 비지 않도록 `js/main.js` 상단에 `FALLBACK_CATEGORIES` / `FALLBACK_PRODUCTS` 예시 데이터가 있습니다. 제품 관련 코드를 고칠 때 이 폴백도 함께 유지하세요.

## 캐시 무효화 (중요)

GitHub Pages는 CSS/JS를 오래 캐시합니다. **`css/style.css` 또는 `js/main.js`를 수정하면 `index.html`의 버전 숫자를 반드시 올리세요.**

```html
<link rel="stylesheet" href="css/style.css?v=29">
```

이걸 빠뜨리면 배포해도 방문자 화면은 그대로입니다.

## 브랜드 문구 원칙

과장된 친환경 주장을 쓰지 않습니다. 아래 표현은 금지입니다.

- ❌ "100% 친환경", "완벽한 친환경", "제로웨이스트 브랜드", "플라스틱 ZERO"
- ✅ "가능한 부분부터 개선합니다", "완벽함보다 꾸준한 실천"

품질·안전상 포장이 불가피한 경우가 있다는 점을 숨기지 않는 것이 이 브랜드의 태도입니다.

## 한글 줄바꿈

`body`에 `word-break: keep-all`이 적용돼 있습니다. 단어 중간에서 줄이 끊기지 않게 하기 위한 것이니 제거하지 마세요.

제목이 어색하게 나뉠 때는 `max-width` 조절이 아니라 **문장의 자연스러운 지점에 `<br>`를 직접 넣으세요.** `max-width`는 화면 크기·폰트 크기 조합에 따라 다르게 깨져서 이 프로젝트에서 여러 번 실패했습니다.

## 디자인

크림 배경 + 올리브 잉크의 미니멀 에디토리얼 톤입니다. 색은 반드시 `css/style.css` 상단 `:root` 변수를 쓰고 새 색을 임의로 추가하지 마세요.

```
--color-main: #34362B   (진한 올리브)
--color-bg:   #F1EFE4   (크림 배경)
--color-paper:#F7F5EC   (밝은 섹션 배경)
--color-accent:#9C6B45  (테라코타 포인트)
```

폰트: 제목 `Noto Serif KR`, 슬로건 `Gowun Batang`, 본문 `Pretendard`.

## 이미지

사이트에 올리는 이미지는 **가로 720px 이하 + JPEG 압축**으로 줄여서 넣으세요. 모바일 로딩 속도 때문입니다. 원본 PNG는 커밋하지 않습니다 (`assets/source/`는 `.gitignore` 처리됨).

```bash
sips -Z 720 원본.png --out 임시.png
sips -s format jpeg -s formatOptions 82 임시.png --out assets/images/이름.jpg
```

## 로컬 확인

```bash
cd ~/Desktop/클로드코드 && python3 -m http.server 5599
```

브라우저에서 `http://localhost:5599/index.html` 로 접속합니다.

## 배포

`main` 브랜치에 푸시하면 GitHub Pages가 자동 배포합니다. 반영까지 1~2분 걸립니다.

라이브 주소: https://sensor79.github.io/indigo44-homepage

**푸시는 사용자가 요청할 때만 하세요.** 커밋까지만 하고 확인받는 것이 기본입니다.
