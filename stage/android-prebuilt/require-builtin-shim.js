'use strict';
// Zamiennik natywnego dodatku node-addon-require-builtin dla android-arm64 (upstream nie publikuje binarki ani źródeł).
// dsh na Androidzie i tak startuje z `node --expose-internals`, więc wewnętrzne moduły są dostępne zwykłym require().
// Kształt obiektu i pola abi/backend muszą zgadzać się z walidacją w node-addon-native-custom-loader (napi-v9).
function requireBuiltin(id) {
  try { return require(id); } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND' && String(id).startsWith('internal/')) {
      throw new Error(`require-builtin (android): moduł ${id} niedostępny — node musi działać z --expose-internals`, { cause: e });
    }
    throw e;
  }
}
function isAllowedInternalId(id) { return typeof id === 'string' && id.length > 0; }
function getNativeBindingInfo() { return { mode: 'js-expose-internals', backend: 'napi', abi: 'napi-v9', platform: 'android-arm64' }; }
module.exports = { requireBuiltin, isAllowedInternalId, getNativeBindingInfo };
