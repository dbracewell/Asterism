# EPIC-121: Fewer database queries

Status: proposed (2026-11-27). Source: repository review (2026-11-26), work
deferred from EPIC-117.

## Objective

Pages with long lists ask the database a fixed number of times, not once per
row, and no query takes an unbounded list of IDs.

Class rosters, course insights and usage reports run one query per row, so a
page that takes a moment with 20 rows takes far longer with 2,000. Some reports
also pass every ID in one `IN (...)` list, which can fail outright once the list
is large enough.

## Stories

### US-121.1: Classes and course insights load in a few queries

As an educator, I want a class with hundreds of students to open as quickly as
a small one.

- [ ] The class roster and class list load members and counts in a fixed number
      of queries.
- [ ] Course insights load per-student data in a fixed number of queries.
- [ ] Tests count the queries for a class of a few hundred students.
- [ ] Release note.

### US-121.2: Usage reports are paged and bounded

As an administrator, I want usage reports to work for thousands of users and
months of history.

- [ ] Usage reports are paginated and filtered in the database.
- [ ] Long ID lists are split into bounded batches.
- [ ] A budget is read once per request, not twice.
- [ ] Tests with a large number of users, and release note.

### US-121.3: Bounded reads elsewhere

As a user, I want searches and tool calls to stay quick as my library grows.

- [ ] Vector lookups by file split long file lists into bounded batches.
- [ ] Parallel tool calls in one turn share one model client lookup.
- [ ] Tests and release note.
