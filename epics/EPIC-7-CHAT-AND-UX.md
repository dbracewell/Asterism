# EPIC-7-CHAT-AND-UX

## Goal
Deliver the core end-user chat experience with profile/agent management and streaming responses.

## User Stories

### US-7.1 Chat UI with streaming responses
**As a user**, I want a responsive chat UI with token streaming so interactions feel real-time.

#### Tasks
- [ ] Implement chat layout and message threading.
- [ ] Integrate Vercel AI SDK streaming.
- [ ] Render tool/image outputs in the conversation.
- [ ] Add frontend tests for chat behavior.

### US-7.2 Profile and agent switching UX
**As a user**, I want to switch profiles and agents so I can change behavior and context quickly.

#### Tasks
- [ ] Build profile selector UX.
- [ ] Build agent selector UX.
- [ ] Surface current default profile/agent clearly.
- [ ] Add tests for selection and persistence behavior.

### US-7.3 Admin capability management UX
**As an admin**, I want a management UI for skills/tools/MCP/image providers so I can configure the system without code changes.

#### Tasks
- [ ] Build admin pages/forms for capability CRUD.
- [ ] Add form validation and error states.
- [ ] Restrict pages to admin role.
- [ ] Add tests for admin workflows.
