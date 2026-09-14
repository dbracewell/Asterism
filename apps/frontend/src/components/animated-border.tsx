export const AnimatedBorder = ({ children }: { children: React.ReactNode }) => {
  {
    /*from-pink-500 via-purple-500 to-cyan-500 */
  }
  return (
    <div className="from-primary via-accent to-primary relative w-full max-w-2xl animate-[gradient-move_3s_linear_infinite] rounded-xl bg-linear-to-r bg-size-[200%_auto] p-0.5 transition-shadow focus-within:shadow-[0_0_15px_rgba(122,0,255,0.5)]">
      {children}
    </div>
  );
};
