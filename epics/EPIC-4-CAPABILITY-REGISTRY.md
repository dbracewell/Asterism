# EPIC-4-CAPABILITY-REGISTRY

## Goal
Allow admins to manage skills, tools, MCP servers, and image generation providers.

## User Stories

### US-4.1 Skills registry
**As an admin**, I want to manage skills so agents can be configured with reusable capabilities.

#### Tasks
- [ ] Implement skill data model and CRUD APIs.
- [ ] Add enable/disable state for skills.
- [ ] Add admin-only authorization checks.
- [ ] Add tests for skills lifecycle.

### US-4.2 Tools registry
**As an admin**, I want to register and manage tools so agents can execute constrained operations.

#### Tasks
- [ ] Implement tool data model and CRUD APIs.
- [ ] Add validation for tool schemas/metadata.
- [ ] Add enable/disable state for tools.
- [ ] Add tests for tool registration and updates.

### US-4.3 MCP servers and image provider management
**As an admin**, I want to configure MCP servers and image providers so runtime integrations are centrally controlled.

#### Tasks
- [ ] Implement MCP server configuration CRUD.
- [ ] Implement image provider configuration CRUD.
- [ ] Store provider secrets securely via environment/secret strategy.
- [ ] Add tests for admin management workflows.
