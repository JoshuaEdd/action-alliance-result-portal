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
  // Agent registration: account shell + WebAuthn fingerprint enrollment
  registerAgent: (fullName, email, pollingUnitId) =>
    request('/auth/register', { method: 'POST', body: { fullName, email, pollingUnitId } }),
  webauthnRegisterOptions: (enrollmentToken) =>
    request('/auth/webauthn/register/options', { method: 'POST', body: { enrollmentToken } }),
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
  getParties: (token) => request('/locations/parties', { token }),
  submitResult: (token, formData) =>
    request('/submissions', { method: 'POST', token, body: formData, isForm: true }),
  getMySubmission: (token, referenceNumber) =>
    request(`/submissions/mine/${referenceNumber}`, { token }),

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

  // --- admin: corrections ---
  getCorrectionRequests: (token) => request('/admin/correction-requests', { token }),
  createCorrectionRequest: (token, payload) =>
    request('/admin/correction-requests', { method: 'POST', token, body: payload }),
  decideCorrectionRequest: (token, id, approved) =>
    request(`/admin/correction-requests/${id}/decision`, { method: 'POST', token, body: { approved } }),

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