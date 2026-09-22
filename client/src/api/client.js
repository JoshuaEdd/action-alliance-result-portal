const BASE_URL = import.meta.env.VITE_API_URL || '/api';

function handleUnauthorized() {
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
  if (window.location.pathname !== '/login') window.location.assign('/login');
}

async function request(path, { method = 'GET', body, token, isForm = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isForm && body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  // Binary responses (CSV/XLSX/PDF uploads or photo blobs) bypass the JSON path.
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/csv') || contentType.includes('spreadsheetml.sheet') || contentType.includes('application/pdf')) {
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) handleUnauthorized();
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    err.details = data.details;
    throw err;
  }
  return data;
}

export const api = {
  // --- shared auth ---
  // Agent registration: creates the pending account and sends a verification
  // code (Email or SMS). Returns { requiresVerification, preVerifyToken, ... }
  // or { verified: true, enrollmentToken } for a resumed, already-verified
  // registration. No phone/SMS for legacy invite-code registrations.
  registerAgent: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  // Confirm the code sent to the chosen channel — unlocks fingerprint setup.
  registerVerifyCode: (preVerifyToken, code) =>
    request('/auth/register/verify-code', { method: 'POST', body: { preVerifyToken, code } }),
  registerResendCode: (email, verificationMethod) =>
    request('/auth/register/resend-code', { method: 'POST', body: { email, verificationMethod } }),
  getPortalStatus: () => request('/auth/portal-status'),
  getMe: (token) => request('/auth/me', { token }),
  webauthnRegisterOptions: (enrollmentToken, email) =>
    request('/auth/webauthn/register/options', { method: 'POST', body: { enrollmentToken, email } }),
  webauthnRegisterVerify: (enrollmentToken, challengeToken, response) =>
    request('/auth/webauthn/register/verify', { method: 'POST', body: { enrollmentToken, challengeToken, response } }),
  // Agent login: email + fingerprint assertion → session JWT
  webauthnLoginOptions: (email) =>
    request('/auth/webauthn/login/options', { method: 'POST', body: { email } }),
  webauthnLoginVerify: (email, challengeToken, response) =>
    request('/auth/webauthn/login/verify', { method: 'POST', body: { email, challengeToken, response } }),
  // Admin login: password + OTP (unchanged)
  loginPassword: (identifier, password) =>
    request('/auth/login/password', { method: 'POST', body: { identifier, password } }),
  verifyOtp: (preAuthToken, code) =>
    request('/auth/login/verify-otp', { method: 'POST', body: { preAuthToken, code } }),

  // --- public locations (agent registration cascade) ---
  getLocalGovernmentsPublic: () => request('/locations/local-governments'),
  getWardsPublic: (lgaId) => request(`/locations/local-governments/${lgaId}/wards`),
  getPollingUnitsPublic: (wardId) => request(`/locations/wards/${wardId}/polling-units`),

  // --- agent ---
  getMyPollingUnit: (token) => request('/locations/my-polling-unit', { token }),
  reverseGeocodePlace: (token, lat, lng) =>
    request(`/locations/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`, { token }),
  getParties: (token) => request('/locations/parties', { token }),
  submitResult: (token, formData) =>
    request('/submissions', { method: 'POST', token, body: formData, isForm: true }),
  getMySubmission: (token, referenceNumber) =>
    request(`/submissions/mine/${referenceNumber}`, { token }),
  getMySubmissions: (token) => request('/submissions/mine', { token }),
  // SEC-4 — report a mistake in an already-submitted result. The body is a
  // multipart form (proposed figures + reason + optional evidencePhoto); the
  // original result is never overwritten by this call.
  requestCorrection: (token, submissionId, formData) =>
    request(`/submissions/${submissionId}/correction-request`, { method: 'POST', token, body: formData, isForm: true }),

  // --- admin: summary & drill-down ---
  getSummary: (token) => request('/admin/summary', { token }),
  getPartyResults: (token, level, id) =>
    request(`/admin/party-results${level ? `?level=${level}${id ? `&id=${id}` : ''}` : ''}`, { token }),
  getLocalGovernments: (token) => request('/admin/local-governments', { token }),
  getWards: (token, lgaId) => request(`/admin/local-governments/${lgaId}/wards`, { token }),
  getPollingUnits: (token, wardId) => request(`/admin/wards/${wardId}/polling-units`, { token }),
  getPollingUnitDetail: (token, id) => request(`/admin/polling-units/${id}`, { token }),
  search: (token, q) => request(`/admin/search?q=${encodeURIComponent(q)}`, { token }),

  // Admin photo — authenticated blob rendered as an object URL.
  getPhotoUrl: async (token, photoId) => {
    const res = await fetch(`${BASE_URL}/admin/photos/${photoId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 401 && token) handleUnauthorized();
    if (!res.ok) throw new Error('Failed to load photo');
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  // --- admin: exports ---
  exportCsv: (token, level, id) =>
    request(`/admin/export/csv?level=${level}${id ? `&id=${id}` : ''}`, { token }),
  exportXlsx: (token, level, id) =>
    request(`/admin/export/xlsx?level=${level}${id ? `&id=${id}` : ''}`, { token }),
  exportPdf: (token, pollingUnitId) =>
    request(`/admin/export/pdf/polling-units/${pollingUnitId}`, { token }),
  exportWardPdf: (token, wardId) => request(`/admin/export/pdf/ward/${wardId}`, { token }),

  // --- admin: corrections (SEC-4 review workflow) ---
  getCorrectionRequests: (token, status) =>
    request(`/admin/correction-requests${status ? `?status=${status}` : ''}`, { token }),
  getCorrectionDetail: (token, id) => request(`/admin/correction-requests/${id}`, { token }),
  getCorrectionPhotoUrl: async (token, photoId) => {
    const res = await fetch(`${BASE_URL}/admin/correction-photos/${photoId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 401 && token) handleUnauthorized();
    if (!res.ok) throw new Error('Failed to load evidence photo');
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
  decideCorrection: (token, id, approved, rejectionReason) =>
    request(`/admin/correction-requests/${id}/decision`, {
      method: 'POST',
      token,
      body: { approved, rejectionReason },
    }),

  // --- admin: global agent-portal switch ---
  getAdminPortalStatus: (token) => request('/admin/portal-status', { token }),
  setAdminPortalStatus: (token, active) =>
    request('/admin/portal-status', { method: 'PATCH', token, body: { active } }),

  // --- admin: accounts ---
  getAdmins: (token) => request('/admin/admins', { token }),
  createAdmin: (token, payload) => request('/admin/admins', { method: 'POST', token, body: payload }),
  updateAdmin: (token, id, payload) => request(`/admin/admins/${id}`, { method: 'PATCH', token, body: payload }),
  deleteAdmin: (token, id) => request(`/admin/admins/${id}`, { method: 'DELETE', token }),

  // --- admin: invite codes ---
  getInviteCodes: (token, pollingUnitId) =>
    request(`/admin/invite-codes${pollingUnitId ? `?pollingUnitId=${pollingUnitId}` : ''}`, { token }),
  createInviteCode: (token, pollingUnitId, expiresInDays) =>
    request('/admin/invite-codes', { method: 'POST', token, body: { pollingUnitId, expiresInDays } }),
  bulkInviteCodes: (token, payload) =>
    request('/admin/invite-codes/bulk', { method: 'POST', token, body: payload }),
  revokeInviteCode: (token, id) =>
    request(`/admin/invite-codes/${id}`, { method: 'DELETE', token }),
};