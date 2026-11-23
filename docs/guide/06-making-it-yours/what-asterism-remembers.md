# What Asterism remembers

When your administrator has turned memory on, Asterism keeps in mind what helps
it work with you, such as how you like to learn or an accessibility need you've
told it about, across your chats and projects. These are your **memories**. Only
you can see them: not educators and not administrators.

> **Who can do this:** everyone, when your administrator has turned memory on
> for your group.

## Two kinds of memory

- **Memories about you** are used in every chat. Each has a category:
  **Learning**, **Accessibility**, **Background** or **Other**. They're about
  you, not about what you're working on.
- **Project memories** are about your work in one project, such as a decision or
  a convention you chose. Only that project's chats use them.

Memories are information about you, never instructions. They don't give
Asterism any extra tools or access to files. To change how Asterism responds,
pick a [learning mode](../04-learning/learning-modes.md) or edit your
[main agent's instructions](agents.md) instead.

## See and change your memories

Your memories about you are under **Memory** in **Settings** › **Your
Asterism**, grouped by category. A project's memories are in that project's
**Settings** tab, under **Project memory**.

- **Add a memory** with **Add a memory**. Choose a category; accessibility
  memories are always marked **Sensitive**, and you can mark others too.
- **Change or delete one** with **Edit** or **Delete** beside it, or delete them
  all with **Delete all**. Asterism asks you to confirm before deleting.
- **Turn memory off for yourself** by clearing **Use memory**. Asterism then uses
  none of your memories, and keeps them until you delete them.

## When Asterism offers to remember something

When you tell Asterism something worth remembering, such as how you like to
learn, it may offer to remember it. A **Remember this?** card under the answer
shows what it would save and where: **You, in every chat** or **This project**.

- **Save** saves it as shown. **Edit** lets you change the text, category or
  **Sensitive** first.
- **Dismiss** saves nothing, and Asterism won't offer the same thing again in
  that chat.

Nothing is saved unless you choose to save it. Asterism offers at most one memory
per answer, and never from what a file or web page says. In your list, a memory
you saved this way says **Saved from a chat**.

## How answers use your memories

Each message you send adds the memories most relevant to it. A message keeps the
memories it was sent with, so editing one later doesn't change earlier answers,
but deleting one stops it being used, even when you resume an answer.
[Regenerating](../02-chatting/regenerating-and-branches.md) an answer chooses
again from your memories as they are now. To see which memories an answer used,
open **Context** under it.

## Sensitive memories

A memory marked **Sensitive** is used like any other, but its text never appears
in Asterism's logs. Accessibility memories are always sensitive.

## When memory is off

If memory is off, the Memory section says why:

- your administrator hasn't turned it on for your group;
- you've turned it off with **Use memory**;
- in a course project, your educator has turned it off for the course.

## Deleting chats, projects and your account

- **Deleting a chat** keeps the memories you saved from it. They then say
  **Saved from a chat (chat deleted)**.
- **Deleting a project** deletes its project memories.
- **Deleting your account** deletes all your memories.

## Your memories in your data

[Downloading your data](your-data-and-account.md#download-your-data) includes
`memories.json`, with every memory about you and every project memory. Sensitive
ones are marked `"sensitive": true`. Your memories are also kept when your
administrator backs up or upgrades Asterism.

## Related

- [About you and your usage](about-you-and-usage.md)
- [Projects](../03-files-and-projects/projects.md)
- [Glossary: Memory](../glossary.md)
