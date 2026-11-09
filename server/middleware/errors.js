'use strict';

function sendError(res, err) {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL';
  // Never echo upstream bodies, tokens, or passwords unless already masked by caller
  const message = err.expose === false ? '伺服器錯誤' : err.message || '伺服器錯誤';
  const payload = { error: message, code };
  if (Array.isArray(err.reasons)) payload.reasons = err.reasons;
  if (err.techDetails != null) payload.techDetails = err.techDetails;
  if (err.hint) payload.hint = err.hint;
  if (err.similarPersonId != null) payload.similarPersonId = err.similarPersonId;
  if (err.detailUrl) payload.detailUrl = err.detailUrl;
  res.status(status).json(payload);
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  // Multer file size etc.
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '檔案過大（上限 8MB）', code: 'FILE_TOO_LARGE' });
  }
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: '不支援的上傳欄位', code: 'BAD_UPLOAD' });
  }
  sendError(res, err);
}

module.exports = { sendError, errorHandler };
