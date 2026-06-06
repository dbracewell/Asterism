# EPIC-2-AUTH-AND-USER-MODEL

## Goal
Implement authentication/authorization, user model, and RBAC foundations for Admin and User roles.

## User Stories

### US-2.1 BetterAuth + JWT integration
**As a user**, I want secure login/session handling so I can access protected application features.

#### Tasks
- [ ] Integrate BetterAuth with JWT issuance/verification.
- [ ] Add auth middleware/guards on backend endpoints.
- [ ] Add frontend auth flows (sign-in/sign-out/session state).
- [ ] Add auth integration tests.

### US-2.2 User entity and role model
**As an admin**, I want users and roles represented in the database so access control is enforceable.

#### Tasks
- [ ] Define SQLAlchemy models for users and roles.
- [ ] Add migrations for user/role tables.
- [ ] Enforce role checks for admin-only operations.
- [ ] Add tests for role-based access behavior.

### US-2.3 Frontend setup-gated routing
**As a user**, I want to be taken directly to initial setup when no admin exists so I can complete setup before using the app.

#### Tasks
- [ ] Route authenticated users to `/app/setup` when admin bootstrap is required.
- [ ] Route authenticated users to `/app` when setup is complete.
- [ ] Remove setup navigation entry points from normal app chrome.
- [ ] Add/update tests for setup-gated routing behavior.

### US-2.4 Protected route and API behavior
**As a developer**, I want consistent unauthorized/forbidden responses so clients can handle auth failures predictably.

#### Tasks
- [ ] Standardize 401/403 API responses.
- [ ] Protect frontend routes requiring auth.
- [ ] Add API client handling for auth failures.
- [ ] Document auth error contract.
