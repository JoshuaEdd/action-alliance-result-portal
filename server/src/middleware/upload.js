import multer from 'multer';

const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 8);

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error('Only JPEG, PNG, or WEBP images are allowed'));
  }
  cb(null, true);
}

// Photo bytes are held in memory only for the duration of the request and
// then persisted into Postgres (submission_photos.data). Storing them on
// disk broke on Render: its ephemeral filesystem wipes ./uploads on every
// deploy/restart, deleting uploaded evidence while DB rows survived.
export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

// Placeholder hook for an AV/malware scan pass before a file is trusted (SEC-8).
// Wire this to ClamAV or a cloud scanning API in production.
export async function scanFile(_buffer) {
  return { clean: true };
}
