(function () {
  'use strict';

  var CONSENT_KEY = 'faceme_privacy_consent_v1';
  var MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB
  var ALLOWED_TYPES = {
    'image/jpeg': true,
    'image/png': true,
    'image/webp': true,
    'image/heic': true,
    'image/heif': true
  };

  function hasConsent() {
    try {
      return sessionStorage.getItem(CONSENT_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function setConsent(value) {
    try {
      if (value) {
        sessionStorage.setItem(CONSENT_KEY, '1');
      } else {
        sessionStorage.removeItem(CONSENT_KEY);
      }
    } catch (e) {
      /* ignore quota / private mode */
    }
  }

  function clearConsent() {
    setConsent(false);
  }

  function defaultNavigateTo(url, replace) {
    if (replace) {
      window.location.replace(url);
    } else {
      window.location.href = url;
    }
  }

  function navigateTo(url, replace) {
    var impl = (window.FaceMePreview && window.FaceMePreview.navigateTo) || defaultNavigateTo;
    // Avoid recursion when FaceMePreview.navigateTo is this wrapper during bootstrap.
    if (impl === navigateTo) impl = defaultNavigateTo;
    return impl(url, replace);
  }

  function initConsentPage() {
    var checkbox = document.getElementById('consent-check');
    var submitBtn = document.getElementById('consent-submit');
    var form = document.getElementById('consent-form');
    if (!checkbox || !submitBtn || !form) return;

    function sync() {
      submitBtn.disabled = !checkbox.checked;
    }

    checkbox.addEventListener('change', sync);
    sync();

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!checkbox.checked) {
        sync();
        checkbox.focus();
        return;
      }
      setConsent(true);
      navigateTo('register.html', false);
    });
  }

  function guardRegisterPage() {
    if (!hasConsent()) {
      navigateTo('index.html', true);
      return false;
    }
    return true;
  }

  function revokeObjectUrl(url) {
    if (url && String(url).indexOf('blob:') === 0) {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {
        /* ignore */
      }
    }
  }

  function initRegisterPage() {
    if (!guardRegisterPage()) return;

    var form = document.getElementById('register-form');
    var nameInput = document.getElementById('full-name');
    var nameError = document.getElementById('name-error');
    var photoInput = document.getElementById('face-photo');
    var photoError = document.getElementById('photo-error');
    var previewWrap = document.getElementById('photo-preview-wrap');
    var previewImg = document.getElementById('photo-preview');
    var clearPhotoBtn = document.getElementById('clear-photo');
    var resultBox = document.getElementById('submit-result');
    var backBtn = document.getElementById('back-to-notice');
    var currentObjectUrl = null;

    function setPhotoError(msg) {
      if (photoError) photoError.textContent = msg || '';
      if (photoInput) {
        if (msg) {
          photoInput.setAttribute('aria-invalid', 'true');
        } else {
          photoInput.removeAttribute('aria-invalid');
        }
      }
    }

    function setNameError(msg) {
      if (nameError) nameError.textContent = msg || '';
      if (nameInput) {
        if (msg) {
          nameInput.setAttribute('aria-invalid', 'true');
        } else {
          nameInput.removeAttribute('aria-invalid');
        }
      }
    }

    function clearPhoto() {
      revokeObjectUrl(currentObjectUrl);
      currentObjectUrl = null;
      if (photoInput) photoInput.value = '';
      if (previewImg) {
        previewImg.removeAttribute('src');
        previewImg.alt = '';
      }
      if (previewWrap) previewWrap.classList.remove('visible');
      setPhotoError('');
    }

    function showPreview(file) {
      revokeObjectUrl(currentObjectUrl);
      currentObjectUrl = URL.createObjectURL(file);
      if (previewImg) {
        previewImg.src = currentObjectUrl;
        previewImg.alt = '人臉照片本機預覽（不會上傳）';
      }
      if (previewWrap) previewWrap.classList.add('visible');
    }

    function validatePhotoFile(file) {
      if (!file) {
        setPhotoError('');
        return true;
      }
      var type = (file.type || '').toLowerCase();
      var name = (file.name || '').toLowerCase();
      var okType =
        ALLOWED_TYPES[type] ||
        /\.(jpe?g|png|webp|heic|heif)$/.test(name);
      if (!okType) {
        setPhotoError('僅接受 JPG、PNG、WebP 或 HEIC 圖片。');
        return false;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        setPhotoError('檔案過大，請選擇 8MB 以內的圖片。');
        return false;
      }
      setPhotoError('');
      return true;
    }

    if (photoInput) {
      photoInput.addEventListener('change', function () {
        var file = photoInput.files && photoInput.files[0];
        if (!file) {
          clearPhoto();
          return;
        }
        if (!validatePhotoFile(file)) {
          photoInput.value = '';
          revokeObjectUrl(currentObjectUrl);
          currentObjectUrl = null;
          if (previewWrap) previewWrap.classList.remove('visible');
          if (previewImg) previewImg.removeAttribute('src');
          return;
        }
        showPreview(file);
      });
    }

    if (clearPhotoBtn) {
      clearPhotoBtn.addEventListener('click', function () {
        clearPhoto();
      });
    }

    if (backBtn) {
      backBtn.addEventListener('click', function () {
        navigateTo('index.html', false);
      });
    }

    window.addEventListener('pagehide', function () {
      revokeObjectUrl(currentObjectUrl);
      currentObjectUrl = null;
    });

    if (form) {
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (resultBox) resultBox.classList.remove('visible');

        var name = (nameInput && nameInput.value || '').trim();
        if (!name) {
          setNameError('請填寫姓名。');
          if (nameInput) nameInput.focus();
          return;
        }
        setNameError('');

        var file = photoInput && photoInput.files && photoInput.files[0];
        if (file && !validatePhotoFile(file)) {
          if (photoInput) photoInput.focus();
          return;
        }

        // Preview mode only: no network, no FaceMe API, no persistence.
        if (resultBox) {
          resultBox.textContent = '已送出（預覽模式，尚未寫入 FaceMe）';
          resultBox.classList.add('visible');
          resultBox.focus();
        }
      });
    }

    if (nameInput) {
      nameInput.addEventListener('input', function () {
        if ((nameInput.value || '').trim()) setNameError('');
      });
    }
  }

  // Expose for Node/DOM tests without leaking secrets.
  window.FaceMePreview = {
    CONSENT_KEY: CONSENT_KEY,
    MAX_PHOTO_BYTES: MAX_PHOTO_BYTES,
    hasConsent: hasConsent,
    setConsent: setConsent,
    clearConsent: clearConsent,
    navigateTo: defaultNavigateTo,
    initConsentPage: initConsentPage,
    guardRegisterPage: guardRegisterPage,
    initRegisterPage: initRegisterPage
  };

  document.addEventListener('DOMContentLoaded', function () {
    var page = document.body && document.body.getAttribute('data-page');
    if (page === 'consent') initConsentPage();
    if (page === 'register') initRegisterPage();
  });
})();
