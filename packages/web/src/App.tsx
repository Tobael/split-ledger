import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { I18nProvider } from './i18n';
import { Layout } from './components/Layout';
import { Footer } from './components/Footer';

const Onboarding = lazy(() => import('./pages/Onboarding').then(({ Onboarding }) => ({ default: Onboarding })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(({ Dashboard }) => ({ default: Dashboard })));
const CreateGroup = lazy(() => import('./pages/CreateGroup').then(({ CreateGroup }) => ({ default: CreateGroup })));
const JoinGroup = lazy(() => import('./pages/JoinGroup').then(({ JoinGroup }) => ({ default: JoinGroup })));
const GroupDetail = lazy(() => import('./pages/GroupDetail').then(({ GroupDetail }) => ({ default: GroupDetail })));
const AddExpense = lazy(() => import('./pages/AddExpense').then(({ AddExpense }) => ({ default: AddExpense })));
const Settings = lazy(() => import('./pages/Settings').then(({ Settings }) => ({ default: Settings })));
const Impressum = lazy(() => import('./pages/Impressum').then(({ Impressum }) => ({ default: Impressum })));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy').then(({ PrivacyPolicy }) => ({ default: PrivacyPolicy })));

const PublicLayout = ({ children }: { children: ReactNode }) => (
  <div className="app-layout">
    <main className="app-main">{children}</main>
    <Footer />
  </div>
);

function AppRoutes() {
  const { isOnboarded, identityReady } = useApp();

  if (!identityReady) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading secure identity storage…</div>;
  }

  if (!isOnboarded) {
    return (
      <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/impressum" element={<PublicLayout><Impressum /></PublicLayout>} />
        <Route path="/privacy" element={<PublicLayout><PrivacyPolicy /></PublicLayout>} />
        <Route path="*" element={<Onboarding />} />
      </Routes>
      </Suspense>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/create-group" element={<CreateGroup />} />
        <Route path="/join" element={<JoinGroup />} />
        <Route path="/invite/:token" element={<JoinGroup />} />
        <Route path="/group/:id" element={<GroupDetail />} />
        <Route path="/group/:id/expense" element={<AddExpense />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/impressum" element={<Impressum />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      </Suspense>
    </Layout>
  );
}

function RouteLoading() {
  return <div className="flex min-h-48 items-center justify-center text-sm text-[#716969]">Loading…</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <AppProvider>
          <AppRoutes />
        </AppProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
