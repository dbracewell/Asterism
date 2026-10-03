import { api } from "@/lib/api";

import { useState } from "react";

export const APIDownload = ({
  filename,
  className,
  linkText,
}: {
  filename: string;
  className?: string;
  linkText?: string;
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const handleClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (loading || error) return;

    setLoading(true);
    let objectUrl: string | null = null;
    try {
      const { data } = await api.fileGetOne({
        path: { filename },
      });
      if (!data) throw new Error("File is unavailable");
      const blob = data instanceof Blob ? data : new Blob([data]);
      objectUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (fetchError) {
      console.error("Failed to fetch file", fetchError);
      setError(true);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setLoading(false);
    }
  };

  if (error) {
    return (
      <a className="text-red-500">
        Failed to retrieve <span className="font-bold">{filename}</span>
      </a>
    );
  }

  return (
    <a href="#" className={className} onClick={handleClick} aria-busy={loading}>
      {loading ? "Loading…" : (linkText ?? filename)}
    </a>
  );
};
