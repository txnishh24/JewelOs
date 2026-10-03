function _checkLoginRateLimit(errEl){
  var now = Date.now();
  if(now < _loginLockedUntil){
    var secs = Math.ceil((_loginLockedUntil - now) / 1000);
    errEl.textContent = '\u23f3 Too many failed attempts. Wait '+secs+' seconds before trying again.';
    return false;
  }
  return true;
}

function _recordLoginFailure(errEl){
  _loginAttempts++;
  if(_loginAttempts >= 5){
    _loginLockedUntil = Date.now() + 60000; // 60 second lockout
    _loginAttempts = 0;
    errEl.textContent = '\ud83d\udd12 Account locked for 60 seconds due to too many failed attempts.';
  }
}

function saasLogin(){
  var email    = (document.getElementById('auth-email').value||'').trim().toLowerCase();
  var password = (document.getElementById('auth-password').value||'');
  var errEl    = document.getElementById('auth-login-err');

  errEl.textContent = '';
  if(!_checkLoginRateLimit(errEl)) return;
  if(!email) { errEl.textContent='Enter your email'; return; }
  if(!password) { errEl.textContent='Enter your password'; return; }

  errEl.className = 'auth-err auth-info';
  errEl.textContent = '\u23f3 Signing in... please wait';
  var loginBtn = document.querySelector('#auth-login-form .auth-btn');
  if(loginBtn) loginBtn.disabled = true;

  authGatewayCall('login', {email:email, password:password}).then(function(res){
    _loginAttempts = 0;
    _loginLockedUntil = 0;
    if(loginBtn) loginBtn.disabled = false;
    saasSetSession(res.user, res.shop, res.sessionToken);

    // FIX: server sets mustResetPassword:true on every staff account
    // created via Invite Staff (see auth-gateway add-staff), but nothing
    // client-side ever checked it — a staff member could keep using the
    // one-time temp password the owner shared with them indefinitely.
    // `password` here is exactly the current/temp password they just
    // successfully logged in with, so we can go straight to asking for
    // a replacement without a redundant "enter current password" prompt.
    if(res.user && res.user.mustResetPassword){
      forcePasswordReset(password);
      return;
    }

    hideAuthScreen();
    bootApp();
  }).catch(function(err){
    if(loginBtn) loginBtn.disabled = false;
    errEl.className = 'auth-err';
    console.error('[JewelOS] login failed:', err);

    if(err.status === 429){
      errEl.textContent = err.data && err.data.error ? err.data.error : 'Too many failed attempts. Try again later.';
      return;
    }
    if(err.status === 401){
      // Genuinely wrong credentials — the server actually checked and said no.
      _recordLoginFailure(errEl);
      errEl.textContent = (_loginAttempts > 0 && _loginAttempts < 5)
        ? 'Incorrect email or password. '+(5 - _loginAttempts)+' attempt(s) remaining before lockout.'
        : 'Incorrect email or password.';
      return;
    }
    // Anything else (network failure, CORS block, function not deployed,
    // wrong URL, 404, 500, timeout...) is NOT a wrong password — do not
    // burn a login attempt or claim the credentials were checked. Show
    // what actually happened instead.
    if(err.status){
      errEl.textContent = 'Could not sign in (server error '+err.status+'). ' + ((err.data && err.data.error) ? err.data.error : 'Please try again in a moment.');
    } else {
      errEl.textContent = '\u26a0 Could not reach the server. Check your internet connection, or the app may not be set up correctly yet.';
    }
  });
}

// ── SESSION ──────────────────────────────────────────────────────────
function saasSetSession(user, shop, sessionToken){
  SAAS.user = user;
  SAAS.shop = shop;
  SAAS.plan = 'pro'; // plans removed — every account is Pro
  // Explicit token (fresh login/signup) wins; otherwise this is the
  // restore-on-reopen path, which reuses the token stored with the session.
  if(sessionToken){
    SAAS.sessionToken = sessionToken;
  } else {
    var stored = saasGetSession();
    SAAS.sessionToken = (stored && stored.token) || null;
  }

  // FIX v18: use shop.rowKey (set at signup) or shop.id as fallback
  SHOP_ROW_KEY = shop.rowKey || shop.id || 'main';
  // Cache this device's own user+shop locally (NOT the whole platform's
  // users table — auth-gateway never hands that back). The token is stored
  // with the session record and expires with it (Tanish, 29 Sep: option B —
  // reopening the app within the token's life asks for the PIN, not the
  // password). Sign-out and forced sign-out remove the whole record.
  try{
    saasSetUsers([user]); saasSetShops([shop]);
    // A temp-password session stays in memory only: closing the app during
    // the forced reset must not reopen into the shop without the new password.
    if(user.mustResetPassword){
      localStorage.removeItem(AUTH_KEY);
    } else if(sessionToken){
      localStorage.setItem(AUTH_KEY, JSON.stringify({userId:user.id, shopId:shop.id, ts:Date.now(), token:sessionToken, exp:_sessionTokenExp(sessionToken)}));
    }
  } catch(e){ console.warn('[JewelOS] Could not save session to localStorage'); }
  // paidUntil arrives on the shop record from auth-gateway, so the banner can
  // be drawn as soon as the session is set — on fresh login and on reload.
  if(typeof renderSubBanner === 'function') renderSubBanner();
}

// The token is "<base64url JSON payload>.<signature>"; the payload carries
// the server's own expiry, so the device never outlives what auth-gateway
// issued (SESSION_TTL_HOURS there is the one place the lifetime is set).
function _sessionTokenExp(token){
  try{
    var b = String(token).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    while(b.length % 4) b += '=';
    var exp = JSON.parse(atob(b)).exp;
    return typeof exp === 'number' ? exp : 0;
  }catch(e){ return 0; }
}

// A session is only usable while its token is. A record with no token
// (written by a build before 29 Sep) or a past exp is not a session.
function saasGetSession(){
  try{
    var s = JSON.parse(localStorage.getItem(AUTH_KEY)||'null');
    if(!s || !s.token || !(s.exp > Date.now())) return null;
    return s;
  }catch(e){ return null; }
}

// True when this device was signed in but the session ran out while the app
// was closed — boot shows why instead of a bare login form.
function _saasSessionExpired(){
  try{ return !!localStorage.getItem(AUTH_KEY) && !saasGetSession(); }catch(e){ return false; }
}

// (showAuthStoreSetup removed — it walked the owner through creating an
// "allow_all" RLS policy on auth_store, which is exactly the hole
// 001_lockdown_rls.sql closes. auth_store setup is now one-time, in the
// migration + auth-gateway deploy, not something the client should ever
// offer to redo.)

// Everything this device holds for the signed-in shop. ssj_cache is a full copy
// of the shop's records, so leaving it behind left customers, loans and sales on
// the phone after sign-out (security review 14 Sep, finding 9). PIN keys stay:
// they're a per-device lock, not shop data.
function _clearDeviceSession(){
  try{ clearPinSession(); }catch(e){} // before SAAS.shop is nulled — its key is shop-scoped
  var keys = [AUTH_KEY, USERS_KEY, SHOPS_KEY, 'ssj_cache', 'ssj_last_save', 'ssj_last_cloud_load'];
  for(var i = 0; i < keys.length; i++){ try{ localStorage.removeItem(keys[i]); }catch(e){} }
  SAAS.sessionToken = null;
  SAAS.user = null; SAAS.shop = null;
}

// A reload also drops the shop data still held in memory (S) and every running
// timer, which hiding the app behind the sign-in screen did not.
function _reloadToSignIn(){
  try{ location.reload(); }catch(e){ showAuthScreen(); }
}

function saasLogout(){
  // Saves go to this device first and the cloud second. If the last one hasn't
  // landed, signing out deletes the only copy of it — say so before, not after.
  var st = window._lastSyncStatus;
  var unsynced = isSaving || !!(st && st.status !== 'ok');
  var msg = unsynced
    ? 'Your latest changes may not have reached the cloud yet. Signing out removes this device\'s copy of the shop, so anything not yet saved to the cloud will be lost. Sign out anyway?'
    : 'Sign out of JewelOS on this device?';
  safeConfirm('Sign out?', msg, function(){
    _clearDeviceSession();
    _reloadToSignIn();
  }, unsynced);
}

// The server refused the session — it expired, or this user was removed from
// the shop. No confirmation: a removed employee must not be able to tap Cancel
// and keep browsing the shop from this device.
function saasForceLogout(message){
  _clearDeviceSession();
  try{ if(message) sessionStorage.setItem(SIGNOUT_NOTICE_KEY, message); }catch(e){}
  _reloadToSignIn();
}

// ── RE-SIGN-IN IN PLACE (F1, 29 Sep) ─────────────────────────────────
// store-proxy said 401 mid-work (the 6 h token ran out, or this user was
// removed). Signing out here used to wipe the device and reload, so a bill
// being saved — or just typed — was lost. Instead: block the app, ask for
// this same account's password, and replay the waiting saves on a fresh
// token. A removed user's password no longer works, so their only way out
// is Sign out — still no Cancel into the shop.
var _reauthPending = false;
var _reauthWaiters = [];

function saasReauthPending(){ return _reauthPending; }

function saasRequireReauth(onResumed, reason){
  // Revoked (user removed from the shop), not timed out: wipe the device as
  // before, no password prompt. store-proxy now says which ('revoked' /
  // 'expired'); only a server without that field (before its redeploy) falls
  // back to this phone's clock, which a slow clock gets wrong (Cowork, 30 Sep).
  var revoked = reason ? reason === 'revoked' : _sessionTokenExp(SAAS.sessionToken) > Date.now();
  if(!_reauthPending && revoked){
    // Opus review of 005 (30 Sep): the wipe drops anything not yet saved --
    // right for a removed user (the shop data must leave their phone), but it
    // was silent behind a generic message. Say what happened, and log it so a
    // user record that went missing by mistake shows up in monitoring.
    if(reason === 'revoked'){
      console.error('[JewelOS] session revoked by server: user no longer in this shop');
      saasForceLogout('This account no longer has access to this shop, so changes not yet saved on this phone could not be kept. Ask the shop owner, then sign in again.');
      return;
    }
    saasForceLogout('Your session has ended — please sign in again.');
    return;
  }
  if(onResumed) _reauthWaiters.push(onResumed);
  if(_reauthPending) return;
  _reauthPending = true;
  setSyncStatus('err', 'Sign in to save');
  var ov = document.getElementById('reauth-overlay');
  if(!ov || !SAAS.user || !SAAS.user.email){
    saasForceLogout('Your session has ended — please sign in again.');
    return;
  }
  document.getElementById('reauth-password').value = '';
  document.getElementById('reauth-err').textContent = '';
  document.getElementById('reauth-submit').disabled = false;
  ov.style.display = 'flex';
  setTimeout(function(){ var el = document.getElementById('reauth-password'); if(el) el.focus(); }, 80);
}

function saasReauthSubmit(){
  var pw = document.getElementById('reauth-password').value || '';
  var errEl = document.getElementById('reauth-err');
  var btn = document.getElementById('reauth-submit');
  if(!pw){ errEl.textContent = 'Enter your password'; return; }
  if(!_checkLoginRateLimit(errEl)) return;
  errEl.textContent = '⏳ Checking...';
  btn.disabled = true;
  authGatewayCall('login', {email: SAAS.user.email, password: pw}).then(function(res){
    btn.disabled = false;
    _loginAttempts = 0;
    // Must be the same person in the same shop, still allowed in as-is.
    if(!res.user || !res.shop || res.user.id !== SAAS.user.id || res.shop.id !== SAAS.shop.id || res.user.mustResetPassword){
      saasForceLogout('Please sign in again.');
      return;
    }
    saasSetSession(res.user, res.shop, res.sessionToken);
    document.getElementById('reauth-overlay').style.display = 'none';
    _reauthPending = false;
    var waiters = _reauthWaiters; _reauthWaiters = [];
    for(var i = 0; i < waiters.length; i++){ try{ waiters[i](); }catch(e){ console.error('[JewelOS] resume after sign-in failed:', e); } }
    if(!waiters.length) setSyncStatus('ok', 'Live');
  }).catch(function(err){
    btn.disabled = false;
    if(err.status === 401){
      _recordLoginFailure(errEl);
      if(!(Date.now() < _loginLockedUntil)) errEl.textContent = 'Incorrect password.';
    } else if(err.status === 429){
      errEl.textContent = (err.data && err.data.error) || 'Too many attempts. Try again later.';
    } else {
      errEl.textContent = '⚠ Could not reach the server. Check your internet and try again.';
    }
  });
}

function saasReauthSignOut(){
  saasForceLogout('Signed out. Anything that was waiting to save was not saved.');
}

// ── FORGOT PASSWORD ──────────────────────────────────────────────────
// Two-step flow against auth-gateway: request a 6-digit emailed code,
// then submit it with a new password. auth-gateway never confirms
// whether an email exists (same response either way) and rate-limits
// requests server-side, so this can't be used to enumerate accounts or
// brute-force codes by hammering the endpoint.
function showForgotPassword(){
  document.getElementById('auth-login-form').style.display = 'none';
  document.getElementById('auth-signup-form').style.display = 'none';
  document.getElementById('auth-forgot-form').style.display = '';
  document.getElementById('forgot-step-email').style.display = '';
  document.getElementById('forgot-step-code').style.display = 'none';
  document.getElementById('forgot-email').value = (document.getElementById('auth-email').value || '').trim();
  document.getElementById('forgot-err').textContent = '';
}

function cancelForgotPassword(){
  document.getElementById('auth-forgot-form').style.display = 'none';
  document.getElementById('auth-login-form').style.display = '';
}

function forgotPasswordRequestCode(){
  var email = (document.getElementById('forgot-email').value || '').trim().toLowerCase();
  var errEl = document.getElementById('forgot-err');
  errEl.textContent = '';
  if(!email){ errEl.textContent = 'Enter your email'; return; }

  var btn = document.getElementById('forgot-request-btn');
  if(btn) btn.disabled = true;
  errEl.textContent = '\u23f3 Sending...';

  authGatewayCall('request-password-reset', {email: email}).then(function(res){
    if(btn) btn.disabled = false;
    // Server always returns the same generic message whether or not the
    // account exists — show it as-is, don't editorialize on top of it.
    errEl.style.color = '';
    errEl.textContent = (res && res.message) || 'If an account exists for that email, a reset code has been sent.';
    document.getElementById('forgot-step-email').style.display = 'none';
    document.getElementById('forgot-step-code').style.display = '';
    document.getElementById('forgot-code-email').value = email;
  }).catch(function(err){
    if(btn) btn.disabled = false;
    errEl.textContent = (err.data && err.data.error) ? err.data.error
      : '\u26a0 Could not reach the server. Check your connection and try again.';
  });
}

function forgotPasswordSubmitReset(){
  var email = document.getElementById('forgot-code-email').value;
  var code = (document.getElementById('forgot-code').value || '').trim();
  var newPassword = document.getElementById('forgot-new-password').value || '';
  var errEl = document.getElementById('forgot-code-err');
  errEl.textContent = '';

  if(!code){ errEl.textContent = 'Enter the 6-digit code from your email'; return; }
  if(newPassword.length < 8){ errEl.textContent = 'New password must be at least 8 characters'; return; }

  var btn = document.getElementById('forgot-reset-btn');
  if(btn) btn.disabled = true;
  errEl.textContent = '\u23f3 Resetting...';

  authGatewayCall('reset-password', {email: email, code: code, newPassword: newPassword}).then(function(){
    if(btn) btn.disabled = false;
    toast('Password reset — please sign in');
    cancelForgotPassword();
    document.getElementById('auth-email').value = email;
    document.getElementById('auth-password').value = '';
  }).catch(function(err){
    if(btn) btn.disabled = false;
    errEl.textContent = (err.data && err.data.error) ? err.data.error
      : '\u26a0 Could not reach the server. Check your connection and try again.';
  });
}

// ── CHANGE PASSWORD ──────────────────────────────────────────────────
// FIX: replaced window.prompt()/alert() with the app's own modal (see
// #pwd-modal in index.html) — a browser-native popup looked unprofessional
// and can't be styled, validated inline, or masked/unmasked properly.
// _pwdModalMode tracks which flow is active ('change' = voluntary, asks
// for current password, Cancel just closes; 'forced' = first-login reset
// for staff invited via sendStaffInvite, current password is already
// known so that field is hidden, and Cancel signs out instead of letting
// a temp-password session through — matching the original forced-reset
// guarantee, just via the modal's Cancel button instead of prompt()'s).
var _pwdModalMode = 'change';
var _pwdModalTempPw = '';

function changePassword(){
  if(!SAAS.sessionToken){ toast('\u26a0 Session expired — please sign in again'); return; }
  openPwdModal('change');
}

// Forced reset on first login for staff accounts created via Invite Staff
// (mustResetPassword:true — see sendStaffInvite/add-staff). currentTempPw
// is the password they just logged in with, passed straight through — no
// point asking for it again when we watched them type it seconds ago.
function forcePasswordReset(currentTempPw){
  openPwdModal('forced', currentTempPw);
}

function openPwdModal(mode, tempPw){
  _pwdModalMode = mode;
  _pwdModalTempPw = tempPw || '';
  var isForced = mode === 'forced';

  document.getElementById('pwd-modal-title').textContent = isForced ? '\ud83d\udd10 Set Your Password' : '\ud83d\udd10 Change Password';
  document.getElementById('pwd-modal-msg').textContent = isForced
    ? 'This is your first login with a temporary password. For security, please set your own password now before continuing.'
    : 'Enter your current password and choose a new one.';
  document.getElementById('pwd-current-wrap').style.display = isForced ? 'none' : '';
  document.getElementById('pwd-current').value = '';
  document.getElementById('pwd-new').value = '';
  document.getElementById('pwd-error').textContent = '';
  document.getElementById('pwd-close-btn').style.display = isForced ? 'none' : '';
  document.getElementById('pwd-cancel-btn').textContent = isForced ? 'Sign Out' : 'Cancel';
  document.getElementById('pwd-submit-btn').disabled = false;
  document.getElementById('pwd-submit-btn').textContent = isForced ? 'Set Password' : 'Change Password';
  document.getElementById('pwd-modal').classList.add('open');
  setTimeout(function(){
    var el = document.getElementById(isForced ? 'pwd-new' : 'pwd-current');
    if(el) el.focus();
  }, 80);
}

function closePwdModal(){
  if(_pwdModalMode === 'forced'){
    // Matches the original forced-reset guarantee: closing/cancelling
    // must not leave a temp-password session active in the dashboard.
    document.getElementById('pwd-modal').classList.remove('open');
    saasForceLogout('You must set a new password to continue. Sign in again with your temporary password.');
    return;
  }
  document.getElementById('pwd-modal').classList.remove('open');
}

function togglePwdVis(id){
  var el = document.getElementById(id);
  if(!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

function submitPwdModal(){
  var isForced = _pwdModalMode === 'forced';
  var errEl = document.getElementById('pwd-error');
  var current = isForced ? _pwdModalTempPw : document.getElementById('pwd-current').value;
  var newPw = document.getElementById('pwd-new').value;

  if(!isForced && !current){ errEl.textContent = 'Enter your current password'; return; }
  if(!newPw || newPw.length < 8){ errEl.textContent = 'New password must be at least 8 characters'; return; }

  var btn = document.getElementById('pwd-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  errEl.textContent = '';

  authGatewayCall('change-password', {sessionToken: SAAS.sessionToken, currentPassword: current, newPassword: newPw})
    .then(function(){
      document.getElementById('pwd-modal').classList.remove('open');
      if(isForced){
        toast('\u2713 Password set — welcome to JewelOS!');
        saasActivityLog('account', 'Password changed (forced first-login reset)');
        if(SAAS.user) SAAS.user.mustResetPassword = false;
        saasSetSession(SAAS.user, SAAS.shop, SAAS.sessionToken); // now safe to keep on the device
        hideAuthScreen();
        bootApp();
      } else {
        toast('\u2713 Password changed!');
        saasActivityLog('account', 'Password changed');
      }
    })
    .catch(function(err){
      btn.disabled = false;
      btn.textContent = isForced ? 'Set Password' : 'Change Password';
      errEl.textContent = (err.data && err.data.error) ? err.data.error : (isForced ? 'Could not set password — try again' : 'Could not change password');
    });
}

// ── ONBOARDING ──────────────────────────────────────────────────────
function showOnboardingScreen(){
  _hideLoadingScreen();
  var el = document.getElementById('saas-onboard-screen');
  if(!el) return;
  if(SAAS.shop){
    document.getElementById('ob-shopname').value = SAAS.shop.name  || '';
    document.getElementById('ob-city').value     = SAAS.shop.city  || '';
    document.getElementById('ob-phone').value    = SAAS.shop.phone || '';
    document.getElementById('ob-gstin').value    = SAAS.shop.gstin || '';
  }
  el.style.display = 'flex';
}

function saasOnboardSave(){
  var name  = (document.getElementById('ob-shopname').value||'').trim();
  var city  = (document.getElementById('ob-city').value||'').trim();
  var phone = (document.getElementById('ob-phone').value||'').trim();
  var gstin = (document.getElementById('ob-gstin').value||'').trim().toUpperCase();
  var errEl = document.getElementById('ob-err');

  if(!name){ errEl.textContent='Shop name is required'; return; }
  if(!city){ errEl.textContent='City is required'; return; }
  // QA 30 Sep: an invalid GSTIN and a 5-digit phone were accepted and printed on bills.
  if(gstin && !isValidGSTIN(gstin)){ errEl.textContent='GSTIN is not valid -- check each of the 15 characters (like 27ABCDE1234F1Z0). Leave it blank if you are not GST-registered.'; return; }
  var _ph = normPhone10(phone);
  if(_ph === null){ errEl.textContent='Phone should be a 10-digit mobile number starting 6-9, like 98765 43210.'; return; }
  phone = _ph;

  var shops = saasGetShops();
  var idx   = shops.findIndex(function(s){ return s.id===SAAS.shop.id; });
  var locale = 'en-IN'; // F5: the USD/AED choice did nothing anywhere else in the app; removed
  if(idx !== -1){
    shops[idx].name   = name;
    shops[idx].city   = city;
    shops[idx].phone  = phone;
    shops[idx].gstin  = gstin;
    shops[idx].locale = locale;
    saasSetShops(shops);
    SAAS.shop = shops[idx];
  }

  var obErrEl = document.getElementById('ob-err');
  if(obErrEl) obErrEl.textContent = '⏳ Saving shop details...';
  authGatewayCall('update-shop', {sessionToken: SAAS.sessionToken, name:name, city:city, phone:phone, gstin:gstin, locale:locale})
    .then(function(res){
      if(res.shop){ SAAS.shop = res.shop; saasSetShops([res.shop]); }
    })
    .catch(function(err){
      console.warn('[JewelOS] update-shop failed (will retry from Settings):', err);
    })
    .then(function(){
      // store-proxy auto-creates this shop's data row on its first save —
      // no separate "create the row" step needed anymore.
      document.getElementById('saas-onboard-screen').style.display = 'none';
      bootApp();
    });
}

// ── BOOT APP ─────────────────────────────────────────────────────────
// Called after successful login/signup. Initialises the data layer
// with the correct shop row key before handing off to startApp().
function bootApp(){
  updateHeaderUI();
  applyFeatureGates();
  // v18 — show changelog once per version, per shop. It was unscoped, which
  // the regression guard never caught because the key reached localStorage
  // through a variable rather than a literal: a second shop signing in on the
  // same device inherited the first one's "already seen" and skipped it.
  var V18_KEY = shopScopedKey('jewelos_v18_seen');
  if(!localStorage.getItem(V18_KEY)){
    try{ localStorage.setItem(V18_KEY,'1'); } catch(e){}
    setTimeout(function(){
      showV18Changelog();
    }, 2000);
  }
  // (Removed: one-time "push localStorage accounts to cloud" migration —
  // that pushed directly to auth_store, which is now locked down. Any
  // account created before this fix already exists in auth_store from
  // when that table was still directly writable; nothing left to migrate.)
  // After a fresh SaaS login, always require PIN (unless no PIN is set)
  if(!isPinSet()){
    // No PIN configured yet — skip PIN screen, go straight to app
    markPinSessionActive();
    _appStarted = true;
    var ps = document.getElementById('pin-screen');
    if(ps) ps.classList.add('hidden');
    // Restore visibility
    var header=document.querySelector('header.topbar');
    var mainEl=document.querySelector('main.main');
    var bnav=document.querySelector('.bnav');
    if(header) header.style.visibility='';
    if(mainEl)  mainEl.style.visibility='';
    if(bnav)    bnav.style.visibility='';
    startApp();
  } else if(isPinSessionActive()){
    // PIN already verified this tab session (e.g. re-login after timeout)
    _appStarted = true;
    var ps2 = document.getElementById('pin-screen');
    if(ps2) ps2.classList.add('hidden');
    var header2=document.querySelector('header.topbar');
    var mainEl2=document.querySelector('main.main');
    var bnav2=document.querySelector('.bnav');
    if(header2) header2.style.visibility='';
    if(mainEl2)  mainEl2.style.visibility='';
    if(bnav2)    bnav2.style.visibility='';
    startApp();
  } else {
    // Fresh SaaS login in this tab — show PIN screen
    var ps3 = document.getElementById('pin-screen');
    if(ps3) ps3.classList.remove('hidden');
    var header3=document.querySelector('header.topbar');
    var mainEl3=document.querySelector('main.main');
    var bnav3=document.querySelector('.bnav');
    if(header3) header3.style.visibility='hidden';
    if(mainEl3)  mainEl3.style.visibility='hidden';
    if(bnav3)    bnav3.style.visibility='hidden';
    // Security review, 20-21 Sep 2026: this branch only runs when isPinSet()
    // is true (the sibling !isPinSet() branch above already returned) -- the
    // "Default PIN: 1234" hint that used to sit here could never actually
    // show. Deleted rather than reworded.
  }
  saasActivityLog('auth', 'Signed in as '+(SAAS.user?SAAS.user.name:'')+'');
}

// ── HEADER UI UPDATE ─────────────────────────────────────────────────
function updateHeaderUI(){
  var shopNameEl = document.getElementById('header-shop-name');
  var userInfoEl = document.getElementById('header-user-info');
  if(shopNameEl && SAAS.shop){
    // No plan badge. One product at one price — a tier label on every screen
    // told the jeweller he was on a lesser version of something.
    shopNameEl.innerHTML = '<span>'+escHtml(SAAS.shop.name||'My Shop')+'</span>';
  }
  if(userInfoEl && SAAS.user){
    userInfoEl.textContent = SAAS.user.name + ' \u00b7 ' + (SAAS.user.role||'owner');
  }
}

// ── FEATURE GATING — REMOVED, every shop is Pro ───────────────────────
var _PRO_FEATURES = { girvi:true, reports:true, orders:true, whatsapp:true, csvExport:true, purchases:true, maxProducts:999999 };
var PLAN_FEATURES = { free:_PRO_FEATURES, basic:_PRO_FEATURES, pro:_PRO_FEATURES };

function canAccess(feature){
  var limits = PLAN_FEATURES[SAAS.plan] || PLAN_FEATURES['free'];
  return !!limits[feature];
}

function applyFeatureGates(){
  var plan = SAAS.plan || 'free';
  // Girvi tab — hide for free/basic
  var girviDtab = document.getElementById('dtab-girvi');
  if(!canAccess('girvi')){
    if(girviDtab) girviDtab.style.opacity = '0.4';
  }
  // Reports gate removed — every shop has reports.
  // WhatsApp gate
  if(!canAccess('whatsapp')){
    // WhatsApp buttons will check canAccess() before acting
  }

  // ── Staff role: hide restricted nav tabs ──────────────────────────────
  if(isStaff()){
    // Hide tabs staff cannot access
    var staffHide = ['customers','reports','girvi','settings'];
    staffHide.forEach(function(t){
      var btn = document.getElementById('bn-'+t);
      if(btn) btn.style.display = 'none';
      // Also hide desktop tab
      document.querySelectorAll('.dtab').forEach(function(el,i){
        var tabs = ['dashboard','inventory','sales','orders','girvi','customers','reports','daybook','settings'];
        if(tabs[i]===t) el.style.display='none';
      });
    });
    // Show a staff badge in header
    var headerRight = document.querySelector('.header-right, .topbar-right, header .right');
    var staffBadge = document.getElementById('staff-role-badge');
    if(!staffBadge){
      staffBadge = document.createElement('div');
      staffBadge.id = 'staff-role-badge';
      staffBadge.style.cssText = 'font-size:10px;padding:3px 10px;border-radius:var(--radius-pill);background:var(--warning-soft);color:var(--warning);font-weight:700;letter-spacing:.06em;';
      staffBadge.textContent = 'STAFF';
      var topbar = document.querySelector('header.topbar');
      if(topbar) topbar.appendChild(staffBadge);
    }
  }
}

// addGateOverlay() removed with the pricing modal. It painted a padlock over a
// panel and offered "Upgrade to unlock" — there is nothing to upgrade to.
// Whether a shop can work is decided by paidUntil, not by tier.

function guardFeature(feature, requiredPlan){
  // Kept because callers still guard on it, but every feature is available to
  // every shop, so this only ever returns true. It no longer opens a pricing
  // modal, because there is no longer a pricing modal.
  return canAccess(feature);
}

// ── ACTIVITY LOG ─────────────────────────────────────────────────────
// Immutable append-only: all actions are logged with user, timestamp, action
function saasActivityLog(type, note){
  var entry = {
    type: type,
    note: note,
    user: SAAS.user ? SAAS.user.name : 'system',
    role: SAAS.user ? SAAS.user.role : '',
    ts:   new Date().toISOString()
  };
  // Append to S.activityLog (persisted with shop data)
  if(!S.activityLog) S.activityLog = [];
  S.activityLog.unshift(entry);
  // Keep last 200 entries only
  if(S.activityLog.length > 200) S.activityLog = S.activityLog.slice(0, 200);
}

// FIX: the old patchWriteOps() wrapper here claimed to "ensure activityLog
// is included in payload" but never actually did — it just called the
// original saveToCloud unchanged. Neither S.activityLog nor S.auditLog
// were ever sent to the cloud at all; they only survived locally (see
// saveCache/loadCache in 04-orders-detail.js). That's the real reason
// both Audit and Activity Log looked like they "didn't save changes" —
// they genuinely didn't, past this one device/browser. Now included
// directly in saveToCloud()'s dataPayload — see 01-sync-core.js.

// ── ROLE-BASED ACCESS ────────────────────────────────────────────────
function isOwner(){  return SAAS.user && SAAS.user.role === 'owner';   }
function isManager(){ return SAAS.user && (SAAS.user.role==='owner'||SAAS.user.role==='manager'); }
function isStaff(){  return SAAS.user && SAAS.user.role === 'staff';   }

// Staff guard: blocks delete/edit operations for staff-only users
function guardWrite(action){
  if(isStaff()){
    toast('\u26a0 Staff accounts cannot '+action+'. Ask the owner or manager.');
    return false;
  }
  return true;
}

// Patch delete operations for role-based control
(function patchRoleGuards(){
  var _origDeleteProd = window.deleteProduct;
  if(typeof _origDeleteProd === 'function'){
    window.deleteProduct = function(id){
      if(!guardWrite('delete products')) return;
      saasActivityLog('inventory', 'Product deleted: ID '+id);
      _origDeleteProd(id);
    };
  }
}());

// ── STAFF MANAGEMENT ────────────────────────────────────────────────
function openInviteStaff(){
  document.getElementById('set-invite-form').style.display = '';
  document.getElementById('inv-name').focus();
}

function sendStaffInvite(){
  var name  = (document.getElementById('inv-name').value||'').trim();
  var email = (document.getElementById('inv-email').value||'').trim().toLowerCase();
  var role  = document.getElementById('inv-role').value;

  if(!name)  { toast('\u26a0 Enter staff name'); return; }
  if(!email || !email.includes('@')) { toast('\u26a0 Enter valid email'); return; }

  if(!SAAS.sessionToken){ toast('\u26a0 Session expired — please sign in again'); return; }

  authGatewayCall('add-staff', {sessionToken: SAAS.sessionToken, name: name, email: email, role: role})
    .then(function(res){
      // Local cache: add the new teammate's (sanitized) record so the
      // Settings team list reflects them immediately without a reload.
      var users = saasGetUsers();
      users.push(res.user);
      saasSetUsers(users);
      saasActivityLog('team', 'Invited '+name+' as team member');

      document.getElementById('set-invite-form').style.display = 'none';
      document.getElementById('inv-name').value = '';
      document.getElementById('inv-email').value = '';

      // Show temp password to owner (in production this would email it) —
      // this is the ONLY place it ever exists in plaintext; the server
      // never stores it, only its hash.
      alert('Staff account created!\n\nEmail: '+email+'\nTemp Password: '+res.tempPassword+'\n\nShare these credentials with '+name+'.\nThey should change their password after first login.');
      renderSettings();
      toast('\u2705 '+name+' added to your team');
    })
    .catch(function(err){
      toast('\u26a0 '+((err.data && err.data.error) ? err.data.error : 'Could not add team member'));
    });
}

// ── LEGAL MODALS — Privacy Policy & Terms of Service ─────────────────
function showLegalModal(type){
  var modal = document.getElementById('legal-modal');
  var content = document.getElementById('legal-modal-content');
  if(!modal || !content) return;

  var shopName = (SAAS && SAAS.shop && SAAS.shop.name) ? escHtml(SAAS.shop.name) : 'JewelOS';
  var today = new Date().toLocaleDateString('en-IN',{year:'numeric',month:'long',day:'numeric'});

  if(type === 'privacy'){
    content.innerHTML =
      '<h2 style="font-size:18px;font-weight:700;margin-bottom:4px;color:var(--ink1);">Privacy Policy</h2>'+
      '<p style="font-size:11px;color:var(--text3);margin-bottom:20px;">Last updated: '+today+'</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">1. Data We Collect</h3>'+
      '<p>JewelOS collects the following information when you use our service: your name, email address, shop details (name, city, GSTIN, phone), and business data you enter (customer records, sales, inventory, and loan records). We do not collect payment card details — payments are processed by Razorpay and governed by their privacy policy.</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">2. How We Use Your Data</h3>'+
      '<p>Your data is used solely to operate the JewelOS service — to store and retrieve your business records, process your subscription, and send service-related communications. We do not sell, rent, or share your personal data with third parties for marketing purposes.</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">3. Data Storage & Security</h3>'+
      '<p>Your data is stored on Supabase (supabase.com), a secure cloud database provider. Data is encrypted in transit (TLS) and at rest. Access is restricted by Row-Level Security policies ensuring each shop can only access its own data.</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">4. Customer Data You Enter</h3>'+
      '<p>You are responsible for obtaining appropriate consent from your customers before entering their personal information (names, phone numbers, addresses) into JewelOS. You must comply with India\'s Digital Personal Data Protection Act (DPDPA) 2023 in how you collect and use your customers\' data.</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">5. Data Retention & Deletion</h3>'+
      '<p>Your data is retained for as long as your account is active. You may export a full backup at any time from Settings → Data. To delete your account and all associated data, contact us at support@jewelos.in.</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">6. Your Rights</h3>'+
      '<p>Under the DPDPA 2023, you have the right to access, correct, and erase your personal data. Contact us at support@jewelos.in to exercise these rights.</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">7. Contact</h3>'+
      '<p>For privacy-related queries: <strong>support@jewelos.in</strong></p>';
  } else {
    content.innerHTML =
      '<h2 style="font-size:18px;font-weight:700;margin-bottom:4px;color:var(--ink1);">Terms of Service</h2>'+
      '<p style="font-size:11px;color:var(--text3);margin-bottom:20px;">Last updated: '+today+'</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">1. Acceptance</h3>'+
      '<p>By creating an account and using JewelOS, you agree to these Terms of Service. If you do not agree, do not use the service.</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">2. Service Description</h3>'+
      '<p>JewelOS is a cloud-based jewellery shop management application providing inventory management, billing, order tracking, gold pledge (Girvi) management, and related features for jewellery businesses.</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">3. Subscriptions & Payments</h3>'+
      '<p>JewelOS is offered on a subscription basis. Payment is processed by Razorpay. Subscriptions renew monthly. You may cancel at any time; cancellation takes effect at the end of the billing period. No refunds are provided for partial months.</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">4. Your Responsibilities</h3>'+
      '<p>You are responsible for: (a) maintaining the confidentiality of your account credentials; (b) all data entered into JewelOS; (c) compliance with all applicable laws including GST regulations, BIS Hallmark rules, and state Moneylenders Acts if using the Girvi module; (d) ensuring accuracy of invoices and financial records generated by the software.</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">5. Disclaimer</h3>'+
      '<p>JewelOS provides tools to assist your business operations. It does not provide legal, financial, or tax advice. Invoice numbers, GST calculations, and interest computations generated by the software should be verified by a qualified accountant or CA before use in official filings.</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">6. Limitation of Liability</h3>'+
      '<p>JewelOS is provided "as is." We are not liable for any business loss, data loss, or damages arising from use of the software. Our maximum liability is limited to the subscription fees paid in the preceding 3 months.</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">7. Governing Law</h3>'+
      '<p>These Terms are governed by the laws of India. Disputes shall be subject to the jurisdiction of courts in Mumbai, Maharashtra.</p>'+
      '<h3 style="font-size:13px;font-weight:700;margin:16px 0 6px;">8. Contact</h3>'+
      '<p>For support: <strong>support@jewelos.in</strong></p>';
  }

  modal.style.display = 'block';
}

// ── IN-APP PAYMENT — PARKED, NOT REACHABLE ───────────────────────────
// upgradePlan / _openRazorpay / _activatePlan / saveRazorpayKey below are
// intentionally kept but no longer reachable from the UI. JewelOS is sold
// face to face: Tanish demos it, the shop pays by UPI, and he sets paidUntil
// in Supabase. There is no in-app payment, and the Upgrade button that used
// to lead here told the jeweller to create his OWN Razorpay account — which
// would have routed his money to himself.
//
// DO NOT DELETE. This comes back when there are enough customers to justify
// automating collection. Re-entry point would be a button calling
// upgradePlan(); everything downstream of that still works.
// The razorpay-webhook Edge Function is likewise still deployed and parked.
// Plan prices in paise (INR × 100)
var PLAN_PRICES = { basic: 49900, pro: 99900 };
var PLAN_NAMES  = { basic: 'Basic ₹499/mo', pro: 'Pro ₹999/mo' };

function upgradePlan(plan){
  if(!SAAS.user || !SAAS.shop){
    toast('\u26a0 Please sign in first');
    return;
  }
  if(SAAS.plan === plan){
    toast('You are already on the '+plan+' plan');
    return;
  }

  // Check Razorpay is available
  if(typeof Razorpay === 'undefined'){
    // Load Razorpay SDK dynamically
    var script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = function(){ _openRazorpay(plan); };
    script.onerror = function(){
      toast('\u26a0 Payment gateway failed to load. Check your internet and try again.');
    };
    document.head.appendChild(script);
  } else {
    _openRazorpay(plan);
  }
}

function _openRazorpay(plan){
  // ── PRODUCTION: Replace RAZORPAY_KEY_ID with your live key from razorpay.com ──
  var RAZORPAY_KEY_ID = (function(){
    try{ return localStorage.getItem('jewelos_rzp_key') || 'rzp_test_REPLACE_WITH_YOUR_KEY'; }catch(e){ return 'rzp_test_REPLACE_WITH_YOUR_KEY'; }
  })();

  if(RAZORPAY_KEY_ID === 'rzp_test_REPLACE_WITH_YOUR_KEY'){
    // Key not configured — show setup instructions to owner
    safeConfirm(
      'Payment setup required',
      'To accept payments, add your Razorpay Key ID in Settings \u2192 Billing \u2192 Payment Setup. Get your key at razorpay.com (free signup).',
      function(){
        var _pm = document.getElementById('pricing-modal'); if(_pm) _pm.style.display='none';
        switchTab('settings');
      }
    );
    return;
  }

  var amount  = PLAN_PRICES[plan] || 49900;
  var planLbl = PLAN_NAMES[plan]  || plan;

  var options = {
    key:          RAZORPAY_KEY_ID,
    amount:       amount,
    currency:     'INR',
    name:         'JewelOS',
    description:  planLbl + ' subscription',
    image:        '',
    prefill: {
      name:  SAAS.user.name  || '',
      email: SAAS.user.email || '',
      contact: (SAAS.shop && SAAS.shop.phone) || ''
    },
    notes: {
      shop_id:   SAAS.shop.id,
      plan:      plan,
      user_id:   SAAS.user.id
    },
    theme: { color: '#c9a34e' },
    handler: function(response){
      // Payment captured — activate plan
      // In production: also verify payment_id on your backend / Supabase Edge Function
      _activatePlan(plan, response.razorpay_payment_id);
    },
    modal: {
      ondismiss: function(){
        toast('Payment cancelled');
      }
    }
  };

  try{
    var rzp = new Razorpay(options);
    rzp.on('payment.failed', function(resp){
      toast('\u26a0 Payment failed: ' + (resp.error && resp.error.description ? resp.error.description : 'Please try again'));
      console.error('[JewelOS] Razorpay payment failed:', resp.error);
    });
    rzp.open();
  } catch(e){
    toast('\u26a0 Could not open payment window. Refresh and try again.');
    console.error('[JewelOS] Razorpay open error:', e);
  }
}

function _activatePlan(plan, paymentId){
  var shops = saasGetShops();
  var idx   = shops.findIndex(function(s){ return s.id===SAAS.shop.id; });
  if(idx !== -1){
    shops[idx].plan           = plan;
    shops[idx].lastPaymentId  = paymentId || '';
    shops[idx].planActivatedAt= new Date().toISOString();
    saasSetShops(shops);
    SAAS.shop.plan = plan;
    SAAS.plan      = plan;
  }
  var _pm = document.getElementById('pricing-modal'); if(_pm) _pm.style.display = 'none';  // parked: no such modal now
  applyFeatureGates();
  updateHeaderUI();
  renderSettings();
  saasActivityLog('billing', 'Upgraded to '+plan+' plan (payment: '+(paymentId||'manual')+')');
  toast('\u2705 Plan upgraded to '+plan.toUpperCase()+'! New features unlocked.');
}

// Called from Settings to configure the daily digest recipient
function saveDigestEmail(){
  var el = document.getElementById('set-digest-email');
  if(!el) return;
  var email = el.value.trim();
  if(!email || !email.includes('@')){ toast('\u26a0 Enter a valid email'); return; }
  try{ localStorage.setItem(shopScopedKey('jewelos_digest_email'), email); } catch(e){}
  toast('\u2705 Digest email saved: ' + email);
}

function saveRazorpayKey(){
  var keyEl = document.getElementById('set-rzp-key');
  if(!keyEl) return;
  var key = keyEl.value.trim();
  if(!key.startsWith('rzp_')){ toast('\u26a0 Invalid key — must start with rzp_live_ or rzp_test_'); return; }
  try{ localStorage.setItem('jewelos_rzp_key', key); } catch(e){}
  toast('\u2705 Razorpay key saved');
}

// ── SETTINGS PANEL ───────────────────────────────────────────────────
function renderSettings(){
  if(!SAAS.shop || !SAAS.user) return;

  // Fill shop profile
  var sn = document.getElementById('set-shopname');
  var sc = document.getElementById('set-city');
  var sp = document.getElementById('set-phone');
  var sg = document.getElementById('set-gstin');
  if(sn) sn.value = SAAS.shop.name  || '';
  if(sc) sc.value = SAAS.shop.city  || '';
  if(sp) sp.value = SAAS.shop.phone || '';
  if(sg) sg.value = SAAS.shop.gstin || '';

  // Plan badge and feature list removed with the Plan settings tab.

  // Staff list
  var staffEl = document.getElementById('set-staff-list');
  if(staffEl){
    var users = saasGetUsers().filter(function(u){ return u.shopId===SAAS.shop.id; });
    if(!users.length){ staffEl.innerHTML='<div style="font-size:12px;color:var(--text3);">No team members yet.</div>'; }
    else {
      staffEl.innerHTML = users.map(function(u){
        var roleClass = u.role==='owner'?'':'staff';
        return '<div class="log-row">'+
          '<div><b>'+escHtml(u.name)+'</b><div style="font-size:11px;color:var(--text3);">'+escHtml(u.email)+'</div></div>'+
          '<div style="text-align:right;"><span class="role-badge '+roleClass+'">'+escHtml(u.role)+'</span>'+
          (u.id!==SAAS.user.id&&isOwner()?'<br><a onclick="removeStaff(\''+u.id+'\')" style="font-size:10px;color:var(--danger);cursor:pointer;margin-top:3px;display:block;">Remove</a>':'')+
          '</div></div>';
      }).join('');
    }
  }

  // Activity log
  var logEl = document.getElementById('set-activity-log');
  if(logEl){
    var log = (S.activityLog||[]).slice(0,20);
    if(!log.length){ logEl.innerHTML='<div style="font-size:12px;color:var(--text3);">No activity yet.</div>'; }
    else {
      logEl.innerHTML = log.map(function(l){
        return '<div class="log-row">'+
          '<div><span style="font-size:11px;color:var(--text3);">'+escHtml(l.type)+'</span><br><span style="font-size:13px;">'+escHtml(l.note)+'</span></div>'+
          '<div style="font-size:10px;color:var(--text3);text-align:right;min-width:70px;">'+fmtDate(l.ts)+'<br>'+fmtTime(l.ts)+'<br><span style="font-weight:600;">'+escHtml(l.user)+'</span></div>'+
        '</div>';
      }).join('');
    }
  }

  // Last backup
  var lastBackupEl = document.getElementById('set-last-backup');
  var lastSave = localStorage.getItem('ssj_last_save');
  if(lastBackupEl && lastSave){
    lastBackupEl.textContent = 'Last sync: '+new Date(parseInt(lastSave)).toLocaleString('en-IN');
  }

  // Cloud connection status badge
  (function(){
    var badge = document.getElementById('cloud-status-badge');
    var line  = document.getElementById('cloud-status-line');
    if(!badge||!line) return;
    var lastSave = parseInt(localStorage.getItem('ssj_last_save')||'0');
    var lastLoad = parseInt(localStorage.getItem('ssj_last_cloud_load')||'0');
    var lastEvent = Math.max(lastSave, lastLoad);
    if(!lastEvent){
      badge.textContent='\u26aa Not connected yet';
      badge.style.cssText='background:rgba(100,100,100,.12);color:var(--text3);font-size:10px;padding:2px 8px;border-radius:var(--radius-pill);font-weight:600;';
      if(line) line.textContent='Open any tab to connect to cloud.';
    } else {
      var minsAgo=Math.round((Date.now()-lastEvent)/60000);
      var ok=minsAgo<5;
      badge.textContent=ok?'\ud83d\udfe2 Connected':'\ud83d\udfe1 Last sync '+minsAgo+'m ago';
      badge.style.cssText='font-size:10px;padding:2px 8px;border-radius:var(--radius-pill);font-weight:600;background:'+(ok?'var(--success-soft)':'var(--warning-soft)')+';color:'+(ok?'var(--success)':'var(--warning)')+';';
      if(line) line.textContent='Last sync: '+new Date(lastEvent).toLocaleTimeString('en-IN')+(isSaving?' · Saving...':(ok?' · Cloud OK':' · Check connection'));
    }
  })();

  // Digest email field
  var digestEl = document.getElementById('set-digest-email');
  if(digestEl){
    try{ digestEl.value = localStorage.getItem(shopScopedKey('jewelos_digest_email')) || ''; }catch(e){}
  }

  // Razorpay key field
  var rzpKeyEl = document.getElementById('set-rzp-key');
  if(rzpKeyEl){
    try{ rzpKeyEl.value = localStorage.getItem('jewelos_rzp_key') || ''; }catch(e){}
  }

  // Account info
  // NOTE: the tabs patch in 06-inventory-stock.js wraps this function and
  // re-renders several of the same blocks after calling it, so for anything
  // both of them touch — shop fields, staff, activity log, last backup and
  // this account card — that copy runs second and wins. Change it there.
  var accEl = document.getElementById('set-account-info');
  if(accEl){
    accEl.innerHTML = '<b>'+escHtml(SAAS.user.name)+'</b> &bull; '+escHtml(SAAS.user.email)+' &bull; <span class="role-badge '+(SAAS.user.role==='owner'?'':'staff')+'">'+escHtml(SAAS.user.role)+'</span>' + subAccountLineHtml();
  }
}

function saveShopProfile(){
  if(!isManager()){ toast('\u26a0 Only owners or managers can update shop profile'); return; }
  if(!SAAS.sessionToken){ toast('\u26a0 Session expired — please sign in again'); return; }
  var name  = (document.getElementById('set-shopname').value||'').trim() || SAAS.shop.name;
  var city  = (document.getElementById('set-city').value||'').trim()     || SAAS.shop.city;
  var phone = (document.getElementById('set-phone').value||'').trim();
  var gstin = (document.getElementById('set-gstin').value||'').trim().toUpperCase();
  if(gstin && !isValidGSTIN(gstin)){ toast('GSTIN is not valid -- check each of the 15 characters (like 27ABCDE1234F1Z0). Leave it blank if you are not GST-registered.'); return; }
  var _ph = normPhone10(phone);
  if(_ph === null){ toast('Phone should be a 10-digit mobile number starting 6-9, like 98765 43210.'); return; }
  phone = _ph;

  authGatewayCall('update-shop', {sessionToken: SAAS.sessionToken, name:name, city:city, phone:phone, gstin:gstin})
    .then(function(res){
      SAAS.shop = res.shop;
      saasSetShops([res.shop]);
      updateHeaderUI();
      saasActivityLog('settings', 'Shop profile updated');
      toast('\u2713 Shop profile saved!');
    })
    .catch(function(err){
      toast('\u26a0 '+((err.data && err.data.error) ? err.data.error : 'Could not save shop profile'));
    });
}

function removeStaff(userId){
  if(!isOwner()){ toast('Only the owner can remove staff'); return; }
  if(!SAAS.sessionToken){ toast('\u26a0 Session expired — please sign in again'); return; }
  safeConfirm('Remove staff member?','This will revoke their access to the shop.',function(){
    authGatewayCall('remove-staff', {sessionToken: SAAS.sessionToken, staffUserId: userId})
      .then(function(){
        var users = saasGetUsers().filter(function(u){ return u.id!==userId; });
        saasSetUsers(users);
        saasActivityLog('team', 'Staff member removed');
        renderSettings();
        toast('Staff member removed');
      })
      .catch(function(err){
        toast('\u26a0 '+((err.data && err.data.error) ? err.data.error : 'Could not remove team member'));
      });
  },true);
  return;
}

// ── SIGN-IN FOOTER ───────────────────────────────────────────────────
// The year was hard-coded in the markup and had already gone stale. The span
// keeps a value so the line never renders as "©  JewelOS" if this never runs.
function setFooterYear(){
  var el = document.getElementById('footer-year');
  if(el) el.textContent = new Date().getFullYear();
}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', setFooterYear);
} else {
  setFooterYear();
}

// ── BACKUP & RESTORE ─────────────────────────────────────────────────
function exportFullBackup(){
  if(!guardFeature('csvExport','basic')) return;
  // v9: previously this saved only products/sales/orders/girvi/rates/customers,
  // silently leaving out purchase bills, suppliers and stock-movement history —
  // so a "Full Backup" was not full, and restoring one wiped those lists.
  // Account/auth state (SAAS.shop, SAAS.user, plan, sessionToken) stays out on
  // purpose: it belongs to the login, not the shop's records, and restoring it
  // into a different account would be wrong.
  //
  // The TEAM ROSTER is left out for the same reason, spelled out because its
  // absence looked like an oversight in the 17 Sep review. It is not one:
  //   - It is not in S. This file backs up the shop blob; users live in the
  //     server's auth_store, and jewelos_users on this device is only a cache
  //     of them (see saasSetUsers, 04-orders-detail.js).
  //   - Nothing is at risk. The roster survives on the server whatever happens
  //     to the shop blob, so a restore would be putting back something that was
  //     never lost.
  //   - Restoring it would be a security regression. A backup file is untrusted
  //     input, so an older one would re-create staff removed since it was taken
  //     — undoing the removed-staff fix (store-proxy v7, 14 Sep).
  //   - It could not work anyway without exporting password hashes, which must
  //     never leave the server.
  // Export and restore are kept symmetric on purpose (checks/backup-check.js
  // enforces it), so adding team to one would mean adding it to both.
  var payload = {
    version: 'jewelos-v9',
    exportedAt: new Date().toISOString(),
    shopId: SAAS.shop ? SAAS.shop.id : 'unknown',
    shopName: SAAS.shop ? SAAS.shop.name : 'unknown',
    data: {
      products:   S.products,
      sales:      S.sales,
      orders:     S.orders,
      girvi:      S.girvi,
      customers:  S.customers||[],
      purchases:  S.purchases||[],
      suppliers:  S.suppliers||[],
      rates:      S.rates,
      purchaseCfg:S.purchaseCfg||null,
      waRules:    S.waRules||null,
      dayBook:    S.dayBook||null,
      stockMovements:   S.stockMovements||[],
      voidedInvNos:     S.voidedInvNos||[],
      activityLog:      (S.activityLog||[]).slice(0,100),
      auditLog:         (S.auditLog||[]).slice(0,100),
      purchaseAuditLog: (S.purchaseAuditLog||[]).slice(0,100),
      nextId:     S.nextId,
      nextSaleId: S.nextSaleId,
      nextInvNo:  S.nextInvNo,
      nextOrdId:  S.nextOrdId,
      nextGirviId:S.nextGirviId,
      nextPurchaseId:     S.nextPurchaseId,
      nextPurchaseBillNo: S.nextPurchaseBillNo
    }
  };
  var blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  var date = dbDayKey(new Date());
  a.href     = url;
  a.download = (SAAS.shop?SAAS.shop.name.replace(/\s+/g,'-'):'JewelOS')+'-backup-'+date+'.json';
  a.click();
  URL.revokeObjectURL(url);
  saasActivityLog('backup', 'Full backup exported');
  toast('\u2713 Backup downloaded!');
}

function importBackup(){
  document.getElementById('backup-file-input').click();
}

function processBackupFile(input){
  var file = input.files[0];
  if(!file) return;
  safeConfirm('Restore from backup?','This will REPLACE your current data. A cloud save will be triggered immediately.',function(){
    var reader = new FileReader();
    reader.onload = function(e){
      try{
        var parsed = JSON.parse(e.target.result);
        if(!parsed.data || !parsed.version || !parsed.version.startsWith('jewelos')){
          toast('\u26a0 Invalid backup file');
          return;
        }
        var d = parsed.data;
        // Restore every list the export writes. This used to stop after rates,
        // so customers/purchases/suppliers/stock history kept whatever was in
        // memory — then saveToCloud() below pushed that over the cloud copy,
        // which is how a "restore" could destroy the records it was protecting.
        if(d.products)   S.products    = d.products;
        if(d.sales)      S.sales       = d.sales;
        if(d.orders)     S.orders      = d.orders;
        if(d.girvi)      S.girvi       = d.girvi;
        if(d.customers)  S.customers   = d.customers;
        if(d.purchases)  S.purchases   = d.purchases;
        if(d.suppliers)  S.suppliers   = d.suppliers;
        if(d.rates)      S.rates       = d.rates;
        if(d.purchaseCfg)S.purchaseCfg = d.purchaseCfg;
        if(d.waRules)    S.waRules     = d.waRules;
        if(d.dayBook)    S.dayBook     = d.dayBook;
        if(d.stockMovements)   S.stockMovements   = d.stockMovements;
        if(d.voidedInvNos)     S.voidedInvNos     = d.voidedInvNos;
        if(d.activityLog)      S.activityLog      = d.activityLog;
        if(d.auditLog)         S.auditLog         = d.auditLog;
        if(d.purchaseAuditLog) S.purchaseAuditLog = d.purchaseAuditLog;
        if(d.nextId)     S.nextId      = d.nextId;
        if(d.nextSaleId) S.nextSaleId  = d.nextSaleId;
        if(d.nextInvNo)  S.nextInvNo   = d.nextInvNo;
        if(d.nextOrdId)  S.nextOrdId   = d.nextOrdId;
        if(d.nextGirviId)S.nextGirviId = d.nextGirviId;
        if(d.nextPurchaseId)     S.nextPurchaseId     = d.nextPurchaseId;
        if(d.nextPurchaseBillNo) S.nextPurchaseBillNo = d.nextPurchaseBillNo;
        normaliseData();
        saasActivityLog('backup', 'Data restored from backup: '+file.name);
        saveToCloud(function(err){
          if(!err){ renderDash(); toast('\u2705 Data restored and synced!'); }
          else { toast('\u26a0 Restored locally — cloud sync failed'); renderDash(); }
        });
      }catch(ex){
        toast('\u26a0 Could not read backup file: '+ex.message);
      }
      input.value = '';
    };
    reader.readAsText(file);
  },true);
  input.value='';
  return;
}

// ── WHATSAPP INTEGRATION ─────────────────────────────────────────────
function sendWhatsApp(phone, message){
  if(!phone){ toast('\u26a0 No phone number on file'); return; }
  var clean = phone.replace(/\D/g,'');
  if(clean.length === 10) clean = '91' + clean;
  var url = 'https://wa.me/'+clean+'?text='+encodeURIComponent(message);
  window.open(url, '_blank');
  saasActivityLog('whatsapp', 'WhatsApp sent to '+phone);
}

function custBalanceWA(custName, phone, balAmt){
  // custName arrives already HTML-attribute-decoded -- escaped with
  // jsAttrEsc() at the call site, not encodeURIComponent(), so no decode
  // here (security review, 23 Sep 2026 HANDOFF entry: encodeURIComponent()
  // was not safe attribute escaping and left a stored-XSS gap).
  var name = custName;
  var shopName = (SAAS&&SAAS.shop&&SAAS.shop.name)||'hamari dukaan';
  var msg = 'Namaste '+name+' ji \ud83d\ude4f\n\n'+
    '*'+shopName+'* ki taraf se yaad dila rahe hain \u2014\n\n'+
    'Aapka balance due hai: *\u20b9'+balAmt.toLocaleString('en-IN')+'*\n\n'+
    'Kripya jald payment karein ya shop par aayen.\n\n'+
    'Shukriya \ud83d\ude4f\n_'+shopName+'_';
  var cleanPhone = (phone||'').replace(/\D/g,'');
  if(cleanPhone.length===10) cleanPhone='91'+cleanPhone;
  if(!cleanPhone){ toast('\u26a0 No phone number for this customer'); return; }
  window.open('https://wa.me/'+cleanPhone+'?text='+encodeURIComponent(msg),'_blank');
}

function whatsappInvoice(saleId){
  var sale = (S.sales||[]).find(function(x){return x.id===saleId;});
  if(!sale){ toast('Sale not found'); return; }
  var t = calcSaleTotals(sale);
  var shopName = SAAS.shop ? SAAS.shop.name : 'our shop';
  var msg =
    '\ud83d\udc8e *'+shopName+'*\n' +
    '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n' +
    'Invoice: *'+sale.invNo+'*\n' +
    'Date: '+fmtDate(sale.date)+'\n' +
    'Customer: '+sale.customer+'\n\n' +
    'Items:\n' +
    (sale.items||[]).map(function(i){
      var metalValue = getItemRate(i)*(parseFloat(i.weight)||0);
      var makingCharge = i.isCustom ? (parseFloat(i.making)||0)*(parseFloat(i.weight)||0) : (parseFloat(i.making)||0);
      var stoneCharge = parseFloat(i.diamond)||0;
      var lineTotal = ((metalValue+makingCharge+stoneCharge)*(i.qty||1));
      return '\u2022 '+(i.name||i.desc||'Item')+' \u2014 \u20b9'+Math.round(lineTotal).toLocaleString('en-IN');
    }).join('\n') + '\n\n' +
    'Subtotal: \u20b9'+Math.round(t.sub).toLocaleString('en-IN')+'\n' +
    (t.gstAmt>0?'GST: \u20b9'+Math.round(t.gstAmt).toLocaleString('en-IN')+'\n':'')+
    (t.disc>0?'Discount: -\u20b9'+Math.round(t.disc).toLocaleString('en-IN')+'\n':'')+
    '*Total: \u20b9'+Math.round(t.grand).toLocaleString('en-IN')+'*\n' +
    (t.bal>0?'\u26a0 Balance due: \u20b9'+Math.round(t.bal).toLocaleString('en-IN')+'\n':'\u2705 Fully paid\n')+
    '\nThank you for your purchase! \ud83d\ude4f';
  sendWhatsApp(sale.phone, msg);
}

// Patch bill preview to add WhatsApp button
// FIX (found during a full-codebase bug sweep, Aug 2026): this wrapped
// window.viewBill, a function that has never existed anywhere in this
// codebase -- the real function is openInvoiceModal(html, initialBillType)
// in 03-billing-numbers.js, and the real modal id is 'invoice-modal', not
// 'bill-modal'. The guard below (typeof !== 'function') meant this whole
// patch silently no-op'd on every single page load -- the WhatsApp-share
// button on the bill preview has never actually appeared for anyone.
// CURRENT_SALE_FOR_PDF (02-ui-inactivity-modals.js) is set immediately
// before every real call to openInvoiceModal, so it's used here as the
// "which sale is this modal showing" reference the old code expected a
// saleId parameter for.
(function patchBillWhatsApp(){
  var _origOpenInvoiceModal = window.openInvoiceModal;
  if(typeof _origOpenInvoiceModal !== 'function') return;
  window.openInvoiceModal = function(html, initialBillType){
    _origOpenInvoiceModal(html, initialBillType);
    var saleForButton = (typeof CURRENT_SALE_FOR_PDF !== 'undefined') ? CURRENT_SALE_FOR_PDF : null;
    if(!saleForButton || !saleForButton.id) return;
    var saleId = saleForButton.id;
    // Try to inject WA button into modal after a tick
    setTimeout(function(){
      var modal = document.getElementById('invoice-modal');
      if(!modal) return;
      var existing = modal.querySelector('.wa-btn-injected');
      if(existing) existing.remove(); // avoid stacking one per re-open of the same modal instance
      var waBtn = document.createElement('button');
      waBtn.className = 'wa-btn-injected';
      waBtn.style.cssText = 'margin:0 8px;padding:9px 18px;border-radius:10px;border:none;background:#25d366;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;';
      waBtn.innerHTML = '\ud83d\udcf1 WhatsApp Invoice';
      waBtn.onclick = function(){ whatsappInvoice(saleId); };
      var footer = modal.querySelector('.modal-footer') || modal.querySelector('.print-row') || modal;
      footer.appendChild(waBtn);
    }, 100);
  };
}());

// ── INITIAL BOOT CHECK ────────────────────────────────────────────────
// Called from window.onload — decides: show auth screen OR resume session
function saasBootCheck(){
  var session = saasGetSession();
  if(!session){
    // No valid session → show auth
    showAuthScreen();
    return false;
  }
  // Resume session
  var users = saasGetUsers();
  var shops = saasGetShops();
  var user  = users.find(function(u){ return u.id===session.userId; });
  var shop  = shops.find(function(s){ return s.id===session.shopId; });

  if(!user || !shop){
    showAuthScreen();
    return false;
  }

  saasSetSession(user, shop);

  // First time setup
  if(!shop.name || shop.name === ''){
    hideAuthScreen();
    showOnboardingScreen();
    return false;
  }

  hideAuthScreen();
  return true; // proceed with startApp
}

// ── UNIFIED BOOT — single window.onload, handles SaaS auth + PIN ─────
// Flow on every page load:
//  1. Does a valid SaaS session exist?
//     NO  → show auth screen, stop.
//     YES → restore SAAS.user + SAAS.shop
//  2. Is the PIN session active for THIS tab? (sessionStorage, clears on tab close)
//     YES → skip PIN screen, go straight to startApp()
//     NO  → show PIN screen. Correct PIN sets PIN_SESSION_KEY then calls startApp().
// This means:
//   - First visit / new tab → always asks PIN after login
//   - Same tab reload → skips PIN (sessionStorage persists across reloads)
//   - New tab or closed tab → asks PIN again (sessionStorage cleared)
window.onload = function(){
  // ── DISMISS LOADER ────────────────────────────────────────────────
  function dismissLoader(reason){
    var el = document.getElementById('loading-screen');
    if(el) el.classList.add('hidden');
    var btn = document.getElementById('loading-offline-btn');
    if(btn) btn.style.display = 'none';
  }

  // ── SAFETY NET: force-hide after 8s ──────────────────────────────
  var _safetyTimer = setTimeout(function(){
    dismissLoader('safety-net');
    try{ normaliseData(); renderDash(); }catch(e){}
  }, 8000);

  // ── "Continue Offline" button after 4s ───────────────────────────
  setTimeout(function(){
    var btn = document.getElementById('loading-offline-btn');
    var el  = document.getElementById('loading-screen');
    if(btn && el && !el.classList.contains('hidden')) btn.style.display='block';
  }, 4000);

  window._forceOfflineBoot = function(){
    clearTimeout(_safetyTimer);
    dismissLoader('user-offline');
    _startAppRunning = false;
    _appStarted = false;
    doStartApp();
  };

  // ── STEP 1: SaaS session ─────────────────────────────────────────
  var session = null;
  try{ session = saasGetSession(); }catch(e){}

  function proceedWithSession(u, s){
    try{ saasSetSession(u, s); }catch(e){}
    if(!s || !s.name || s.name.trim()===''){
      dismissLoader('onboarding');
      try{ hideAuthScreen(); showOnboardingScreen(); }catch(e){}
      return;
    }
    try{ updateHeaderUI(); applyFeatureGates(); updatePinShopName(); }catch(e){}
    var pinActive = false;
    try{ pinActive = isPinSessionActive(); }catch(e){}
    if(pinActive){
      try{
        var ps = document.getElementById('pin-screen');
        if(ps) ps.classList.add('hidden');
        var as = document.getElementById('saas-auth-screen');
        if(as) as.style.display = 'none';
      }catch(e){}
      clearTimeout(_safetyTimer);
      doStartApp();
    } else {
      dismissLoader('pin-screen');
      clearTimeout(_safetyTimer);
      try{
        var ps2 = document.getElementById('pin-screen');
        if(ps2) ps2.classList.remove('hidden');
        var header = document.querySelector('header.topbar');
        var mainEl = document.querySelector('main.main');
        var bnav   = document.querySelector('.bnav');
        if(header) header.style.visibility='hidden';
        if(mainEl) mainEl.style.visibility='hidden';
        if(bnav)   bnav.style.visibility='hidden';
        // Security review, 20-21 Sep 2026: no PIN set used to just show a
        // "Default PIN: 1234" hint and leave the screen in verify mode,
        // where typing 1234 silently unlocked. Route to set-mode instead --
        // same fix as lockApp().
        if(!isPinSet() && typeof _pinEnterSetMode==='function') _pinEnterSetMode();
      }catch(e){}
    }
  }

  if(!session){
    dismissLoader('no-session');
    clearTimeout(_safetyTimer);
    if(_saasSessionExpired()){
      // Same clean-up as a forced sign-out, minus the reload: nothing has
      // been loaded into memory yet.
      _clearDeviceSession();
      try{ sessionStorage.setItem(SIGNOUT_NOTICE_KEY, 'Your login has expired — please sign in again.'); }catch(e){}
    }
    try{ showAuthScreen(); }catch(e){}
    setTimeout(function(){ try{ saasLoadAuthFromCloud(function(){}); }catch(e){} }, 800);
    return;
  }

  var users=[], shops=[];
  try{ users=saasGetUsers(); shops=saasGetShops(); }catch(e){}
  var user = users.find(function(u){ return u.id===session.userId; });
  var shop = shops.find(function(s){ return s.id===session.shopId; });

  if(user && shop){
    proceedWithSession(user, shop);
    setTimeout(function(){ try{saasLoadAuthFromCloud(function(){});}catch(e){} }, 2000);
  } else {
    var lmsg = document.getElementById('loading-msg');
    if(lmsg) lmsg.textContent = '⏳ Checking your account...';
    saasLoadAuthFromCloud(function(err){
      var u2=[], s2=[];
      try{ u2=saasGetUsers(); s2=saasGetShops(); }catch(e){}
      var user2 = u2.find(function(u){ return u.id===session.userId; });
      var shop2 = s2.find(function(s){ return s.id===session.shopId; });
      if(user2 && shop2){
        try{ hideAuthScreen(); }catch(e){}
        proceedWithSession(user2, shop2);
      } else {
        try{ localStorage.removeItem(AUTH_KEY); }catch(e){}
        dismissLoader('orphan-session');
        clearTimeout(_safetyTimer);
        try{ showAuthScreen(); }catch(e){}
        var errEl = document.getElementById('auth-login-err');
        if(errEl) errEl.textContent='Session expired. Please log in again.';
      }
    });
  }
};

// F2 (30 Sep): a saveCache/loadCache wrapper that re-wrote activityLog into the
// cache used to live here; the base functions (04) have cached it for a while,
// so it only re-serialised the whole cache on every save. Removed.

// ── PATCH ALL WRITE OPERATIONS WITH ACTIVITY LOG ─────────────────────
(function(){
  // Wrap saveSale
  var _origSaveSale = window.saveSale;
  if(typeof _origSaveSale === 'function'){
    window.saveSale = function(){
      saasActivityLog('sale', 'New sale recorded');
      _origSaveSale();
    };
  }
  // Wrap saveGirviEntry
  var _origSaveGirvi = window.saveGirviEntry;
  if(typeof _origSaveGirvi === 'function'){
    window.saveGirviEntry = function(){
      saasActivityLog('girvi', 'Girvi entry saved');
      _origSaveGirvi();
    };
  }
}());

// ═══ END JEWELOS SAAS ENGINE ═══


// ══════════════════════════════════════════════════════════════════════
// ─── INTELLIGENCE LAYER v10 ─────────────────────────────────────────
// Owner Control Dashboard: Actions, Insights, Smart Reports,
// Customer Intelligence, Inventory Intelligence, Order Intelligence
// ══════════════════════════════════════════════════════════════════════

// ── INSIGHT ENGINE ───────────────────────────────────────────────────
// Rules-based system. Each rule returns null (no insight) or an object.
// Rules are pure functions — they only read S.* and financial engine output.

function runInsightEngine(){
  var insights = [];
  var now = new Date();
  var year = now.getFullYear();
  var month = now.getMonth();
  var thisM = calcMonthProfit(year, month);
  var lastM = calcMonthProfit(month===0?year-1:year, month===0?11:month-1);
  var prevM = calcMonthProfit(month<=1?year-1:year, month<=1?month+10:month-2);
  var activeGirvi = (S.girvi||[]).filter(function(g){return !g._deleted && g.status!=='closed';});
  var thisWeekSales = S.sales.filter(function(s){
    return (now - new Date(s.date)) < 7*86400000;
  });
  var lastWeekSales = S.sales.filter(function(s){
    var d = now - new Date(s.date);
    return d >= 7*86400000 && d < 14*86400000;
  });
  var totalPending = S.sales.reduce(function(s,x){return s+calcSaleTotals(x).bal;},0);
  var girviExposure = activeGirvi.reduce(function(s,g){return s+girviOutstanding(g);},0);

  // ── RULE 1: Revenue trend (month vs last month) ───────────────────
  if(lastM.revenue > 0){
    var revChg = ((thisM.revenue - lastM.revenue)/lastM.revenue*100);
    if(Math.abs(revChg) >= 5){
      insights.push({
        type: revChg >= 0 ? 'positive' : 'negative',
        icon: revChg >= 0 ? '📈' : '📉',
        text: 'Revenue is <strong>'+(revChg>=0?'up':'down')+' '+Math.abs(Math.round(revChg))+'%</strong> vs last month. '+
              (revChg>=0?'Great momentum — keep pushing.':'Review what changed this month.'),
        badge: revChg>=0?'up':'down',
        badgeText: (revChg>=0?'▲':'▼')+Math.abs(Math.round(revChg))+'%'
      });
    }
  }

  // ── RULE 2: Profit margin health ─────────────────────────────────
  if(thisM.revenue > 0){
    var margin = thisM.margin;
    if(margin < 5){
      insights.push({type:'negative',icon:'⚠️',
        text:'Profit margin is very low at <strong>'+margin.toFixed(1)+'%</strong>. Check if cost prices are entered correctly or if making charges are too low.'
      });
    } else if(margin > 20){
      insights.push({type:'positive',icon:'💎',
        text:'Excellent margin of <strong>'+margin.toFixed(1)+'%</strong> this month. Your making charges are working well.'
      });
    }
  }

  // ── RULE 3: Week-on-week sales velocity ──────────────────────────
  var twRev = thisWeekSales.reduce(function(s,x){return s+calcSaleTotals(x).grand;},0);
  var lwRev = lastWeekSales.reduce(function(s,x){return s+calcSaleTotals(x).grand;},0);
  if(lwRev > 0){
    var wkChg = ((twRev - lwRev)/lwRev*100);
    if(Math.abs(wkChg) >= 20){
      insights.push({
        type: wkChg>=0?'positive':'negative',
        icon: wkChg>=0?'🚀':'🔻',
        text:'This week\'s sales are <strong>'+(wkChg>=0?'up':'down')+' '+Math.abs(Math.round(wkChg))+'%</strong> vs last week ('+fmt(twRev)+' vs '+fmt(lwRev)+').'
      });
    }
  }

  // ── RULE 4: Credit concentration risk ───────────────────────────
  if(totalPending > 0){
    var custBals = {};
    S.sales.forEach(function(s){
      var k=s.customer+(s.phone?'_'+s.phone:'');
      custBals[k]=(custBals[k]||0)+calcSaleTotals(s).bal;
    });
    var topDebtor = Object.entries(custBals).sort(function(a,b){return b[1]-a[1];})[0];
    if(topDebtor && topDebtor[1] > totalPending*0.4){
      insights.push({type:'alert',icon:'⚠️',
        text:'<strong>'+topDebtor[0].split('_')[0]+'</strong> owes '+fmt(topDebtor[1])+' — that\'s '+(topDebtor[1]/totalPending*100).toFixed(0)+'% of all pending. High concentration risk.'
      });
    }
    var overdue60 = getSalesDueSoon(60).reduce(function(s,x){return s+calcSaleTotals(x).bal;},0);
    if(overdue60 > 0){
      insights.push({type:'negative',icon:'🔴',
        text:fmt(overdue60)+' in sales balance is <strong>60+ days overdue</strong>. Call these customers today.'
      });
    }
  }

  // ── RULE 5: Girvi LTV risk ───────────────────────────────────────
  var highLTVLoans = activeGirvi.filter(function(g){return girviLTV(g) > 0.85;});
  if(highLTVLoans.length > 0){
    var highLTVAmt = highLTVLoans.reduce(function(s,g){return s+girviOutstanding(g);},0);
    insights.push({type:'negative',icon:'🔴',
      text:'<strong>'+highLTVLoans.length+' girvi loan'+(highLTVLoans.length>1?'s':'')+' ('+fmt(highLTVAmt)+')</strong> have LTV above 85%. If gold price falls, these become underwater.'
    });
  }

  // ── RULE 6: Girvi interest intelligence ─────────────────────────
  var totalInterest = activeGirvi.reduce(function(s,g){return s+girviInterestAccrued(g);},0);
  if(totalInterest > 0){
    insights.push({type:'positive',icon:'💰',
      text:'Your active girvi loans have accrued <strong>'+fmt(Math.round(totalInterest))+'</strong> in interest. Collect this on next payment.'
    });
  }

  // ── RULE 7: Overdue girvi ────────────────────────────────────────
  var overdueGirvi = activeGirvi.filter(function(g){
    if(!g.duration) return false;
    var dueDate = new Date(g.startDate);
    dueDate.setMonth(dueDate.getMonth() + parseInt(g.duration));
    return dueDate < now;
  });
  if(overdueGirvi.length > 0){
    var oGAmt = overdueGirvi.reduce(function(s,g){return s+girviOutstanding(g);},0);
    insights.push({type:'negative',icon:'⏰',
      text:'<strong>'+overdueGirvi.length+' girvi loan'+(overdueGirvi.length>1?'s':'')+' past due date</strong> with '+fmt(oGAmt)+' outstanding. Contact borrowers or initiate default process.'
    });
  }

  // ── RULE 8: Dead stock detection ─────────────────────────────────
  var deadItems = getDeadStock(90);
  if(deadItems.length > 0){
    var deadVal = deadItems.reduce(function(s,p){return s+mktVal(p);},0);
    insights.push({type:'alert',icon:'📦',
      text:'<strong>'+deadItems.length+' items ('+fmt(Math.round(deadVal))+')</strong> have been in stock for 90+ days without selling. Consider discounting or promoting them.'
    });
  }

  // ── RULE 9: Top revenue customers ───────────────────────────────
  var custRevMap = {};
  S.sales.forEach(function(s){
    var k = s.customer+(s.phone?'_'+s.phone:'');
    custRevMap[k] = (custRevMap[k]||0) + calcSaleTotals(s).grand;
  });
  var topCustomers = Object.entries(custRevMap).sort(function(a,b){return b[1]-a[1];}).slice(0,3);
  if(topCustomers.length >= 3){
    var top3Rev = topCustomers.reduce(function(s,e){return s+e[1];},0);
    var totalRev = calcAllTimeProfit().revenue;
    var top3Pct  = totalRev>0?(top3Rev/totalRev*100).toFixed(0):0;
    insights.push({type:'neutral',icon:'👑',
      text:'Top 3 customers (<strong>'+topCustomers.map(function(e){return e[0].split('_')[0];}).join(', ')+'</strong>) drive '+top3Pct+'% of total revenue ('+fmt(top3Rev)+'). Nurture these relationships.'
    });
  }

  // ── RULE 10: Orders delay risk ───────────────────────────────────
  var delayedOrders = (S.orders||[]).filter(function(o){
    if(o.status==='delivered'||o.status==='cancelled') return false;
    return new Date(o.delivery) < now;
  });
  if(delayedOrders.length > 0){
    insights.push({type:'negative',icon:'🚨',
      text:'<strong>'+delayedOrders.length+' order'+(delayedOrders.length>1?'s':'')+' are past delivery date</strong>. Call customers before they call you.'
    });
  }

  // ── RULE 11: Capital stuck analysis ─────────────────────────────
  var totalAssets = stockGV() + stockSV() + totalPending + girviExposure;
  if(totalAssets > 0){
    var capitalStuck = totalPending + girviExposure;
    var stuckPct = (capitalStuck/totalAssets*100).toFixed(0);
    if(stuckPct > 30){
      insights.push({type:'alert',icon:'🔒',
        text:stuckPct+'% of your capital (<strong>'+fmt(Math.round(capitalStuck))+'</strong>) is stuck in credit+girvi. Actively collect to improve cash flow.'
      });
    }
  }

  // ── RULE 12: No sales today ──────────────────────────────────────
  var todaySales = S.sales.filter(function(s){
    return s.date === dbDayKey(now);
  });
  if(todaySales.length === 0 && now.getHours() >= 14){
    insights.push({type:'neutral',icon:'🛎️',
      text:'No sales recorded today yet. If you\'ve made sales, ensure they\'re being logged for accurate reports.'
    });
  }

  // Sort: negative first, then alert, then positive, then neutral
  var sortOrder = {negative:0,alert:1,positive:2,neutral:3};
  insights.sort(function(a,b){return (sortOrder[a.type]||3)-(sortOrder[b.type]||3);});
  return insights.slice(0, 8); // max 8 insights
}

// ── TODAY'S ACTIONS ENGINE ────────────────────────────────────────────
// Returns array of {type,icon,title,sub,cta,tab} objects
function buildTodayActions(){
  var actions = [];
  var now = new Date();
  var today = dbDayKey(now);
  var activeGirvi = (S.girvi||[]).filter(function(g){return !g._deleted && g.status!=='closed';});

  // 1. Overdue girvi
  var overdueG = activeGirvi.filter(function(g){
    if(!g.duration) return false;
    var due = new Date(g.startDate);
    due.setMonth(due.getMonth()+parseInt(g.duration));
    return due < now;
  });
  if(overdueG.length){
    var amt = overdueG.reduce(function(s,g){return s+girviOutstandingWithPenalty(g).amount;},0);
    actions.push({type:'urgent',icon:'🔴',
      title: overdueG.length+' girvi loan'+(overdueG.length>1?'s':'')+' overdue',
      sub:   fmt(amt)+' outstanding + penalties accruing daily',
      cta:   'View Girvi', tab:'girvi'});
  }

  // 2. Girvi due in 7 days
  var dueSoon = getGirviDueSoon(7);
  if(dueSoon.length){
    actions.push({type:'warning',icon:'⏰',
      title: dueSoon.length+' girvi'+(dueSoon.length>1?'s':'')+' due within 7 days',
      sub:   dueSoon.map(function(g){return g.grvNo+' ('+escHtml(g.customer)+')';}).join(', '),
      cta:   'Send reminders', tab:'girvi'});
  }

  // 3. Pending payments > 30 days
  var overduePay = getSalesDueSoon(30);
  if(overduePay.length){
    var payAmt = overduePay.reduce(function(s,x){return s+calcSaleTotals(x).bal;},0);
    actions.push({type:'urgent',icon:'💸',
      title: overduePay.length+' payment'+(overduePay.length>1?'s':'')+' overdue 30+ days',
      sub:   fmt(payAmt)+' uncollected',
      cta:   'Follow up', tab:'customers'});
  }

  // 4. Orders past delivery
  var lateOrders = (S.orders||[]).filter(function(o){
    return o.status!=='delivered'&&o.status!=='cancelled'&&new Date(o.delivery)<now;
  });
  if(lateOrders.length){
    actions.push({type:'urgent',icon:'📦',
      title: lateOrders.length+' order'+(lateOrders.length>1?'s':'')+' past delivery date',
      sub:   lateOrders.map(function(o){return o.ordNo+' \u2013 '+escHtml(o.customer);}).join(', '),
      cta:   'Manage orders', tab:'orders'});
  }

  // 5. Orders due today
  var todayOrders = (S.orders||[]).filter(function(o){
    return o.status!=='delivered'&&o.status!=='cancelled'&&o.delivery===today;
  });
  if(todayOrders.length){
    actions.push({type:'warning',icon:'🎁',
      title: todayOrders.length+' order'+(todayOrders.length>1?'s':'')+' due for delivery today',
      sub:   todayOrders.map(function(o){return escHtml(o.customer);}).join(', '),
      cta:   'Mark delivered', tab:'orders'});
  }

  // 6. High LTV girvi
  var highLTV = activeGirvi.filter(function(g){return girviLTV(g)>0.85;});
  if(highLTV.length){
    actions.push({type:'warning',icon:'⚠️',
      title: highLTV.length+' high-risk girvi (LTV > 85%)',
      sub:   'Gold value barely covers loan. Consider calling for early repayment.',
      cta:   'Review loans', tab:'girvi'});
  }

  // 7. If all clear — show positive
  if(!actions.length){
    actions.push({type:'ok',icon:'✅',
      title:'All clear today!',
      sub:'No overdue payments, loans, or delayed orders.',
      cta:null, tab:null});
  }

  return actions;
}

// ── INVENTORY INTELLIGENCE ────────────────────────────────────────────
// Dead stock = item available for > N days
