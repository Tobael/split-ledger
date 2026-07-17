import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { I18nProvider, useI18n } from './i18n';
import { Layout } from './components/Layout';
import { Footer } from './components/Footer';
import { Loader2 } from 'lucide-react';

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
  <div className="flex min-h-dvh flex-col">
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    <Footer />
  </div>
);

function AppRoutes() {
  const { isOnboarded, identityReady } = useApp();
  const { t } = useI18n();

  if (!identityReady) {
    return <div className="flex min-h-dvh items-center justify-center gap-2 text-sm text-[#716969]"><Loader2 className="size-5 animate-spin" />{t.common.loadingIdentity}</div>;
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
  const { t } = useI18n();
  return <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-[#716969]"><Loader2 className="size-5 animate-spin" />{t.common.loading}</div>;
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
