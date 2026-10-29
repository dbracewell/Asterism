import Constellation from "@/components/logo";

// Scattered background stars as [x%, y%, size px]; fixed so server and client match.
const STARS = [
  [8, 14, 3],
  [18, 72, 2],
  [27, 32, 2],
  [36, 88, 3],
  [44, 9, 2],
  [58, 64, 2],
  [66, 22, 3],
  [74, 82, 2],
  [83, 46, 2],
  [91, 12, 3],
  [94, 70, 2],
  [12, 48, 2],
];

/**
 * Decorative, theme-aware night sky behind the sign-in and setup forms. It is
 * fixed to the viewport so it never adds scrollable overflow.
 */
export function AuthBackdrop() {
  return (
    <div
      aria-hidden="true"
      data-slot="auth-backdrop"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="from-primary/12 via-background to-background absolute inset-0 bg-linear-to-b" />
      {STARS.map(([x, y, size], index) => (
        <span
          key={index}
          className="bg-primary/40 rounded-dot absolute"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            width: size,
            height: size,
          }}
        />
      ))}
      <Constellation
        className="text-primary absolute -top-16 -right-20 opacity-10"
        fill="currentColor"
        size={420}
        strokeWidth={4}
      />
      <Constellation
        className="text-primary absolute -bottom-24 -left-24 -scale-x-100 rotate-12 opacity-[0.06]"
        fill="currentColor"
        size={340}
        strokeWidth={4}
      />
    </div>
  );
}
