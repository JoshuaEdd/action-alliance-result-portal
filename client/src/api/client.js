const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

async function request(path, { method = 'GET', body, token, isForm = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isForm && body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    err.details = data.details;
    throw err;
  }
  return data;
}

export const api = {
  loginPassword: (identifier, password) =>
    request('/auth/login/password', { method: 'POST', body: { identifier, password } }),

  verifyOtp: (preAuthToken, code) =>
    request('/auth/login/verify-otp', { method: 'POST', body: { preAuthToken, code } }),

  getLGAs: (token) => request('/locations/local-governments', { token }),
  getWards: (token, lgaId) => request(`/locations/local-governments/${lgaId}/wards`, { token }),
  getPollingUnits: (token, wardId) => request(`/locations/wards/${wardId}/polling-units`, { token }),

  submitResult: (token, formData) =>
    request('/submissions', { method: 'POST', token, body: formData, isForm: true }),

  getMySubmission: (token, referenceNumber) =>
    request(`/submissions/mine/${referenceNumber}`, { token }),
};
