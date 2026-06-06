# Asterism

[![CI](https://github.com/dbracewell/Asterism/actions/workflows/ci.yml/badge.svg)](https://github.com/dbracewell/Asterism/actions/workflows/ci.yml)
[![CI (main)](https://github.com/dbracewell/Asterism/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dbracewell/Asterism/actions/workflows/ci.yml?query=branch%3Amain)

Asterism is a full-stack, multi-agent AI app (inspired by Open WebUI) where agents, tools, skills, MCP servers, image generation, and memory work together to fulfill user requests.

## Clone the repo

```bash
git clone git@github.com:dbracewell/Asterism.git
cd Asterism
```

## Run locally

### Prerequisites

- Node.js 22.13+
- pnpm 11+
- Python 3.13+
- [uv](https://docs.astral.sh/uv/)

### 1) Install dependencies

```bash
pnpm install
```

### 2) Configure environment files

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

Update values in both `.env` files as needed for your machine.

### 3) Start backend and frontend

In terminal 1:

```bash
pnpm --filter @asterism/backend dev
```

In terminal 2:

```bash
pnpm --filter @asterism/frontend dev
```

Frontend: http://localhost:3000  
Backend OpenAPI: http://localhost:8000/openapi.json
