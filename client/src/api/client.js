const BASE_URL = import.meta.env.VITE_API_URL || '/api';

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
  register: (inviteCode, fullName, identifier, password) =>
    request('/auth/register', { method: 'POST', body: { inviteCode, fullName, identifier, password } }),

  loginPassword: (identifier, password) =>
    request('/auth/login/password', { method: 'POST', body: { identifier, password } }),

  verifyOtp: (preAuthToken, code) =>
    request('/auth/login/verify-otp', { method: 'POST', body: { preAuthToken, code } }),

  getMyPollingUnit: (token) => request('/locations/my-polling-unit', { token }),

  submitResult: (token, formData) =>
    request('/submissions', { method: 'POST', token, body: formData, isForm: true }),

  getMySubmission: (token, referenceNumber) =>
    request(`/submissions/mine/${referenceNumber}`, { token }),
};
