# EPIC-111: Finding reflections

Status: proposed (2026-11-26). Source: user report (2026-11-26): "I don't
actually see how to do them anywhere."

## Objective

A person can see how to write a reflection from the chat they are in, and can
find the reflections they wrote afterwards. Reflections themselves (ADR-0048)
are unchanged: owner-only, never read by agents.

## Where things stand (verified 2026-11-26)

- The only way to write one is **Reflect on this session** in the chat's **…**
  menu (the header, or a sidebar row on hover). Nothing else mentions it.
- The menu item is shown whatever the project's areas are. In a project whose
  Reflections area is off (the default for the **Ask my documents** and
  **Agent workspace** starting points), a saved reflection goes to a tab that
  is hidden. The backend doesn't check areas either; areas only hide UI.
- General chats' reflections are on the **General** page, reached only from
  the sidebar's "General" heading. Saving says nothing about where the
  reflection went.

## Stories

### US-111.1: A visible Reflect button that follows the project's areas

As a learner, I want a Reflect button in the chat I'm working in, so I can see
that I can reflect without searching menus.

- [ ] The chat header shows a **Reflect** button (icon only on narrow screens)
      once the chat has an answer; it opens the existing dialog.
- [ ] In a project chat, the button and the menu item appear only when the
      project's Reflections area is on; General chats always have them.
- [ ] After saving, the message says where the reflection was kept, with a link
      to the project's Reflections tab or the General page.
- [ ] Tests, guide (reflections page and screenshot) and release note.

### US-111.2: Reflections easy to find afterwards

As a learner, I want to find my reflections from the places I already look.

- [ ] An empty Reflections tab or General list explains how to write one.
- [ ] The project Overview shows the newest reflection, or a prompt to write
      one, when the Reflections area is on.
- [ ] Help topics and the guide name every way in.
- [ ] Tests, guide and release note.
