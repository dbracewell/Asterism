import Cookies from "js-cookie";

/**
 * Writes a display preference cookie (theme, font size, sidebar state) for the
 * whole app: `SameSite=Lax`, and `Secure` over HTTPS (US-116.2). Preferences
 * are read by the server to render the first paint, so they cannot be
 * `HttpOnly`; nothing secret goes in them.
 *
 * @param days Lifetime in days, or a session cookie when omitted.
 */
export function setPreferenceCookie(
  name: string,
  value: string,
  days?: number,
) {
  Cookies.set(name, value, {
    path: "/",
    sameSite: "lax",
    secure: window.location.protocol === "https:",
    ...(days === undefined ? {} : { expires: days }),
  });
}
