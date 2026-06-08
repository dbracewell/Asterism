export const SessionPage = async ({ sessionId }: { sessionId: string }) => {
  return (
    <>
      {sessionId}
      {Array.from({ length: 1000 }).map((_, i) => (
        <div key={i}>{i}</div>
      ))}
    </>
  );
};
