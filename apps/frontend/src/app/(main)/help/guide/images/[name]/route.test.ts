import { expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("server-only", () => ({}));

const get = (name: string) =>
  GET(new Request("http://localhost/"), { params: Promise.resolve({ name }) });

it("serves a guide screenshot as a PNG, and nothing else (US-90.9)", async () => {
  const image = await get("chat-canvas.png");
  expect(image.status).toBe(200);
  expect(image.headers.get("content-type")).toBe("image/png");
  expect(image.headers.get("x-content-type-options")).toBe("nosniff");
  expect(new Uint8Array(await image.arrayBuffer()).slice(1, 4)).toEqual(
    new Uint8Array([0x50, 0x4e, 0x47]),
  );
  for (const name of ["../README.md", "missing.png"])
    expect((await get(name)).status).toBe(404);
});
