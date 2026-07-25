const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.headers.get('content-type')?.includes('text/csv')) {
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  loginPassword: (identifier, password) =>
    request('/auth/login/password', { method: 'POST', body: { identifier, password } }),
  verifyOtp: (preAuthToken, code) =>
    request('/auth/login/verify-otp', { method: 'POST', body: { preAuthToken, code } }),

  getSummary: (token) => request('/admin/summary', { token }),
  getLocalGovernments: (token) => request('/admin/local-governments', { token }),
  getWards: (token, lgaId) => request(`/admin/local-governments/${lgaId}/wards`, { token }),
  getPollingUnits: (token, wardId) => request(`/admin/wards/${wardId}/polling-units`, { token }),
  getPollingUnitDetail: (token, id) => request(`/admin/polling-units/${id}`, { token }),
  search: (token, q) => request(`/admin/search?q=${encodeURIComponent(q)}`, { token }),

  exportCsv: (token, level, id) =>
    request(`/admin/export/csv?level=${level}${id ? `&id=${id}` : ''}`, { token }),
  pdfExportUrl: (token, pollingUnitId) =>
    `${BASE_URL}/admin/export/pdf/polling-units/${pollingUnitId}`,

  getCorrectionRequests: (token) => request('/admin/correction-requests', { token }),
  createCorrectionRequest: (token, payload) =>
    request('/admin/correction-requests', { method: 'POST', token, body: payload }),
  decideCorrectionRequest: (token, id, approved) =>
    request(`/admin/correction-requests/${id}/decision`, { method: 'POST', token, body: { approved } }),

  getAdmins: (token) => request('/admin/admins', { token }),
  createAdmin: (token, payload) => request('/admin/admins', { method: 'POST', token, body: payload }),
  updateAdmin: (token, id, payload) => request(`/admin/admins/${id}`, { method: 'PATCH', token, body: payload }),
};
