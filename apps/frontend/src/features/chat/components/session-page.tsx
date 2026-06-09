export const SessionPage = async ({ sessionId }: { sessionId: string }) => {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {sessionId}
      {Array.from({ length: 1000 }).map((_, i) => (
        <div key={i}>{i}</div>
      ))}
    </div>
  );
};
