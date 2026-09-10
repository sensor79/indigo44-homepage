-- ============================================================
-- sql/2026-09-09-site-notices-independent-visibility.sql 롤백용
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 실행
--
-- "공개 방문자 공지 조회" 정책을 sql/2026-09-01-site-notices.sql이 만든
-- 원래 조건(published = true인 행만 조회 가능)으로 되돌립니다. 이 조건도
-- 원본과 동일하게 to 절이 없어 PUBLIC이 기본 대상이므로, 여기서는 이를
-- 명시적으로 "to public"이라 적어 두 버전 사이의 유일한 차이가 using
-- 조건(팝업 예외 유무)뿐임을 분명히 합니다. 관리자 정책 4개는 이 작업과
-- 무관하므로 건드리지 않습니다.
-- ============================================================

begin;

drop policy if exists "공개 방문자 공지 조회" on public.site_notices;
create policy "공개 방문자 공지 조회"
  on public.site_notices for select
  to public
  using (
    published = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

commit;
