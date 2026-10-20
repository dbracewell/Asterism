const timestamp = () =>
  new Date().toISOString().replace(/\..*$/, "").replace(/[:T]/g, "-");

const extension = (type: string) => type.split("/")[1]?.split("+")[0] || "png";

export const canReadClipboard = () =>
  typeof navigator !== "undefined" && !!navigator.clipboard?.read;

export const canCaptureScreen = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

/** Browsers name every pasted image "image.png"; give each a distinct name. */
export const nameClipboardFile = (file: File, index = 0) =>
  file.name && file.name !== "image.png"
    ? file
    : new File(
        [file],
        `pasted-image-${timestamp()}${index ? `-${index + 1}` : ""}.${extension(file.type)}`,
        { type: file.type },
      );

export async function readClipboard(): Promise<{
  files: File[];
  text: string;
}> {
  const files: File[] = [];
  let text = "";
  for (const item of await navigator.clipboard.read()) {
    for (const type of item.types) {
      if (type.startsWith("image/")) {
        const blob = await item.getType(type);
        files.push(
          nameClipboardFile(
            new File([blob], "image.png", { type }),
            files.length,
          ),
        );
      } else if (type === "text/plain") {
        text += await (await item.getType(type)).text();
      }
    }
  }
  return { files, text };
}

export const isCancelledCapture = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === "NotAllowedError" || error.name === "AbortError");

/** Grabs a single frame of a screen, window, or tab chosen by the user. */
export async function captureScreenshot(): Promise<File> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await new Promise<void>((resolve) =>
      "requestVideoFrameCallback" in video
        ? video.requestVideoFrameCallback(() => resolve())
        : setTimeout(resolve, 200),
    );
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("Could not capture the screen.");
    return new File([blob], `screenshot-${timestamp()}.png`, {
      type: "image/png",
    });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}
