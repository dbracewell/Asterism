export const MessageLoading = () => {
  return (
    <div className="mt-3 flex items-center space-x-1 px-4">
      <span className="sr-only">Processing...</span>
      <div className="bg-primary rounded-dot size-2 animate-bounce [animation-delay:-0.3s]"></div>
      <div className="bg-primary rounded-dot size-2 animate-bounce [animation-delay:-0.15s]"></div>
      <div className="bg-primary rounded-dot size-2 animate-bounce"></div>
    </div>
  );
};
