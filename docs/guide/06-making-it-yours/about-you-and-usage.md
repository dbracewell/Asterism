# About you and your usage

**Settings** › **Your Asterism** has two things: **About you**, a few facts about
you that Asterism keeps in mind in every chat, and **Usage**, how much you've used
Asterism.

> **Who can do this:** everyone.

![Settings, Your Asterism: today's and this month's token use, and the About you box with a few facts about the student](../images/settings-about-you.png)

## About you

### What to write

Write facts that help Asterism pitch its answers at you:

- who you are: your year, course or job;
- what you're studying or working on;
- what you already know, and what's new to you;
- anything that helps you learn, such as "English is my second language" or "I
  like an everyday example first".

For example:

> I'm in Year 11 and taking biology, chemistry and English. I understand things
> best with an everyday example first.

### What not to write

- **Instructions about how to answer**, such as "always answer in bullet points".
  About you is information, not instructions. To change how Asterism answers,
  choose a [learning mode](../04-learning/learning-modes.md) in the chat, or write
  instructions for your [main agent](agents.md).
- **Anything private you wouldn't want an AI to read**, such as passwords, your
  address or health details. Asterism sends About you to the model with every
  message.

### Change it

1. Select your name at the bottom of the sidebar, then **Settings**, then
   **Your Asterism**.
2. Type in **What should Asterism know about you?** (up to 16,000 characters).
3. Select **Save**.

New messages use the text you saved. Messages you've already sent keep the text
they were sent with, so changing it doesn't change earlier answers.
[Regenerating](../02-chatting/regenerating-and-branches.md) an answer uses your
latest text.

About you isn't a memory: Asterism doesn't add things to it by itself. It doesn't
give Asterism any extra tools or access to files either. Memories are kept
separately, under [Memory](#memory).

## Memory

When your administrator has turned memory on, Asterism keeps in mind what helps
it work with you, such as how you like to learn or an accessibility need you've
told it about, across your chats and projects. Only you can see your memories:
not educators and not administrators.

Your memories about you are under **Memory** in **Your Asterism**, grouped by
category. A project's memories are in that project's **Settings** tab, and only
that project's chats use them.

- **Add a memory** with **Add a memory**. Choose a category; accessibility
  memories are always marked **Sensitive**, and you can mark others too.
  Sensitive memories never appear in logs.
- **Change or delete one** with **Edit** or **Delete** beside it, or delete them
  all with **Delete all**. Asterism asks you to confirm before deleting.
- **Turn memory off for yourself** by clearing **Use memory**. Asterism then uses
  none of your memories, and keeps them until you delete them.

When you tell Asterism something worth remembering, such as how you like to
learn, it may offer to remember it. A **Remember this?** card under the answer
shows what it would save and where: **You, in every chat** or **This project**.

- **Save** saves it as shown. **Edit** lets you change the text, category or
  **Sensitive** first.
- **Dismiss** saves nothing, and Asterism won't offer the same thing again in
  that chat.

Nothing is saved unless you choose to save it. Asterism offers at most one memory
per answer, and never from what a file or web page says.

Each message you send adds the memories most relevant to it, as information about
you, never as instructions. A message keeps the memories it was sent with, so
editing one later doesn't change earlier answers, but deleting one stops it being
used, even when you resume an answer. To see which memories an answer used, open
**Context** under it.

If memory is off, the page says why: your administrator hasn't turned it on for
your group, you've turned it off, or, in a course project, your educator has.

## Usage

**Usage** shows how many **tokens** you've used **Today** and **This month**.
Tokens are the small pieces of text that models read and write; every chat,
sub-agent, study tool and caption uses some.

If your group has a **budget**, Usage also shows how much is left and when it
resets. When a budget is used up:

- new messages, regenerated answers and study tools wait until it resets, and the
  message says when that is;
- an answer that's already being written still finishes.

Days start at midnight and months on the 1st, in the time zone your administrator
chose. Only an administrator can change a budget.

## Related

- [Agents](agents.md)
- [Learning modes](../04-learning/learning-modes.md)
- [Glossary: About you](../glossary.md)
