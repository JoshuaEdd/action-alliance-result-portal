import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/router.jsx';
import { AuthProvider } from './context/AuthContext';
import './index.css';
import './styles/global.css';
import './styles/admin.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);