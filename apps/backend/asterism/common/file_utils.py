import filetype


def get_file_mime_type(file_path) -> str:
    kind = filetype.guess(file_path)
    if kind is None:
        match file_path[-3:].lower():
            case "png":
                return "image/png"
            case "jpg":
                return "image/jpg"
            case "webp":
                return "image/webp"
        return "text/plain"
    return kind.mime
