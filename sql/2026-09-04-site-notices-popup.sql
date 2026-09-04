-- ============================================================
-- 인디고포포 홈페이지 — site_notices에 팝업 표시 여부 컬럼 추가
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 실행
--
-- sql/2026-09-01-site-notices.sql로 만든 public.site_notices 테이블에
-- popup_enabled 컬럼 하나만 추가합니다. 기존 테이블 구조·데이터·RLS 정책,
-- 그리고 이 Supabase 프로젝트를 함께 쓰는 다른 앱의 테이블은 전혀 건드리지
-- 않습니다.
--
-- "add column if not exists"라서 여러 번 실행해도 안전합니다(이미 컬럼이
-- 있으면 아무 일도 일어나지 않습니다).
--
-- "not null default false"이므로, 이미 저장돼 있던 기존 공지 데이터도 이
-- 컬럼이 생기는 즉시 모두 popup_enabled = false로 채워집니다. 즉 이 SQL만
-- 실행한 직후에는 어떤 공지도 팝업으로 뜨지 않고, 관리자 페이지에서 "팝업으로
-- 표시" 체크박스를 직접 켠 공지만 팝업에 노출됩니다.
-- ============================================================

alter table public.site_notices
  add column if not exists popup_enabled boolean not null default false;
