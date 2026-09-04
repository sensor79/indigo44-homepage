-- ============================================================
-- 인디고포포 홈페이지 — site_notices에 공지 이미지 주소 컬럼 추가
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 실행
--
-- public.site_notices에 image_url text 컬럼 하나만 추가합니다. 기존 테이블
-- 구조·데이터·RLS 정책, 그리고 이 Supabase 프로젝트를 함께 쓰는 다른 앱의
-- 테이블은 전혀 건드리지 않습니다.
--
-- "add column if not exists"라서 여러 번 실행해도 안전합니다(이미 컬럼이
-- 있으면 아무 일도 일어나지 않습니다).
--
-- 기본값을 두지 않는 이유: image_url은 nullable text이고 기존 공지는 전부
-- 이미지가 없는 상태(null)로 남아야 자연스럽습니다. products/reviews의
-- image_url 컬럼과 동일하게 "값이 있으면 이미지, null이면 이미지 없음"
-- 패턴을 그대로 따릅니다. 실제 파일은 기존과 같은 Storage 버킷
-- (product-images)에 저장하고, 이 컬럼에는 그 공개 URL만 문자열로 저장합니다.
-- ============================================================

alter table public.site_notices
  add column if not exists image_url text;
