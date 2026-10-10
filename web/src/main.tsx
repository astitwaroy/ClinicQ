import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { ClinicPage } from './pages/ClinicPage';
import { Landing } from './pages/Landing';
import { LoginPage, SignupPage } from './pages/AuthPages';
import { TokenPage } from './pages/TokenPage';

// Patient pages load first and stay small; the desk, charts and QR screens load on demand.
const ConsoleLayout = lazy(() => import('./pages/console/ConsoleLayout').then((m) => ({ default: m.ConsoleLayout })));
const QueuePage = lazy(() => import('./pages/console/QueuePage').then((m) => ({ default: m.QueuePage })));
const AnalyticsPage = lazy(() => import('./pages/console/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const SettingsPage = lazy(() => import('./pages/console/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const DisplayPage = lazy(() => import('./pages/DisplayPage').then((m) => ({ default: m.DisplayPage })));
const PosterPage = lazy(() => import('./pages/PosterPage').then((m) => ({ default: m.PosterPage })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/c/:slug" element={<ClinicPage />} />
        <Route path="/c/:slug/poster" element={<PosterPage />} />
        <Route path="/t/:code" element={<TokenPage />} />
        <Route path="/display/:slug" element={<DisplayPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/app" element={<ConsoleLayout />}>
          <Route index element={<QueuePage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
