import { expect, test, type BrowserContext } from "./support/test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

// The fresh-install project runs first. Application auth, HTTP, sockets, storage,
// and provider transport are real; only the external model is a local double.
test("authenticated project and General chats preserve scope, provenance, and ownership", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180_000);
  test.skip(
    process.env.ASTERISM_ISOLATED_E2E !== "true",
    "Use scripts/run-isolated-e2e.mjs for real authentication",
  );
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const calls: Array<{
    model: string;
    messages: unknown;
    tools?: Array<{ function: { name: string } }>;
  }> = [];
  let workerId = "";
  const provider = createServer(async (request, response) => {
    if (request.url === "/v1/models") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          data: ["Integrated A", "Integrated B"].map((id) => ({
            id,
            supports_tools: true,
          })),
        }),
      );
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    calls.push(payload);
    const answer = `Verified reply from ${payload.model}`;
    const isParent = JSON.stringify(payload.messages[0]).includes(
      "Main role 283",
    );
    const projectTurn = JSON.stringify(payload.messages[0]).includes(
      "PROJECT_INSTRUCTIONS_283",
    );
    const searched = payload.messages.some(
      (message: { tool_call_id?: string }) =>
        message.tool_call_id === "search-283",
    );
    const delegated = payload.messages.some(
      (message: { tool_call_id?: string }) =>
        message.tool_call_id === "delegate-283",
    );
    let tool;
    if (isParent && projectTurn && !searched) {
      tool = {
        id: "search-283",
        type: "function",
        function: {
          name: "search_knowledge",
          arguments: JSON.stringify({ query: "project evidence" }),
        },
      };
    } else if (isParent && projectTurn && !delegated) {
      tool = {
        id: "delegate-283",
        type: "function",
        function: {
          name: "sub_agent",
          arguments: JSON.stringify({
            agent_id: workerId,
            prompt: "Review this fictional task",
          }),
        },
      };
    }
    if (payload.stream) {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const [delta, finish_reason] of [
        [
          tool
            ? { role: "assistant", tool_calls: [{ index: 0, ...tool }] }
            : { role: "assistant", content: answer },
          null,
        ],
        [{}, tool ? "tool_calls" : "stop"],
      ]) {
        response.write(
          `data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", model: payload.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      }
      response.end("data: [DONE]\n\n");
    } else {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          id: randomUUID(),
          model: payload.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: answer },
              finish_reason: "stop",
            },
          ],
        }),
      );
    }
  });
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  const address = provider.address();
  if (!address || typeof address === "string")
    throw new Error("Missing local provider address");
  let second: BrowserContext | undefined;
  try {
    async function register(client: BrowserContext, admin = false) {
      const query = `?adminKey=${encodeURIComponent(process.env.ADMIN_PASSPHRASE!)}&role=${admin ? "admin" : "user"}`;
      const signup = await client.request.post(
        `/api/auth/sign-up/email${query}`,
        {
          data: {
            name: "Integration user",
            email: `${randomUUID()}@example.test`,
            password: "Isolated-test-283!",
          },
        },
      );
      expect(signup.ok()).toBeTruthy();
      const user = (await signup.json()).user;
      const provision = await client.request.post("/api/py/users/", {
        data: { user_id: user.id, system_key: process.env.SYSTEM_KEY },
      });
      expect(provision.ok()).toBeTruthy();
      const token = await client.request.get("/api/auth/token");
      expect(token.ok()).toBeTruthy();
      const jwt = (await token.json()).token;
      const claims = JSON.parse(
        Buffer.from(jwt.split(".")[1], "base64url").toString(),
      );
      expect(claims.id).toBe(user.id);
      expect(claims.role).toBe(admin ? "admin" : "user");
      return { Authorization: `Bearer ${jwt}` };
    }
    const headers = await register(context, true);
    const api = async (method: string, path: string, data?: unknown) => {
      const response = await context.request.fetch(`/api/py${path}`, {
        method,
        data,
        headers,
      });
      expect(
        response.ok(),
        `${method} ${path}: ${response.status()}`,
      ).toBeTruthy();
      return response.json();
    };
    const personaState = await api("GET", "/users/personas");
    const firstPersona = personaState.profiles[0];
    await api("PATCH", `/users/personas/${firstPersona.id}`, {
      name: "Integrated persona",
      user_md: "PERSONA_INSTRUCTIONS_352",
      expected_revision: firstPersona.revision,
    });
    const providerId = randomUUID();
    await api("PUT", "/settings/app/providers", {
      llm_providers: [
        {
          id: providerId,
          name: "Isolated provider",
          provider_type: "generic_openai",
          base_url: `http://127.0.0.1:${address.port}/v1`,
          api_key: "synthetic-provider-key",
        },
      ],
    });
    await api("POST", `/settings/app/providers/${providerId}/models/discover`);
    const catalog = await api(
      "GET",
      `/settings/app/providers/${providerId}/models`,
    );
    for (const model of catalog.models) {
      await api(
        "PUT",
        `/settings/app/providers/${providerId}/models/${model.id}`,
        {
          is_active: true,
          supports_tools: true,
          supports_vision: false,
          context_window: 32768,
        },
      );
    }
    const modelA = catalog.models.find(
      (model: { name: string }) => model.name === "Integrated A",
    );
    const worker = await api("POST", "/agents/sub-agents", {
      name: "Project specialist",
      description: "Fictional test specialist",
      model_id: modelA.id,
      system_prompt: "Specialist role",
      tools: [],
    });
    workerId = worker.id;
    await api("PUT", "/settings/user/main-agent", {
      system_prompt: "Main role 283",
      tools: [],
      max_steps: 4,
    });
    await page.goto("/projects");
    await page
      .getByRole("button", { name: "New project", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Name", { exact: true })
      .fill("Authenticated project");
    await dialog
      .getByLabel("Project instructions")
      .fill("PROJECT_INSTRUCTIONS_283");
    await dialog.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/[\w-]+$/);
    const projectId = page.url().split("/").pop()!;
    let project = await api("GET", `/projects/${projectId}`);
    await api("POST", `/projects/${projectId}/sub-agents`, {
      agent_ids: [worker.id],
      expected_context_revision: project.context_revision,
    });
    const upload = await context.request.post("/api/py/files/", {
      headers,
      multipart: {
        files: {
          name: "project-evidence.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("PROJECT_SOURCE_283"),
        },
      },
    });
    expect(upload.ok()).toBeTruthy();
    const file = (await upload.json()).files[0];
    project = await api("GET", `/projects/${projectId}`);
    await api("POST", `/projects/${projectId}/files`, {
      file_ids: [file.id],
      expected_context_revision: project.context_revision,
    });
    await page.reload();
    await expect(
      page.getByText("project-evidence.txt", { exact: true }).first(),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "New chat", exact: true })
      .last()
      .click();
    await page.getByRole("combobox", { name: "Chat model" }).click();
    await page.getByRole("option", { name: /Integrated A/ }).click();
    await page
      .getByLabel("Message", { exact: true })
      .fill("Review project evidence");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page
        .getByText("Verified reply from Integrated A", { exact: true })
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    const projectChat = page.url().split("/").pop()!;
    let saved = await api("GET", `/chat/${projectChat}`);
    expect(saved.info.project_id).toBe(projectId);
    expect(
      saved.messages.find(
        (message: { role: string }) => message.role === "assistant",
      ).execution.model.name,
    ).toBe("Integrated A");
    expect(JSON.stringify(calls[0].messages)).toContain(
      "PROJECT_INSTRUCTIONS_283",
    );
    expect(JSON.stringify(calls[0].messages)).toContain(
      "PERSONA_INSTRUCTIONS_352",
    );
    expect(
      saved.messages.find(
        (message: { role: string }) => message.role === "assistant",
      ).execution.persona,
    ).toMatchObject({
      id: firstPersona.id,
      name: "Integrated persona",
      revision: firstPersona.revision + 1,
    });
    expect(JSON.stringify(saved)).not.toContain("PERSONA_INSTRUCTIONS_352");
    const projectScope = await api("GET", `/chat/${projectChat}/files/context`);
    expect(projectScope.allowed_file_ids).toContain(file.id);
    const scopedSource = await context.request.get(
      `/api/py/chat/${projectChat}/files/${file.id}`,
      { headers },
    );
    expect(scopedSource.ok()).toBeTruthy();
    expect(await scopedSource.text()).toBe("PROJECT_SOURCE_283");
    // Embeddings are deliberately unprovisioned: retrieval must report pending
    // state, rather than invent an excerpt or silently search other sources.
    expect(JSON.stringify(calls)).toContain(
      "No searchable artifacts are ready",
    );
    expect(
      calls.some((call) =>
        JSON.stringify(call.messages).includes("Specialist role"),
      ),
    ).toBeTruthy();
    expect(calls[0].tools?.map((tool) => tool.function.name)).toContain(
      "sub_agent",
    );
    await page.reload();
    await expect(
      page
        .getByText("Verified reply from Integrated A", { exact: true })
        .first(),
    ).toBeVisible();
    const nextPersona = await api("POST", "/users/personas", {
      name: "Later persona",
      user_md: "PERSONA_LATER_352",
    });
    const beforeDefault = await api("GET", "/users/personas");
    await api("PUT", "/users/personas/default", {
      persona_id: nextPersona.id,
      expected_default_revision: beforeDefault.default_revision,
    });
    const workerCalls = calls.filter((call) =>
      JSON.stringify(call.messages).includes("Specialist role"),
    );
    expect(
      workerCalls.every((call) =>
        JSON.stringify(call.messages).includes("PERSONA_INSTRUCTIONS_352"),
      ),
    ).toBeTruthy();
    await page.reload();
    await page.getByRole("combobox", { name: "Chat model" }).click();
    await page.getByRole("option", { name: /Integrated B/ }).click();
    await page
      .getByLabel("Message", { exact: true })
      .fill("Continue with the second model");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page
        .getByText("Verified reply from Integrated B", { exact: true })
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    saved = await api("GET", `/chat/${projectChat}`);
    const historyModels = saved.messages
      .filter((message: { role: string }) => message.role === "assistant")
      .map(
        (message: { execution: { model: { name: string } } }) =>
          message.execution.model.name,
      );
    const historyPersonas = saved.messages
      .filter((message: { role: string }) => message.role === "assistant")
      .map(
        (message: { execution: { persona: { id: string } } }) =>
          message.execution.persona.id,
      );
    expect(historyPersonas.at(-1)).toBe(nextPersona.id);
    expect(
      historyPersonas
        .slice(0, -1)
        .every((id: string) => id === firstPersona.id),
    ).toBeTruthy();
    expect(JSON.stringify(saved)).not.toContain("PERSONA_LATER_352");
    expect(historyModels.at(-1)).toBe("Integrated B");
    expect(
      historyModels
        .slice(0, -1)
        .every((name: string) => name === "Integrated A"),
    ).toBeTruthy();
    expect((await api("GET", "/settings/user/main-agent")).system_prompt).toBe(
      "Main role 283",
    );
    const beforeGeneral = calls.length;
    await page.goto("/general");
    await page
      .getByRole("link", { name: "New chat", exact: true })
      .last()
      .click();
    await page.getByRole("combobox", { name: "Chat model" }).click();
    await page.getByRole("option", { name: /Integrated A/ }).click();
    await page.getByLabel("Choose attachments", { exact: true }).setInputFiles({
      name: "local-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("GENERAL_LOCAL_283"),
    });
    await page
      .getByLabel("Message", { exact: true })
      .fill("Use my local notes");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page
        .getByText("Verified reply from Integrated A", { exact: true })
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    const generalChat = page.url().split("/").pop()!;
    await page.reload();
    await expect(
      page.getByText("local-notes.txt", { exact: true }).first(),
    ).toBeVisible();
    const scope = await api("GET", `/chat/${generalChat}/files/context`);
    expect(scope.project_id).toBeNull();
    expect(scope.allowed_file_ids).not.toContain(file.id);
    expect(scope.allowed_file_ids).toHaveLength(1);
    const generalCalls = calls.slice(beforeGeneral);
    expect(generalCalls.length).toBeGreaterThan(0);
    expect(JSON.stringify(generalCalls[0].messages)).toContain(
      "GENERAL_LOCAL_283",
    );
    expect(JSON.stringify(generalCalls)).not.toContain("PROJECT_SOURCE_283");
    expect(JSON.stringify(generalCalls)).not.toContain(
      "PROJECT_INSTRUCTIONS_283",
    );
    expect(
      generalCalls[0].tools?.map((tool) => tool.function.name),
    ).not.toContain("sub_agent");
    second = await browser.newContext({ baseURL: "http://localhost:3100" });
    const otherHeaders = await register(second);
    const ownProjects = await second.request.get("/api/py/projects/", {
      headers: otherHeaders,
    });
    expect(
      ownProjects.status(),
      "Second user must be authenticated before testing isolation",
    ).toBe(200);
    for (const path of [
      `/projects/${projectId}`,
      `/chat/${projectChat}`,
      `/chat/${generalChat}/files/context`,
      `/files/${file.filename}`,
      `/users/personas/${firstPersona.id}`,
    ]) {
      const denied = await second.request.get(`/api/py${path}`, {
        headers: otherHeaders,
      });
      expect(denied.status(), `${path}: ${await denied.text()}`).toBe(404);
    }
    project = await api("GET", `/projects/${projectId}`);
    await api("DELETE", `/projects/${projectId}/sub-agents`, {
      agent_ids: [worker.id],
      expected_context_revision: project.context_revision,
    });
    const beforeRevocation = calls.length;
    await page.goto(`/c/${projectChat}`);
    await page
      .getByLabel("Message", { exact: true })
      .fill("Check after deselection");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByText("Verified reply from Integrated B", { exact: true }),
    ).toHaveCount(2, { timeout: 30_000 });
    expect(calls.length).toBeGreaterThan(beforeRevocation);
    expect(
      calls[beforeRevocation].tools?.map((tool) => tool.function.name),
    ).not.toContain("sub_agent");
    await api("PATCH", `/chat/${projectChat}/project`, { project_id: null });
    expect(
      (await api("GET", `/chat/${projectChat}/files/context`)).allowed_file_ids,
    ).not.toContain(file.id);
    project = await api("GET", `/projects/${projectId}`);
    await api(
      "DELETE",
      `/projects/${projectId}?expected_context_revision=${project.context_revision}`,
    );
    expect((await api("GET", `/files/info/${file.filename}`)).id).toBe(file.id);
    await page.goto("/settings?t=user&setting=agents");
    const mainConfiguration = page.getByRole("region", {
      name: "Main configuration",
      exact: true,
    });
    await expect(
      mainConfiguration.getByRole("heading", {
        name: "Main Agent",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      mainConfiguration.getByRole("button", {
        name: "Edit main configuration",
        exact: true,
      }),
    ).toBeEnabled();
    expect(failures).toEqual([]);
  } finally {
    await second?.close();
    provider.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      provider.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
