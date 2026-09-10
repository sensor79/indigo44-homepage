-- ============================================================
-- 인디고포포 홈페이지 — site_notices 공개 방문자 조회 정책을
-- "공개(published)"와 "팝업(popup_enabled)"이 서로 독립적으로 동작하도록 수정
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 실행
-- 되돌리려면: sql/2026-09-09-site-notices-independent-visibility-ROLLBACK.sql
--
-- ------------------------------------------------------------
-- 왜 필요한가
-- ------------------------------------------------------------
-- 기존 정책(sql/2026-09-01-site-notices.sql)은 published = true인 행만
-- 조회를 허용했습니다. 그래서 "공개 OFF / 팝업 ON"으로 설정한 팝업 전용
-- 공지는 애초에 방문자 브라우저까지 데이터가 도착하지 않아, js/main.js
-- 쪽 로직을 아무리 고쳐도 팝업이 뜰 수 없었습니다.
--
-- 이 SQL은 published = true 뿐 아니라 popup_enabled = true인 행도 함께
-- 조회를 허용하도록 조건을 바꿉니다. 게시 기간(starts_at/ends_at) 조건은
-- 그대로 유지되어, 기간 밖의 공지는 두 값과 무관하게 계속 숨겨집니다.
--
-- ------------------------------------------------------------
-- 이 정책의 실제 적용 대상 (중요 — 이전 버전 설명 정정)
-- ------------------------------------------------------------
-- 기존 정책과 이 정책 모두 "to <role>" 절이 없습니다. PostgreSQL RLS에서
-- to 절을 생략하면 대상 역할은 anon이 아니라 PUBLIC(모든 역할)입니다.
-- 즉 이 정책은 로그인하지 않은 방문자(anon)뿐 아니라 로그인한 일반
-- 사용자(authenticated, 관리자가 아닌 계정 포함)에게도 그대로 적용됩니다.
-- 아래에서 "to public"을 명시해 이 사실을 SQL 자체에 못박습니다 — 동작은
-- 바뀌지 않고(원래도 PUBLIC이 기본값) 의도만 명확해집니다.
--
-- site_notices에는 이 정책 외에 관리자 전용 SELECT 정책 "관리자 전체 조회"
-- (to authenticated, using (indigo44_is_admin()))가 하나 더 있습니다.
-- PostgreSQL은 같은 명령(SELECT)에 대한 permissive 정책 여러 개를 OR로
-- 결합합니다. 역할별로 실제 적용되는 조건은 다음과 같습니다.
--   - anon(로그인 안 함): "관리자 전체 조회"는 to authenticated라 애초에
--     적용 대상이 아님 → 아래 새 정책 조건 하나만 적용됨.
--     = (published=true 또는 popup_enabled=true) AND 게시 기간 안.
--   - authenticated 이면서 관리자가 아닌 계정: 두 정책 다 대상이 되지만
--     "관리자 전체 조회"는 indigo44_is_admin()이 false라 조건을 만족하지
--     않음 → 결과적으로 anon과 동일한 조건만 적용됨.
--   - authenticated 이면서 관리자인 계정: "관리자 전체 조회"의 조건이
--     true이므로 OR 결합 결과 전체 행이 보임(기존과 동일, 유지됨).
-- 정리하면: 비공개(published=false AND popup_enabled=false)이거나 게시
-- 기간 밖인 공지는 관리자가 아닌 그 누구에게도(로그인 여부와 무관하게)
-- 노출되지 않고, 관리자는 여전히 전체 조회가 가능합니다.
--
-- ------------------------------------------------------------
-- 영향 범위
-- ------------------------------------------------------------
-- - 바뀌는 것: public.site_notices의 공개 조회 정책 "공개 방문자 공지 조회" 1개.
-- - 바뀌지 않는 것: 관리자 조회/등록/수정/삭제 정책 4개(전부 to authenticated +
--   indigo44_is_admin() 체크), 테이블 구조, 다른 테이블(categories/products/
--   faqs/reviews)의 정책.
-- - 조회 가능해지는 행: 게시 기간 안에 있고 (published = true 또는
--   popup_enabled = true)인 행. 즉 "공개 ON / 팝업 OFF"만 조회되던 것이
--   "공개 ON 이거나 팝업 ON"이면 조회되는 것으로 넓어집니다.
-- - 여전히 조회 불가능: published = false AND popup_enabled = false인
--   완전 비공개 공지, 그리고 게시 기간(starts_at/ends_at) 밖의 공지 —
--   관리자가 아니면 두 값과 무관하게 계속 차단됩니다.
-- - js/main.js는 이 정책이 허용한 행 중에서도 목록 쿼리는 published=true,
--   팝업 쿼리는 popup_enabled=true 조건을 쿼리 단계에서 각각 다시 걸어
--   조회하므로(코드는 이미 반영됨), 정책이 넓어져도 화면에 의도치 않은
--   공지가 노출되는 일은 없습니다.
-- ------------------------------------------------------------

begin;

drop policy if exists "공개 방문자 공지 조회" on public.site_notices;
create policy "공개 방문자 공지 조회"
  on public.site_notices for select
  to public
  using (
    (published = true or popup_enabled = true)
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

commit;
