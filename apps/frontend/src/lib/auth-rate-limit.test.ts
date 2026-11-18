import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AUTH_RATE_LIMIT } from "./auth-rate-limit";

it("lets a class on one address sign in within the edge's auth limit", () => {
  const nginx = readFileSync(
    join(__dirname, "../../../../docker/nginx.conf"),
    "utf8",
  );
  const edge = /zone=auth:\S+ rate=(\d+)r\/m;/.exec(nginx);
  expect(edge).not.toBeNull();
  const signIn = AUTH_RATE_LIMIT.customRules["/sign-in/*"];
  // The same per-minute allowance as nginx, so neither refuses a class first.
  expect((signIn.max * 60) / signIn.window).toBe(Number(edge![1]));
  expect(signIn.max).toBeGreaterThanOrEqual(30);
});
