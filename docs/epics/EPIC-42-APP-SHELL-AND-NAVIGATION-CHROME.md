# EPIC-42: App shell and navigation chrome

Status: proposed. Source: the approved visual design audit (2026-10-26).

## Objective

Make the shell tell users where they are and what is active. Today `NavHeader` is
a 48px bar holding only a sidebar toggle, the sidebar has weak hierarchy and
renders the logo at 50% opacity, and list pages each build their own header.

## Ownership and delivery

Frontend only. The header reads existing chat, project, model and persona data
through the generated Hey API clients and TanStack Query; it adds no new
endpoints. Builds on the EPIC-41 tokens. Keep EPIC-32 reachability: 320px width,
short heights and keyboard access.

## US-42.1: Contextual header

As a user, I want the header to show where I am and what the chat is using.

Estimate: 1.5 days. Dependencies: EPIC-41.

Acceptance: the header shows a breadcrumb (General or Project › chat title),
compact model and persona chips for the current chat, and chat actions (rename,
move, delete). It merges with `MobileSidebarTrigger`, so mobile has one header.
On narrow screens it collapses without overflowing.

- [ ] Replace `NavHeader` and `MobileSidebarTrigger` with one route-aware header component.
- [ ] Add breadcrumb, chip and action slots fed by route params and existing queries; reuse `ChatSessionActionMenu`.
- [ ] Test the breadcrumbs per route, the mobile layout and keyboard order; update screenshots.

## US-42.2: Sidebar hierarchy

As a user, I want to scan the sidebar quickly.

Estimate: 1 day. Dependencies: US-42.1.

Acceptance: a clear active-item state, quieter section labels, and the logo at
full strength. Projects can show an optional color or glyph. If that needs a
schema field, it is added directly with no migration.

- [ ] Restyle the sidebar groups and rows; add an optional project accent (backend field, regenerated client).
- [ ] Test the active state and collapsed icon mode; update screenshots.

## US-42.3: Shared page header and list layout

As a user, I want the list pages to feel like one product.

Estimate: 1 day. Dependencies: EPIC-41.

Acceptance: a `PageHeader` component (title, description, actions) and a shared
list layout are used by the General, Projects, Search and Files pages, with
consistent width and spacing.

- [ ] Build `PageHeader` and the list layout; migrate the four pages.
- [ ] Update tests and screenshots.
