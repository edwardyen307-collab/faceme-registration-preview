'use strict';

const { config } = require('./config');

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);

function sniffImageMime(buf) {
  if (!buf || buf.length < 3) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  // HEIC/HEIF: ftyp....heic/heif/mif1
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (/heic|heif|mif1|msf1/i.test(brand)) return 'image/heic';
  }
  return null;
}

function validateName(name) {
  const n = String(name || '').trim();
  if (!n) {
    const err = new Error('姓名為必填');
    err.code = 'NAME_REQUIRED';
    err.status = 400;
    throw err;
  }
  if (n.length > 80) {
    const err = new Error('姓名過長');
    err.code = 'NAME_TOO_LONG';
    err.status = 400;
    throw err;
  }
  return n;
}

function validateEmployeeId(raw) {
  if (raw == null || raw === '') return '';
  const id = String(raw).trim();
  if (id.length > 64) {
    const err = new Error('員工／訪客編號過長');
    err.code = 'EMPLOYEE_ID_TOO_LONG';
    err.status = 400;
    throw err;
  }
  return id;
}

function validateImageFile(file) {
  if (!file || !file.buffer) {
    const err = new Error('請上傳人臉照片');
    err.code = 'PHOTO_REQUIRED';
    err.status = 400;
    throw err;
  }
  if (file.size > config.maxUploadBytes || file.buffer.length > config.maxUploadBytes) {
    const err = new Error('檔案過大（上限 8MB）');
    err.code = 'FILE_TOO_LARGE';
    err.status = 413;
    throw err;
  }
  const sniffed = sniffImageMime(file.buffer);
  const declared = (file.mimetype || '').toLowerCase();
  if (!sniffed) {
    const err = new Error('檔案內容不是可辨識的圖片');
    err.code = 'PHOTO_INVALID';
    err.status = 400;
    throw err;
  }
  if (declared && !ALLOWED_MIME.has(declared) && declared !== 'application/octet-stream') {
    // Allow octet-stream if sniff ok; otherwise reject mismatched declared types that aren't images
    if (!ALLOWED_MIME.has(declared)) {
      const err = new Error('不支援的圖片類型');
      err.code = 'PHOTO_TYPE';
      err.status = 400;
      throw err;
    }
  }
  return { mime: sniffed, filename: file.originalname || 'face.jpg' };
}

module.exports = {
  validateName,
  validateEmployeeId,
  validateImageFile,
  sniffImageMime,
  ALLOWED_MIME
};
