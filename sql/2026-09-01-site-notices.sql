-- ============================================================
-- 인디고포포 홈페이지 — 공지사항(site_notices) 테이블 + RLS 정책
-- 적용 방법: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여넣고 실행
-- 이 저장소에는 별도의 Supabase migration 구조(supabase/migrations)가 없어
-- 실행 가능한 SQL 파일로 준비했습니다. 기존 테이블(categories/products/
-- faqs/reviews)이나 Storage 파일은 전혀 건드리지 않습니다.
--
-- ⚠ 테이블 이름을 "notices"가 아니라 "site_notices"로 만듭니다.
-- 예전에 이 Supabase 프로젝트에는 다른 앱(HNL 재고관리로 추정)이 쓰던 notices
-- 테이블(id/author/content/created_at/user_id 컬럼, 인디고포포와 무관한 내용)이
-- 있었습니다. 같은 이름으로 만들었다면 "create table if not exists"가 그
-- 테이블을 그대로 두고 아무 일도 하지 않아, 이 프로젝트가 기대하는
-- title/notice_type/published 등의 컬럼이 생기지 않는 문제를 실제로 겪었습니다.
-- 그 notices 테이블은 이제 삭제되었지만(2026-09-01 확인), 코드 전반
-- (js/admin.js, js/main.js)이 이미 site_notices를 참조하도록 맞춰져 있고
-- 앞으로 다른 앱이 같은 이름을 다시 쓸 가능성도 배제할 수 없어 site_notices
-- 이름은 그대로 유지합니다.
--
-- ⚠ 같은 이유로 관리자 판별용 테이블/함수도 indigo44_ 접두사를 붙였습니다.
-- 같은 Supabase 프로젝트를 다른 앱과 공유하고 있어, admin_users/is_admin
-- 같은 범용 이름은 그 앱이 이미 쓰고 있거나 나중에 만들 이름과 충돌할 수
-- 있습니다. notices 테이블에서 실제로 겪은 문제라 이번엔 처음부터
-- indigo44_ 접두사로 충돌 가능성을 없앴습니다.
--
-- ⚠ 이 프로젝트의 모든 테이블·함수·트리거·정책은 public 스키마를 명시적으로
-- 붙였습니다. 여러 앱이 한 Supabase 프로젝트를 공유하는 상황에서 search_path
-- 설정에 기대지 않고 "정확히 어느 스키마의 무엇을 가리키는지"를 SQL 자체에
-- 못박아, 다른 스키마의 동명 객체를 잘못 참조할 가능성을 없앴습니다.
-- ============================================================

-- gen_random_uuid()를 위한 확장 (Supabase 프로젝트에는 보통 이미 활성화되어
-- 있지만, 없는 경우를 대비해 안전하게 한 번 더 선언합니다. 이미 있으면 아무
-- 일도 일어나지 않습니다.)
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. public.site_notices 테이블
-- ------------------------------------------------------------
create table if not exists public.site_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  notice_type text not null default 'general',
  published boolean not null default false,
  pinned boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint site_notices_notice_type_check
    check (notice_type in ('general', 'shipping', 'product', 'event', 'important')),

  -- 제목·본문이 공백만으로 저장되는 것을 막습니다.
  constraint site_notices_title_not_blank check (btrim(title) <> ''),
  constraint site_notices_content_not_blank check (btrim(content) <> ''),

  -- 시작일·종료일이 둘 다 있으면 종료일이 시작일보다 빠를 수 없습니다.
  constraint site_notices_date_range_check
    check (starts_at is null or ends_at is null or ends_at >= starts_at)
);

-- updated_at을 수정 시 자동으로 now()로 갱신하는 트리거.
-- 함수 이름에도 indigo44_ 접두사 + 대상 테이블명을 넣어, 공유 프로젝트 안의
-- 다른 앱이 쓰는 동명 함수와 절대 겹치지 않게 했습니다.
create or replace function public.indigo44_set_site_notices_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists site_notices_set_updated_at on public.site_notices;
create trigger site_notices_set_updated_at
before update on public.site_notices
for each row
execute function public.indigo44_set_site_notices_updated_at();

-- ------------------------------------------------------------
-- 2. 관리자 판별 (기존 프로젝트에 관리자 역할/UID 구분 방식이 없어서 새로
--    최소 구성으로 준비했습니다 — 아래 테이블은 처음엔 비어 있고, 실제
--    관리자 계정 UID는 사용자가 3번에서 직접 한 번 입력해야 합니다.)
-- ------------------------------------------------------------
create table if not exists public.indigo44_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.indigo44_admin_users enable row level security;
-- public.indigo44_admin_users 테이블 자체는 SELECT 정책을 두지 않습니다
-- (기본적으로 아무도 직접 조회할 수 없고, 아래 indigo44_is_admin() 함수만
-- SECURITY DEFINER로 우회해 조회합니다).

create or replace function public.indigo44_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.indigo44_admin_users where user_id = auth.uid()
  );
$$;

-- ------------------------------------------------------------
-- 3. 관리자 계정 등록 (사용자가 직접 실행해야 하는 부분)
-- ------------------------------------------------------------
-- Supabase 대시보드 → Authentication → Users에서 관리자로 쓸 계정의 UID를
-- 복사한 뒤, 아래 문장의 '여기에-관리자-UID-붙여넣기' 자리를 바꿔 실행하세요.
--
-- insert into public.indigo44_admin_users (user_id) values ('여기에-관리자-UID-붙여넣기')
--   on conflict (user_id) do nothing;
--
-- 관리자가 여러 명이면 위 insert 문을 계정 수만큼 반복하면 됩니다.

-- ------------------------------------------------------------
-- 4. RLS 활성화 + 정책
-- ------------------------------------------------------------
alter table public.site_notices enable row level security;

drop policy if exists "공개 방문자 공지 조회" on public.site_notices;
create policy "공개 방문자 공지 조회"
  on public.site_notices for select
  using (
    published = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
  );

-- 관리자 정책 4개는 모두 "to authenticated"로 역할 자체를 먼저 제한한다.
-- indigo44_is_admin()이 anon 요청(auth.uid()가 null)에는 이미 false를 반환하므로
-- 기능적으로는 없어도 anon을 막지만, 정책 선언 자체에 역할을 명시해 이중으로
-- 방어한다 — is_admin() 쪽에 나중에 버그가 생겨도 anon 역할 자체가 이 정책
-- 평가 대상에서 제외된다.
drop policy if exists "관리자 전체 조회" on public.site_notices;
create policy "관리자 전체 조회"
  on public.site_notices for select
  to authenticated
  using (public.indigo44_is_admin());

drop policy if exists "관리자 등록" on public.site_notices;
create policy "관리자 등록"
  on public.site_notices for insert
  to authenticated
  with check (public.indigo44_is_admin());

drop policy if exists "관리자 수정" on public.site_notices;
create policy "관리자 수정"
  on public.site_notices for update
  to authenticated
  using (public.indigo44_is_admin())
  with check (public.indigo44_is_admin());

drop policy if exists "관리자 삭제" on public.site_notices;
create policy "관리자 삭제"
  on public.site_notices for delete
  to authenticated
  using (public.indigo44_is_admin());

-- ============================================================
-- 참고 1: 기존 categories/products/faqs/reviews 테이블의 쓰기 정책은
-- 현재 auth.role() = 'authenticated' (로그인한 모두 허용) 방식입니다.
-- 이번 작업 범위가 아니라서 건드리지 않았지만, 이후 이 프로젝트의
-- public.indigo44_is_admin() 방식으로 맞춰 강화하는 것을 권장합니다.
--
-- 참고 2: 예전에 같은 Supabase 프로젝트 안에 다른 앱(HNL 재고관리로 추정) 소유의
-- notices 테이블이 있었고, 점검 당시 RLS가 걸려 있지 않거나 익명 키로도 INSERT가
-- 허용되는 상태였습니다. 그 테이블은 이제 삭제되어(2026-09-01 확인) 더 이상
-- 문제가 되지 않습니다. site_notices라는 별도 이름은 그때 겪었던 이름 충돌을
-- 다시 겪지 않기 위한 조치로 계속 유지합니다.
-- ============================================================
