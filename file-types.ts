// File types Notion accepts for uploads, from https://developers.notion.com/docs/working-with-files-and-media
// Maps each supported extension to the content type sent when the caller doesn't pass one.
const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
    // Audio
    ".aac": "audio/aac",
    ".adts": "audio/aac",
    ".mid": "audio/midi",
    ".midi": "audio/midi",
    ".mp3": "audio/mpeg",
    ".mpga": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".m4b": "audio/mp4",
    ".oga": "audio/ogg",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".wav": "audio/wav",
    ".wma": "audio/x-ms-wma",
    ".weba": "audio/webm",
    ".flac": "audio/x-flac",

    // Documents
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
    ".js": "text/javascript",
    ".ts": "application/typescript",
    ".tsx": "application/typescript",
    ".py": "text/x-python",
    ".doc": "application/msword",
    ".dot": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".dotx": "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
    ".xls": "application/vnd.ms-excel",
    ".xlt": "application/vnd.ms-excel",
    ".xla": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xltx": "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pot": "application/vnd.ms-powerpoint",
    ".pps": "application/vnd.ms-powerpoint",
    ".ppa": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".potx": "application/vnd.openxmlformats-officedocument.presentationml.template",
    ".rtf": "application/rtf",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".html": "text/html",
    ".htm": "text/html",
    ".epub": "application/epub+zip",
    ".xml": "application/xml",
    ".css": "text/css",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".odp": "application/vnd.oasis.opendocument.presentation",
    ".ics": "text/calendar",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".tsv": "text/tab-separated-values",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".gzip": "application/gzip",
    ".tar": "application/x-tar",
    ".7z": "application/x-7z-compressed",
    ".bz2": "application/x-bzip2",
    ".rar": "application/vnd.rar",

    // Images
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".webp": "image/webp",
    ".ico": "image/vnd.microsoft.icon",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
    ".apng": "image/apng",

    // Video
    ".amv": "video/x-amv",
    ".asf": "video/x-ms-asf",
    ".wmv": "video/x-ms-asf",
    ".avi": "video/x-msvideo",
    ".f4v": "video/x-f4v",
    ".flv": "video/x-flv",
    ".gifv": "video/mp4",
    ".m4v": "video/mp4",
    ".mp4": "video/mp4",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".qt": "video/quicktime",
    ".mpeg": "video/mpeg",
    ".ogv": "video/ogg",
    ".3gp": "video/3gpp",
    ".3g2": "video/3gpp2",

    // CAD and 3D models (Notion attaches these as file blocks)
    ".dwg": "image/vnd.dwg",
    ".dxf": "image/vnd.dxf",
    ".dwf": "model/vnd.dwf",
    ".rvt": "application/vnd.autodesk.revit",
    ".rfa": "application/vnd.autodesk.revit",
    ".fbx": "application/vnd.autodesk.fbx",
    ".3dm": "application/vnd.mcneel.3dm",
    ".step": "model/step",
    ".stp": "model/step",
    ".iges": "model/iges",
    ".igs": "model/iges",
    ".stl": "model/stl",
    ".obj": "model/obj",
    ".3mf": "model/3mf",
    ".gltf": "model/gltf+json",
    ".glb": "model/gltf-binary",
    ".dae": "model/vnd.collada+xml",
    ".usdz": "model/vnd.usdz+zip"
};

// Documented content types that aren't the default for any extension above
const OTHER_SUPPORTED_MIME_TYPES = ["application/csv", "application/javascript", "text/xml", "application/mp4"];

const SUPPORTED_MIME_TYPES = new Set([...Object.values(MIME_TYPES_BY_EXTENSION), ...OTHER_SUPPORTED_MIME_TYPES]);

function extensionOf(filename: string): string {
    const dot = filename.lastIndexOf(".");
    return dot > 0 ? filename.slice(dot).toLowerCase() : "";
}

function normalizeMimeType(mimeType: string): string {
    return mimeType.split(";")[0].trim().toLowerCase();
}

/** Returns the MIME type Notion expects for a filename's extension, or undefined if Notion doesn't support it. */
export function inferMimeType(filename: string): string | undefined {
    return MIME_TYPES_BY_EXTENSION[extensionOf(filename)];
}

/**
 * Whether Notion accepts an upload with this filename and content type.
 * Notion resolves the type from either one, so it's enough for one of them to be supported.
 */
export function isSupportedFileType(filename: string, mimeType: string): boolean {
    return extensionOf(filename) in MIME_TYPES_BY_EXTENSION || SUPPORTED_MIME_TYPES.has(normalizeMimeType(mimeType));
}
