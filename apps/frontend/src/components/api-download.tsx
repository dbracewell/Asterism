import { api } from "@/lib/api";

import { useEffect, useState } from "react";

export const APIDownload = ({
  filename,
  className,
}: {
  filename: string;
  className?: string;
}) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    const fetchFile = async () => {
      const { data } = await api.getFile({
        path: {
          filename: encodeURIComponent(filename).replaceAll(".", "%2E"),
        },
      });

      if (!data) {
        if (active) setError(true);
        return;
      }

      setObjectUrl(URL.createObjectURL(data));
    };

    fetchFile();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filename]);

  if (error) {
    return (
      <a className="text-red-500">
        Failed to retrieve <span className="font-bold">{filename}</span>
      </a>
    );
  }

  if (!objectUrl) {
    return (
      <a href="#" className={className} download={filename}>
        {filename}
      </a>
    );
  }

  return (
    <a href={objectUrl} className={className} download={filename}>
      {filename}
    </a>
  );
};
